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
import { Button, Flex, Modal, Popover } from "@patternfly/react-core";
import { ExternalLinkSquareAltIcon, HelpIcon, InProgressIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ShutdownModal } from 'cockpit-components-shutdown.jsx';
import { PrivilegedButton } from "cockpit-components-privileged.jsx";
import { ProfilesMenuDialogBody } from "./profiles-menu-dialog-body.jsx";

import "./cryptoPolicies.scss";

const _ = cockpit.gettext;

// Found in /usr/share/crypto-policies/policies/
const cryptopolicies = {
    DEFAULT: _("Recommended, secure settings for current threat models."),
    FUTURE: _("Protects from anticipated near-term future attacks at the expense of interoperability."),
    LEGACY: _("Higher interoperability at the cost of an increased attack surface."),
};
const applyNeedRebootStamp = "/run/cockpit/crypto-policies-reboot-stamp";
const displayProfileText = profile => profile.charAt(0) + profile.slice(1, profile.length).toLowerCase();

export const CryptoPolicyRow = () => {
    const [currentCryptoPolicy, setCurrentCryptoPolicy] = useState(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Avoid cockpit.spawn every re-render from parent
        if (currentCryptoPolicy === null) {
            cockpit.spawn(["update-crypto-policies", "--show"], { err: "message" })
                    .then(output => setCurrentCryptoPolicy(output.trim()))
                    .catch(err => {
                        console.debug("no crypto policies support: ", err.toString());
                        setCurrentCryptoPolicy(undefined);
                    });
            // When users run `update-crypto-policies` manually.
            cockpit.file("/etc/crypto-policies/state/current")
                    .watch(content => setCurrentCryptoPolicy(content ? content.trim() : null));
        }
    }, [currentCryptoPolicy]);

    if (!currentCryptoPolicy) {
        return null;
    }

    return (
        <tr>
            <th scope="row">{_("Crypto policy")}</th>
            <td>
                <PrivilegedButton variant="link" buttonId="crypto-policy-button" tooltipId="tip-crypto-policy"
                                  excuse={ _("The user $0 is not permitted to change crypto policies") }
                                  onClick={() => setIsOpen(true)}>
                    {displayProfileText(currentCryptoPolicy)}
                </PrivilegedButton>
                {isOpen &&
                <CryptoPolicyDialog close={() => setIsOpen(false)}
                                    currentCryptoPolicy={currentCryptoPolicy}
                                    setCurrentCryptoPolicy={setCurrentCryptoPolicy}
                />
                }
            </td>
        </tr>
    );
};

const CryptoPolicyDialog = ({
    close,
    currentCryptoPolicy,
    setCurrentCryptoPolicy,
}) => {
    const [error, setError] = useState();
    const [selected, setSelected] = useState(currentCryptoPolicy);

    const setPolicy = (reboot) => {
        cockpit.spawn(["update-crypto-policies", "--set", selected], { superuser: "require", err: "message" })
                .then(() => {
                    setCurrentCryptoPolicy(selected);
                    if (reboot) {
                        cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require", err: "message" })
                                .catch(error => setError(error));
                    } else {
                        cockpit.file(applyNeedRebootStamp, { superuser: "require" }).replace("\n")
                                .then(() => close());
                    }
                })
                .catch(error => setError(error));
    };

    const policies = Object.keys(cryptopolicies).map(policy => ({
        name: policy,
        title: displayProfileText(policy),
        description: cryptopolicies[policy],
        active: policy === currentCryptoPolicy,
        recommended: false,
    }));

    // Custom profile
    if (!(currentCryptoPolicy in cryptopolicies)) {
        policies.push({
            name: currentCryptoPolicy,
            title: displayProfileText(currentCryptoPolicy),
            description: _("Custom crypto policy"),
            active: true,
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
               isOpen
               help={help}
               onClose={close}
               id="crypto-policy-dialog"
               title={_("Change crypto policy")}
               footer={
                   <>
                       {error && <ModalError dialogError={typeof error == 'string' ? error : error.message} />}
                       <Button id="crypto-policy-save-reboot" variant='primary' onClick={() => setPolicy(true)}>
                           {_("Save and reboot")}
                       </Button>
                       <Button id="crypto-policy-save-reboot-later" variant='secondary' onClick={() => setPolicy(false)}>
                           {_("Save only")}
                       </Button>
                       <Button variant='link' onClick={close}>
                           {_("Cancel")}
                       </Button>
                   </>
               }
        >
            {currentCryptoPolicy && <ProfilesMenuDialogBody active_profile={currentCryptoPolicy}
                                                     change_selected={setSelected}
                                                     profiles={policies} />}
        </Modal>
    );
};

export const CryptoPolicyStatus = () => {
    const [requiresReboot, setRequiresReboot] = useState(false);
    const [showShutdownModal, setShowShutDownModal] = useState(false);

    useEffect(() => {
        if (!requiresReboot) {
            // For when we change the setting
            cockpit.file(applyNeedRebootStamp).watch(content => setRequiresReboot(content !== null));
        }
    }, [requiresReboot]);

    if (!requiresReboot) {
        return null;
    }

    return (
        <li className="system-health-crypto-policies">
            <Flex flexWrap={{ default: 'nowrap' }} spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                <InProgressIcon size="sm" className="crypto-policies-health-card-icon" />
                <Button isInline variant="link" onClick={() => setShowShutDownModal(true)}>
                    {_("Reboot to apply new crypto policy")}
                </Button>
            </Flex>
            {showShutdownModal &&
            <ShutdownModal onClose={() => setShowShutDownModal(false)} />
            }
        </li>
    );
};
