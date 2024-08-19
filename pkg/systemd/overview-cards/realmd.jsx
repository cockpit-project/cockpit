/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import React, { useState, useEffect } from 'react';

import { Alert, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { CheckIcon, ExclamationCircleIcon, InProgressIcon } from "@patternfly/react-icons";

import cockpit from "cockpit";
import { Privileged } from "cockpit-components-privileged.jsx";
import { superuser } from "superuser";
import { useEvent } from "hooks.js";
import { FormHelper } from "cockpit-components-form-helper";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import * as packagekit from "packagekit.js";
import { useDialogs } from "dialogs.jsx";

import "./realmd.scss";

const _ = cockpit.gettext;

const MANAGER = "/org/freedesktop/realmd";
const PROVIDER = "org.freedesktop.realmd.Provider";
const KERBEROS = "org.freedesktop.realmd.Kerberos";
const KERBEROS_MEMBERSHIP = "org.freedesktop.realmd.KerberosMembership";
const REALM = "org.freedesktop.realmd.Realm";

export class RealmdClient {
    constructor() {
        this.onClose = this.onClose.bind(this);
        this.onRealmsChanged = this.onRealmsChanged.bind(this);
        this.joined = [];
        this.detected = null;
        this.error = null;
        this.install_realmd = false;
        this.callSerial = 1;

        cockpit.event_target(this);
        this.initProxy();
        superuser.addEventListener("changed", () => this.initProxy());
    }

    onClose(ev, options) {
        if (options.problem === "not-found") {
            // see if we can install it
            packagekit.detect().then(exists => {
                if (exists) {
                    this.error = _("Joining a domain requires installation of realmd");
                    this.install_realmd = true;
                } else {
                    this.error = _("Cannot join a domain because realmd is not available on this system");
                }
                this.dispatchEvent("changed");
            });
        } else {
            this.error = cockpit.message(options);
            this.dispatchEvent("changed");
        }
        this.dbus_realmd.removeEventListener("close", this.onClose);
        this.dbus_realmd.close();
        this.dbus_realmd = null;
    }

    onRealmsChanged() {
        this.joined = [];
        for (const path in this.realms) {
            const realm = this.realms[path];
            if (realm.Configured)
                this.joined.push(realm);
        }

        this.dispatchEvent("changed");
    }

    initProxy() {
        // Ignore intermediate states of superuser.allowed to
        // avoid initializing the proxy twice during page
        // load. This is less wasteful and helps the tests avoid
        // race conditions. We are guaranteed to see a real "true"
        // or "false" value eventually.
        //
        if (superuser.allowed === null)
            return;

        if (this.dbus_realmd) {
            this.dbus_realmd.removeEventListener("close", this.onClose);
            this.dbus_realmd.close();
        }

        this.error = null;
        this.dbus_realmd = cockpit.dbus("org.freedesktop.realmd", { superuser: "try" });
        this.dbus_realmd.watch(MANAGER);
        this.dbus_realmd.addEventListener("close", this.onClose);

        this.realms = this.dbus_realmd.proxies(REALM, MANAGER);
        this.realms.addEventListener("changed", this.onRealmsChanged);
    }

    checkRealm(name) {
        return this.dbus_realmd.call(MANAGER, PROVIDER, "Discover", [name, {}])
                .then(([relevance, realms]) => {
                    if (realms.length == 0)
                        return { result: false };

                    // the first realm
                    const path = realms[0];
                    const realm = this.dbus_realmd.proxy(REALM, path);
                    const kerberos_membership = this.dbus_realmd.proxy(KERBEROS_MEMBERSHIP, path);
                    return Promise.allSettled([realm.wait(), kerberos_membership.wait()])
                            .then(() => { return { result: true, realm, kerberos_membership } });
                });
    }

    join(realm, kerberosMembership, user, password) {
        const id = "cockpit-" + this.callSerial;
        this.callSerial += 1;
        let diagnostics = "";

        const options = { operation: cockpit.variant('s', id) };
        const diagnostics_sub = this.dbus_realmd.subscribe({ member: "Diagnostics" }, (path, iface, signal, args) => {
            if (args[1] === id) {
                diagnostics += args[0];
            }
        });

        if (kerberosMembership.valid) {
            const credentials = ["password", "administrator", cockpit.variant('(ss)', [user, password])];
            return kerberosMembership.call("Join", [credentials, options])
                    .then(() => this.installWSCredentials(realm, user, password))
                    .catch(ex => {
                        if (ex.name == "org.freedesktop.realmd.Error.Cancelled")
                            return Promise.resolve();
                        ex.diagnostics = diagnostics;
                        return Promise.reject(ex);
                    })
                    .finally(() => diagnostics_sub.remove());
        } else {
            return Promise.reject(new Error(_("Joining this domain is not supported")));
        }
    }

    leave(realm) {
        return this.cleanupWSCredentials(realm)
                .then(() => realm.Deconfigure({ operation: cockpit.variant('s', "cockpit-leave-domain") }));
    }

    installWSCredentials(realm, user, password) {
        // skip this on remote ssh hosts, only set up ws hosts
        if (cockpit.transport.host !== "localhost")
            return true;

        const server_sw = find_detail(realm, "server-software");
        if (server_sw !== "ipa") {
            console.log("installing ws credentials not supported for server software", server_sw);
            return true;
        }

        const kerberos = this.dbus_realmd.proxy(KERBEROS, realm.path);
        return kerberos.wait()
                .then(() => {
                    const helper = cockpit.manifests.system.libexecdir + "/cockpit-certificate-helper";
                    const proc = cockpit.spawn([helper, "ipa", "request", kerberos.RealmName, user],
                                               { superuser: "require", err: "message" });
                    proc.input(password);
                    proc.catch(ex => console.warn("Failed to run", helper, "ipa request:", ex.toString()));
                    return proc;
                })
                .catch(() => true); // no Kerberos domain? nevermind then
    }

    cleanupWSCredentials(realm) {
        // skip this on remote ssh hosts, only set up ws hosts
        if (cockpit.transport.host !== "localhost")
            return Promise.resolve();

        const server_sw = find_detail(realm, "server-software");
        if (server_sw !== "ipa") {
            console.log("cleaning up ws credentials not supported for server software", server_sw);
            return Promise.resolve();
        }

        const kerberos = this.dbus_realmd.proxy(KERBEROS, realm.path);
        return kerberos.wait()
                .then(() => {
                    const helper = cockpit.manifests.system.libexecdir + "/cockpit-certificate-helper";
                    return cockpit.spawn([helper, "ipa", "cleanup", kerberos.RealmName],
                                         { superuser: "require", err: "message" })
                            .catch(ex => {
                                console.log("Failed to clean up SPN from /etc/cockpit/krb5.keytab:", JSON.stringify(ex));
                                return true;
                            });
                })
                .catch(() => true); // no Kerberos domain? nevermind then
    }

    allowHostnameChange() {
        return this.joined.length === 0;
    }

    installPackage() {
        if (this.install_realmd) {
            return install_dialog("realmd")
                    .then(() => {
                        this.install_realmd = false;
                        this.initProxy();
                        return true;
                    })
                    .catch(() => false); // dialog cancelled
        }

        return null;
    }
}

/*
 * The realmd dbus interface has an a(ss) Details
 * property. Lookup the right value for the given
 * field key.
 */
function find_detail(realm, field) {
    let result = null;
    if (realm && realm.Details) {
        realm.Details.forEach(value => {
            if (value[0] === field)
                result = value[1];
        });
    }
    return result;
}

const LeaveDialog = ({ realmd_client }) => {
    const Dialogs = useDialogs();
    const [expanded, setExpanded] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const realm = realmd_client.joined[0];

    const onLeave = () => {
        setPending(true);
        realmd_client.leave(realm)
                .then(Dialogs.close)
                .catch(err => {
                    console.warn("Failed to leave domain:", err.toString());
                    setPending(false);
                    setError(err);
                });
    };

    return (
        <Modal id="realms-leave-dialog" isOpen position="top" variant="medium"
               onClose={Dialogs.close}
               footer={
                   <>
                       { error && <Alert variant="danger" isInline className="realms-op-error" title={error.toString()} /> }
                       <Button variant="secondary" isDisabled={pending} onClick={Dialogs.close}>{ _("Close") }</Button>
                   </>
               }
               title={ _("dialog-title", "Domain") }>
            <DescriptionList isHorizontal>
                <DescriptionListGroup>
                    <DescriptionListTerm>{ _("Domain") }</DescriptionListTerm>
                    <DescriptionListDescription id="realms-op-info-domain">
                        { realm && realm.Name }
                    </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                    <DescriptionListTerm>{ _("Login format") }</DescriptionListTerm>
                    <DescriptionListDescription id="realms-op-info-login-format">{
                        realm && realm.LoginFormats && realm.LoginFormats.length > 0
                            ? realm.LoginFormats[0].replace("%U", "username")
                            : null
                    }</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                    <DescriptionListTerm>{ _("Server software") }</DescriptionListTerm>
                    <DescriptionListDescription id="realms-op-info-server-sw">
                        { find_detail(realm, "server-software") }
                    </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                    <DescriptionListTerm>{ _("Client software") }</DescriptionListTerm>
                    <DescriptionListDescription id="realms-op-info-client-sw">
                        { find_detail(realm, "client-software") }
                    </DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>

            <ExpandableSection toggleText={ _("Leave domain") } isExpanded={expanded}
                                onToggle={ e => setExpanded(e) }>
                <Alert variant="warning" isInline
                        title={ realm && realm.Name ? cockpit.format(_("Leave $0"), realm.Name) : _("Leave domain") }
                        actionLinks={
                            <Button variant="danger" id="realms-op-leave" isDisabled={pending} onClick={onLeave}>{ _("Leave domain") }</Button>
                        }>
                    { _("After leaving the domain, only users with local credentials will be able to log into this machine. This may also affect other services as DNS resolution settings and the list of trusted CAs may change.") }
                </Alert>
            </ExpandableSection>
        </Modal>);
};

let domainValidateTimeout;

const JoinDialog = ({ realmd_client }) => {
    const Dialogs = useDialogs();
    const [pending, setPending] = useState(false);
    const [address, setAddress] = useState("");
    const [addressValid, setAddressValid] = useState(null); // success, error, unsupported, default (for pending check)
    const [admin, setAdmin] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [realm, setRealm] = useState(null);
    const [kerberosMembership, setKerberosMembership] = useState(null);
    const [error, setError] = useState(null);
    const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

    const checkAddress = name => {
        setAddressValid("default");

        realmd_client.checkRealm(name)
                .then(reply => {
                    if (reply.result) {
                        setRealm(reply.realm);

                        // handle initial auto-detection
                        if (name == "") {
                            if (!address)
                                setAddress(reply.realm.Name);
                        }

                        if (reply.kerberos_membership && reply.kerberos_membership.valid) {
                            setAddressValid("success");
                            if (!admin && reply.kerberos_membership.SuggestedAdministrator)
                                setAdmin(reply.kerberos_membership.SuggestedAdministrator);
                            setKerberosMembership(reply.kerberos_membership);
                        } else {
                            setAddressValid("unsupported");
                        }
                    } else {
                        // error_detect will not show the validation error, but trigger data-discover=done
                        setAddressValid(name ? "error" : "error_detect");
                    }
                })
                .catch(err => console.error("checkRealm failed", JSON.stringify(err)));
    };

    const validateAddress = value => {
        setAddress(value);
        setAddressValid(null);
        window.clearTimeout(domainValidateTimeout);
        if (value)
            domainValidateTimeout = window.setTimeout(() => checkAddress(value), 1000);
    };

    const onJoin = () => {
        setError(null);
        setDiagnosticsExpanded(null);
        setPending(true);
        realmd_client.join(realm, kerberosMembership, admin, adminPassword)
                .then(Dialogs.close)
                .catch(err => {
                    setPending(false);
                    setError(err);
                });
    };

    // initial auto-detection of domain name
    useEffect(() => checkAddress(""), []); // eslint-disable-line react-hooks/exhaustive-deps

    const join_disabled = pending || addressValid !== "success" || !admin || !kerberosMembership;

    const DOMAIN_VALID_HELPER_TEXT = {
        default: _("Validating address"),
        success: _("Contacted domain"),
        error: _("Domain could not be contacted"),
        unsupported: _("Domain is not supported"),
    };

    const DOMAIN_VALID_HELPER_ICON = {
        default: <InProgressIcon />,
        success: <CheckIcon />,
        error: <ExclamationCircleIcon />,
        unsupported: <ExclamationCircleIcon />,
    };

    const domainHelperText = DOMAIN_VALID_HELPER_TEXT[addressValid];
    const domainHelperIcon = DOMAIN_VALID_HELPER_ICON[addressValid];

    let errorAlert;
    if (error) {
        const details = (error.diagnostics && diagnosticsExpanded)
            ? <CodeBlockCode className="realms-op-diagnostics">{error.diagnostics}</CodeBlockCode>
            : null;
        const actionLink = (error.diagnostics && !diagnosticsExpanded)
            ? <AlertActionLink onClick={ () => setDiagnosticsExpanded(true) }>{ _("Details") }</AlertActionLink>
            : null;
        errorAlert = <Alert variant="danger" isInline className="realms-op-error" actionLinks={actionLink} title={error.toString()}>{details}</Alert>;
    }

    return (
        <Modal id="realms-join-dialog" isOpen position="top" variant="medium"
               onClose={Dialogs.close}
               footer={
                   <>
                       { errorAlert }
                       <Button variant="primary"
                               isDisabled={join_disabled}
                               onClick={onJoin}
                               isLoading={pending}
                               spinnerAriaValueText={ pending ? _("Joining") : null }>
                           { _("Join") }
                       </Button>
                       <Button variant="link" isDisabled={pending} onClick={Dialogs.close}>{ _("Cancel") }</Button>
                       { pending && <span className="realms-op-wait-message">{ _("This may take a while") }</span> }
                   </>
               }
               title={ _("dialog-title", "Join a domain") }>
            <Form isHorizontal onSubmit={onJoin}>
                <FormGroup label={ _("Domain address") } fieldId="realms-op-address" validated={addressValid}>
                    <TextInput id="realms-op-address" placeholder="domain.example.com"
                               data-discover={ (!addressValid || addressValid == "default") ? null : "done" }
                               value={address} onChange={(_event, value) => validateAddress(value)} isDisabled={pending} />
                </FormGroup>

                <FormGroup label={ _("Domain administrator name") } fieldId="realms-op-admin">
                    <TextInput id="realms-op-admin" placeholder="admin" value={admin} onChange={(_event, value) => setAdmin(value)} isDisabled={pending} />
                </FormGroup>
                <FormGroup label={ _("Domain administrator password") } fieldId="realms-op-admin-password">
                    <TextInput id="realms-op-admin-password" type="password" value={adminPassword} onChange={(_event, value) => setAdminPassword(value)} isDisabled={pending} />
                </FormGroup>
                <FormHelper fieldId="realms-op-address" helperText={domainHelperText} helperTextInvalid={addressValid == "error" && domainHelperText} icon={domainHelperIcon} />
            </Form>
        </Modal>);
};

export const RealmButton = ({ realmd_client }) => {
    const Dialogs = useDialogs();
    useEvent(realmd_client, "changed");
    useEvent(superuser, "changed");

    const buttonTooltip = superuser.allowed ? realmd_client.error : _("Not permitted to configure realms");
    const buttonText = !realmd_client.install_realmd ? (realmd_client.joined.length ? realmd_client.joined.map(r => r.Name).join(", ") : _("Join domain")) : _("Install realmd support");
    const buttonDisabled = !superuser.allowed || (realmd_client.error && !realmd_client.install_realmd);

    const onClicked = () => {
        // handle on-demand realmd package install
        const install_promise = realmd_client.installPackage();
        if (install_promise) {
            // after installation, proceed to join dialog
            install_promise.then(success => success && onClicked());
            return null;
        }
        realmd_client.joined.length > 0
            ? Dialogs.show(<LeaveDialog realmd_client={realmd_client} />)
            : Dialogs.show(<JoinDialog realmd_client={realmd_client} />);
    };

    return (
        <Privileged allowed={ superuser.allowed && !realmd_client.error }
                    tooltipId="system_information_domain_tooltip"
                    excuse={ buttonTooltip }>
            <Button id="system_information_domain_button" variant="link"
                    onClick={onClicked}
                    isInline isDisabled={buttonDisabled} aria-label={buttonText}>
                { buttonText }
            </Button>
        </Privileged>);
};
