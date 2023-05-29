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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React, { useState, useEffect } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { ExclamationTriangleIcon, ExternalLinkSquareAltIcon, HelpIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { PrivilegedButton } from "cockpit-components-privileged.jsx";
import { ProfilesMenuDialogBody } from "./profiles-menu-dialog-body.jsx";
import { useDialogs } from "dialogs.jsx";

import "./cryptoPolicies.scss";

const _ = cockpit.gettext;

const displayProfileText = profile => profile === "FIPS" ? profile : profile.charAt(0) + profile.slice(1, profile.length).toLowerCase();
const isInconsistentPolicy = (policy, fipsEnabled) => policy === "FIPS" !== fipsEnabled;

export const CryptoPolicyRow = () => {
    const Dialogs = useDialogs();
    const [currentCryptoPolicy, setCurrentCryptoPolicy] = useState(null);
    const [fipsEnabled, setFipsEnabled] = useState(null);
    const [shaSubPolicyAvailable, setShaSubPolicyAvailable] = useState(null);

    useEffect(() => {
        cockpit.file("/proc/sys/crypto/fips_enabled").read()
                .then(content => setFipsEnabled(content ? content.trim() === "1" : false));
        cockpit.file("/etc/crypto-policies/state/current")
                .watch(content => setCurrentCryptoPolicy(content ? content.trim() : null));
        // RHEL-8-8 has no SHA1 subpolicy
        cockpit.file("/usr/share/crypto-policies/policies/modules/SHA1.pmod").read()
                .then(content => setShaSubPolicyAvailable(content ? content.trim() : false));
    }, []);

    if (!currentCryptoPolicy) {
        return null;
    }

    return (
        <tr>
            <th scope="row">{_("Crypto policy")}</th>
            <td>
                <PrivilegedButton variant="link" buttonId="crypto-policy-button" tooltipId="tip-crypto-policy"
                                  excuse={ _("The user $0 is not permitted to change crypto policies") }
                                  onClick={() => Dialogs.show(<CryptoPolicyDialog
                                                                  currentCryptoPolicy={currentCryptoPolicy}
                                                                  setCurrentCryptoPolicy={setCurrentCryptoPolicy}
                                                                  fipsEnabled={fipsEnabled}
                                                                  shaSubPolicyAvailable={shaSubPolicyAvailable} />)}>
                    {displayProfileText(currentCryptoPolicy)}
                </PrivilegedButton>
            </td>
        </tr>
    );
};

const setPolicy = (policy, setError, setInProgress) => {
    setInProgress(true);

    let promise;
    if (policy === "FIPS") {
        promise = cockpit.spawn(["fips-mode-setup", "--enable"], { superuser: "require", err: "message" });
    } else {
        promise = cockpit.spawn(["fips-mode-setup", "--disable"], { superuser: "require", err: "message" }).then(() =>
            cockpit.spawn(["update-crypto-policies", "--set", policy], { superuser: "require", err: "message" }));
    }

    promise.then(() => cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require", err: "message" }))
            .catch(error => setError(error))
            .finally(() => setInProgress(false));
};

const CryptoPolicyDialog = ({
    currentCryptoPolicy,
    fipsEnabled,
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
                    href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/security_hardening/assembly_installing-a-rhel-8-system-with-fips-mode-enabled_security-hardening">
                {_("Learn more")}
            </Button>
        </Flex>),
        "FIPS:OSPP": _("FIPS with further Common Criteria restrictions."),
        FUTURE: _("Protects from anticipated near-term future attacks at the expense of interoperability."),
    };

    const policies = Object.keys(cryptopolicies)
            .filter(pol => pol.endsWith(':SHA1') ? shaSubPolicyAvailable : true)
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
            description: _("Custom crypto policy"),
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
                    {_("Crypto Policies is a system component that configures the core cryptographic subsystems, covering the TLS, IPSec, SSH, DNSSec, and Kerberos protocols.")}
                </div>
            }
            footerContent={
                <Button component='a'
                        rel="noopener noreferrer" target="_blank"
                        variant='link'
                        isInline
                        icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                        href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/security_hardening/using-the-system-wide-cryptographic-policies_security-hardening">
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
               title={_("Change crypto policy")}
               footer={
                   <>
                       {inProgress &&
                       <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                           {_("Applying new policy... This may take a few minutes.")}
                       </Flex>}
                       <Button id="crypto-policy-save-reboot" variant='primary' onClick={() => setPolicy(selected, setError, setInProgress)}
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

    useEffect(() => {
        if (currentCryptoPolicy === null) {
            cockpit.file("/etc/crypto-policies/state/current")
                    .watch(content => setCurrentCryptoPolicy(content ? content.trim().split(':', 1)[0] : undefined));
        }

        cockpit.file("/proc/sys/crypto/fips_enabled").read()
                .then(content => setFipsEnabled(content ? content.trim() === "1" : false));
    }, [currentCryptoPolicy]);

    if (isInconsistentPolicy(currentCryptoPolicy, fipsEnabled)) {
        return (
            <li className="system-health-crypto-policies">
                <Flex spacer={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                    <FlexItem><ExclamationTriangleIcon className="crypto-policies-health-card-icon" /></FlexItem>
                    <div>
                        <div id="inconsistent_crypto_policy">
                            {currentCryptoPolicy === "FIPS" ? _("FIPS is not properly enabled") : _("Crypto policy is inconsistent")}
                        </div>
                        <Button isInline variant="link" className="pf-v5-u-font-size-sm"
                                onClick={() => Dialogs.show(<CryptoPolicyDialog currentCryptoPolicy={currentCryptoPolicy}
                                                                                fipsEnabled={fipsEnabled}
                                                                                reApply />)}>
                            {_("Review crypto policy")}
                        </Button>
                    </div>
                </Flex>
            </li>
        );
    }

    return null;
};
