/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { ExclamationTriangleIcon, ExternalLinkSquareAltIcon, HelpIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { PrivilegedButton } from "cockpit-components-privileged.jsx";
import { ProfilesMenuDialogBody } from "./profiles-menu-dialog-body.jsx";
import { useDialogs } from "dialogs.jsx";
import { useInit } from "hooks";

import "./cryptoPolicies.scss";

const _ = cockpit.gettext;

const displayProfileText = profile => profile === "DEFAULT" ? _("Default") : profile;
const isInconsistentPolicy = (policy, fipsEnabled) => policy === "FIPS" !== fipsEnabled;

const getFipsConfigurable = () => cockpit.spawn(["/bin/sh", "-c", "command -v fips-mode-setup"], { error: "ignore" })
        .then(() => true)
        .catch(() => false);

export const CryptoPolicyRow = () => {
    const Dialogs = useDialogs();
    const [currentCryptoPolicy, setCurrentCryptoPolicy] = useState(null);
    const [fipsEnabled, setFipsEnabled] = useState(null);
    const [fipsConfigurable, setFipsConfigurable] = useState(null);
    const [shaSubPolicyAvailable, setShaSubPolicyAvailable] = useState(null);

    useInit(() => {
        cockpit.file("/proc/sys/crypto/fips_enabled").read()
                .then(content => setFipsEnabled(content ? content.trim() === "1" : false));
        getFipsConfigurable().then(v => setFipsConfigurable(v));
        cockpit.file("/etc/crypto-policies/config")
                .watch(async contents => {
                    // Ask crypto-policies to get correct FIPS state, as that dominates the configured policy
                    try {
                        setCurrentCryptoPolicy((await cockpit.spawn(["update-crypto-policies", "--show"])).trim());
                    } catch (error) {
                        console.warn("Failed to get current crypto policy:", error.toString(),
                                     "; falling back to /etc/crypto-policies/config");
                        const filteredContent = contents?.split('\n').filter(line => !line.startsWith("#")).join('\n');
                        setCurrentCryptoPolicy(filteredContent?.trim() ?? null);
                    }
                });
        // RHEL-8-8 has no SHA1 subpolicy
        cockpit.file("/usr/share/crypto-policies/policies/modules/SHA1.pmod").read()
                .then(content => setShaSubPolicyAvailable(content ? content.trim() : false));
    });

    if (currentCryptoPolicy === null || fipsEnabled === null || fipsConfigurable === null)
        return null;

    const policyRender = (currentCryptoPolicy.startsWith("FIPS") && !fipsConfigurable)
        /* read-only mode; can't switch away from FIPS without fips-mode-setup */
        ? <span id="crypto-policy-current">{displayProfileText(currentCryptoPolicy)}</span>
        : <PrivilegedButton variant="link" buttonId="crypto-policy-button" tooltipId="tip-crypto-policy"
                            excuse={ _("The user $0 is not permitted to change cryptographic policies") }
                            onClick={() => Dialogs.show(<CryptoPolicyDialog
                                                            currentCryptoPolicy={currentCryptoPolicy}
                                                            setCurrentCryptoPolicy={setCurrentCryptoPolicy}
                                                            fipsEnabled={fipsEnabled}
                                                            fipsConfigurable={fipsConfigurable}
                                                            shaSubPolicyAvailable={shaSubPolicyAvailable} />)}>
            {displayProfileText(currentCryptoPolicy)}
        </PrivilegedButton>;

    return (
        <tr className="pf-v5-c-table__tr">
            <th className="pf-v5-c-table__th" scope="row">{_("Cryptographic policy")}</th>
            <td className="pf-v5-c-table__td">{policyRender}</td>
        </tr>
    );
};

const setPolicy = async (policy, setError, setInProgress, fipsConfigurable) => {
    setInProgress(true);

    try {
        if (policy === "FIPS") {
            cockpit.assert(fipsConfigurable, "calling setPolicy(FIPS) without fips-mode-setup");
            await cockpit.spawn(["fips-mode-setup", "--enable"], { superuser: "require", err: "message" });
        } else {
            if (fipsConfigurable)
                await cockpit.spawn(["fips-mode-setup", "--disable"], { superuser: "require", err: "message" });
            await cockpit.spawn(["update-crypto-policies", "--set", policy], { superuser: "require", err: "message" });
        }

        await cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require", err: "message" });
    } catch (error) {
        setError(error);
    } finally {
        setInProgress(false);
    }
};

const CryptoPolicyDialog = ({
    currentCryptoPolicy,
    fipsEnabled,
    fipsConfigurable,
    reApply,
    shaSubPolicyAvailable,
}) => {
    const Dialogs = useDialogs();
    const [error, setError] = useState();
    const [inProgress, setInProgress] = useState(false);
    const [selected, setSelected] = useState(currentCryptoPolicy);

    // Found in /usr/share/crypto-policies/policies/
    const cryptopolicies = {
        DEFAULT: _("Recommended, secure settings for current threat models."),
        "DEFAULT:SHA1": _("DEFAULT with SHA-1 signature verification allowed."),
        LEGACY: _("Higher interoperability at the cost of an increased attack surface."),
        "LEGACY:AD-SUPPORT": _("LEGACY with Active Directory interoperability."),
        FIPS: (<Flex alignItems={{ default: 'alignItemsCenter' }}>
            {_("Only use approved and allowed algorithms when booting in FIPS mode.")}
            <Button component='a'
                    rel="noopener noreferrer" target="_blank"
                    variant='link'
                    isInline
                    icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                    href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/security_hardening/switching-rhel-to-fips-mode_security-hardening">
                {_("Learn more")}
            </Button>
        </Flex>),
        "FIPS:OSPP": _("FIPS with further Common Criteria restrictions."),
        FUTURE: _("Protects from anticipated near-term future attacks at the expense of interoperability."),
    };

    const policies = Object.keys(cryptopolicies)
            .filter(pol => pol.endsWith(':SHA1') ? shaSubPolicyAvailable : true)
            // cannot enable fips without fips-mode-setup
            .filter(pol => pol.startsWith("FIPS") ? fipsConfigurable : true)
            .map(policy => ({
                name: policy,
                title: displayProfileText(policy),
                description: cryptopolicies[policy],
                active: !isInconsistentPolicy(policy, fipsEnabled) && policy === currentCryptoPolicy,
                inconsistent: isInconsistentPolicy(policy, fipsEnabled) && policy === currentCryptoPolicy,
                recommended: policy === 'DEFAULT',
            }));

    // Custom profile
    if (!(currentCryptoPolicy in cryptopolicies)) {
        policies.push({
            name: currentCryptoPolicy,
            title: displayProfileText(currentCryptoPolicy),
            description: _("Custom cryptographic policy"),
            active: !isInconsistentPolicy(currentCryptoPolicy, fipsEnabled),
            inconsistent: isInconsistentPolicy(currentCryptoPolicy, fipsEnabled),
            recommended: false,
        });
    }

    const help = (
        <Popover
            id="crypto-policies-help"
            bodyContent={
                <div>
                    {_("Cryptographic Policies is a system component that configures the core cryptographic subsystems, covering the TLS, IPSec, SSH, DNSSec, and Kerberos protocols.")}
                </div>
            }
            footerContent={
                <Button component='a'
                        rel="noopener noreferrer" target="_blank"
                        variant='link'
                        isInline
                        icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                        href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/security_hardening/using-the-system-wide-cryptographic-policies_security-hardening">
                    {_("Learn more")}
                </Button>
            }
        >
            <Button variant="plain" aria-label={_("Help")}>
                <HelpIcon />
            </Button>
        </Popover>
    );

    return (
        <Modal position="top" variant="medium"
               className="ct-m-stretch-body"
               isOpen
               help={help}
               onClose={Dialogs.close}
               id="crypto-policy-dialog"
               title={_("Change cryptographic policy")}
               footer={
                   <>
                       {inProgress &&
                       <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                           {_("Applying new policy... This may take a few minutes.")}
                       </Flex>}
                       <Button id="crypto-policy-save-reboot" variant='primary'
                               onClick={() => setPolicy(selected, setError, setInProgress, fipsConfigurable)}
                               isDisabled={inProgress} isLoading={inProgress}
                       >
                           {reApply ? _("Reapply and reboot") : _("Apply and reboot")}
                       </Button>
                       <Button variant='link' onClick={Dialogs.close} isDisabled={inProgress}>
                           {_("Cancel")}
                       </Button>
                   </>
               }
        >
            {error && <ModalError dialogError={typeof error == 'string' ? error : error.message} />}
            {currentCryptoPolicy && <ProfilesMenuDialogBody active_profile={currentCryptoPolicy}
                                                     change_selected={setSelected}
                                                     isDisabled={inProgress}
                                                     profiles={policies} />}
        </Modal>
    );
};

export const CryptoPolicyStatus = () => {
    const Dialogs = useDialogs();
    const [currentCryptoPolicy, setCurrentCryptoPolicy] = useState(null);
    const [fipsEnabled, setFipsEnabled] = useState(null);
    const [fipsConfigurable, setFipsConfigurable] = useState(null);

    useInit(() => {
        cockpit.file("/etc/crypto-policies/state/current")
                .watch(content => setCurrentCryptoPolicy(content ? content.trim().split(':', 1)[0] : undefined));
        getFipsConfigurable().then(v => setFipsConfigurable(v));
        cockpit.file("/proc/sys/crypto/fips_enabled").read()
                .then(content => setFipsEnabled(content ? content.trim() === "1" : false));
    });

    if (currentCryptoPolicy === null || fipsConfigurable === null)
        return null;

    if (isInconsistentPolicy(currentCryptoPolicy, fipsEnabled)) {
        return (
            <li className="system-health-crypto-policies">
                <Flex flexWrap={{ default: 'nowrap' }}>
                    <FlexItem><ExclamationTriangleIcon className="crypto-policies-health-card-icon" /></FlexItem>
                    <div>
                        <div id="inconsistent_crypto_policy">
                            {currentCryptoPolicy === "FIPS" ? _("FIPS is not properly enabled") : _("Cryptographic policy is inconsistent")}
                        </div>
                        <Button isInline variant="link" className="pf-v5-u-font-size-sm"
                                onClick={() => Dialogs.show(<CryptoPolicyDialog currentCryptoPolicy={currentCryptoPolicy}
                                                                                fipsEnabled={fipsEnabled}
                                                                                fipsConfigurable={fipsConfigurable}
                                                                                reApply />)}>
                            {_("Review cryptographic policy")}
                        </Button>
                    </div>
                </Flex>
            </li>
        );
    }

    return null;
};
