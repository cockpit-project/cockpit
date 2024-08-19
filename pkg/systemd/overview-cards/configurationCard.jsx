/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import React, { useState } from 'react';
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Form, FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem, } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import host_keys_script from "./ssh-list-host-keys.sh";
import cockpit from "cockpit";
import { superuser } from "superuser";
import { useObject, useEvent } from "hooks.js";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ServerTimeConfig } from 'serverTime.js';
import { RealmdClient, RealmButton } from "./realmd.jsx";
import { TunedPerformanceProfile } from './tuned-dialog.jsx';
import { CryptoPolicyRow } from './cryptoPolicies.jsx';
import { useDialogs } from "dialogs.jsx";
import { useInit } from "hooks";

import "./configurationCard.scss";

const _ = cockpit.gettext;

export const ConfigurationCard = ({ hostname }) => {
    const Dialogs = useDialogs();
    const realmd_client = useObject(() => new RealmdClient(), null, []);
    useEvent(realmd_client, "changed");

    const hostname_button = (superuser.allowed && realmd_client.allowHostnameChange())
        ? (
            <Button id="system_information_hostname_button" variant="link"
                    onClick={() => Dialogs.show(<PageSystemInformationChangeHostname />)}
                    isInline aria-label="edit hostname">
                {hostname !== "" ? _("edit") : _("Set hostname")}
            </Button>)
        : null;

    return (
        <Card className="system-configuration">
            <CardTitle>{_("Configuration")}</CardTitle>
            <CardBody>
                <table className="pf-v5-c-table pf-m-grid-md pf-m-compact">
                    <tbody className="pf-v5-c-table__tbody">
                        <tr className="pf-v5-c-table__tr">
                            <th className="pf-v5-c-table__th" scope="row">{_("Hostname")}</th>
                            <td className="pf-v5-c-table__td">
                                {hostname && <span id="system_information_hostname_text">{hostname}</span>}
                                <span>{hostname_button}</span>
                            </td>
                        </tr>

                        <tr className="pf-v5-c-table__tr">
                            <th className="pf-v5-c-table__th" scope="row">{_("System time")}</th>
                            <td className="pf-v5-c-table__td"><ServerTimeConfig /></td>
                        </tr>

                        <tr className="pf-v5-c-table__tr">
                            <th className="pf-v5-c-table__th" scope="row">{_("Domain")}</th>
                            <td className="pf-v5-c-table__td"><RealmButton realmd_client={realmd_client} /></td>
                        </tr>

                        <tr className="pf-v5-c-table__tr">
                            <th className="pf-v5-c-table__th" scope="row">{_("Performance profile")}</th>
                            <td className="pf-v5-c-table__td"><TunedPerformanceProfile /></td>
                        </tr>

                        <CryptoPolicyRow />

                        <tr className="pf-v5-c-table__tr">
                            <th className="pf-v5-c-table__th" scope="row">{_("Secure shell keys")}</th>
                            <td className="pf-v5-c-table__td">
                                <Button variant="link" isInline id="system-ssh-keys-link"
                                            onClick={() => Dialogs.show(<SystemInformationSshKeys />)}>
                                    {_("Show fingerprints")}
                                </Button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </CardBody>
        </Card>
    );
};

const SystemInformationSshKeys = () => {
    const Dialogs = useDialogs();
    const [keys, setKeys] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    function keysUpdate() {
        cockpit.script(host_keys_script, [], { superuser: "try", err: "message" })
                .then(data => {
                    const seen = {};
                    const keys = {};

                    data.trim().split("\n")
                            .forEach(line => {
                                if (!line)
                                    return;

                                const parts = line.trim().split(" ");
                                const fp = parts[1];
                                if (!seen[fp]) {
                                    seen[fp] = fp;
                                    let title = parts[parts.length - 1];
                                    if (title) {
                                        const m = title.match(/^\((.*)\)$/);
                                        if (m && m[1])
                                            title = m[1];
                                    }
                                    if (!keys[title])
                                        keys[title] = [];
                                    keys[title].push(fp);
                                }
                            });

                    let arr = Object.keys(keys);
                    arr.sort();
                    arr = arr.map(function(k) {
                        return { title: k, fps: keys[k] };
                    });

                    setKeys(arr);
                    setLoading(false);
                    setError("");
                })
                .catch(function(ex) {
                    setLoading(false);
                    setError(cockpit.format(_("failed to list ssh host keys: $0"), ex.message));
                });
    }

    function create_keyUpdater() {
        /*
         * Yes, we do refresh the keys while the dialog is open.
         * It may occur that sshd is not running at the point when
         * we try, or in rare cases the keys may change.
         */
        keysUpdate();
        return window.setInterval(keysUpdate, 10 * 1000);
    }

    function destroy_keyUpdater(interval) {
        window.clearInterval(interval);
    }

    useObject(create_keyUpdater, destroy_keyUpdater, []);

    let body = null;
    if (error)
        body = <Alert variant='danger' isInline title={_("Loading of SSH keys failed")}>
            <p>{_("Error message")}: {error}</p>
        </Alert>;
    else if (loading)
        body = <EmptyStatePanel loading title={ _("Loading keys...") } />;
    else if (!keys.length)
        body = <EmptyStatePanel title={ _("No host keys found.") } />;
    else
        body = <List isPlain isBordered>
            {keys.map(key =>
                <ListItem key={key.title}>
                    <h4>{key.title}</h4>
                    {key.fps.map((fp, i) => <div key={i}><small>{fp}</small></div>)}
                </ListItem>
            )}
        </List>;

    return (
        <Modal isOpen position="top" variant="medium"
               onClose={Dialogs.close}
               id="system_information_ssh_keys"
               title={_("Machine SSH key fingerprints")}
               footer={<Button variant='secondary' onClick={Dialogs.close}>{_("Close")}</Button>}
        >
            {body}
        </Modal>
    );
};

const PageSystemInformationChangeHostname = () => {
    const Dialogs = useDialogs();
    const [update_from_pretty, set_update_from_pretty] = useState(true);
    const [init_hostname, set_init_hostname] = useState("");
    const [hostname, set_hostname] = useState("");
    const [proxy, set_proxy] = useState(null);
    const [pretty, set_pretty] = useState("");
    const [init_pretty, set_init_pretty] = useState("");
    const [error, set_error] = useState([]);

    useInit(() => {
        const client = cockpit.dbus('org.freedesktop.hostname1', { superuser: "try" });
        const hostname_proxy = client.proxy();

        hostname_proxy.wait()
                .then(() => {
                    const initial_hostname = hostname_proxy.StaticHostname || "";
                    const initial_pretty_hostname = hostname_proxy.PrettyHostname || "";

                    set_proxy(hostname_proxy);
                    set_hostname(initial_hostname);
                    set_init_hostname(initial_hostname);
                    set_pretty(initial_pretty_hostname);
                    set_init_pretty(initial_pretty_hostname);
                });
    });

    function onPrettyChanged(value) {
        // Whenever the pretty host name has changed (e.g. the user has edited it), we compute a new
        // simple host name (e.g. 7bit ASCII, no special chars/spaces, lower case) from it

        set_pretty(value);

        if (update_from_pretty) {
            const old_hostname = hostname;
            const first_dot = old_hostname.indexOf(".");
            let new_hostname = value
                    .toLowerCase()
                    .replace(/['".]+/g, "")
                    .replace(/[^a-zA-Z0-9]+/g, "-");
            new_hostname = new_hostname.substr(0, 64);
            if (first_dot >= 0)
                new_hostname = new_hostname + old_hostname.substr(first_dot);
            set_hostname(new_hostname);
        }
    }

    function onHostnameChanged(value) {
        const error = [];
        if (value.length > 64)
            error.push(_("Real host name must be 64 characters or less"));
        if (value.match(/[.a-z0-9-]*/)[0] !== value || value.indexOf("..") !== -1)
            error.push(_("Real host name can only contain lower-case characters, digits, dashes, and periods (with populated subdomains)"));

        set_hostname(value);
        set_update_from_pretty(false);
        set_error(error);
    }

    function onSubmit(event) {
        const one = proxy.call("SetStaticHostname", [hostname, true]);
        const two = proxy.call("SetPrettyHostname", [pretty, true]);

        Promise.all([one, two]).then(Dialogs.close);

        if (event)
            event.preventDefault();
        return false;
    }

    const disabled = error.length || (init_hostname == hostname && init_pretty == pretty);
    return (
        <Modal isOpen position="top" variant="medium"
               onClose={Dialogs.close}
               id="system_information_change_hostname"
               title={_("Change host name")}
               footer={<>
                   <Button variant='primary' isDisabled={disabled} onClick={onSubmit}>{_("Change")}</Button>
                   <Button variant='link' onClick={Dialogs.close}>{_("Cancel")}</Button>
               </>}
        >
            <Form isHorizontal onSubmit={onSubmit}>
                <FormGroup fieldId="sich-pretty-hostname" label={_("Pretty host name")}>
                    <TextInput id="sich-pretty-hostname" value={pretty} onChange={(_event, value) => onPrettyChanged(value)} />
                </FormGroup>
                <FormGroup fieldId="sich-hostname" label={_("Real host name")}>
                    <TextInput id="sich-hostname" value={hostname} onChange={(_event, value) => onHostnameChanged(value)} validated={error.length ? "error" : "default"} />
                    {error.length > 0 && <FormHelperText>
                        <HelperText>
                            {error.map((err, i) =>
                                <HelperTextItem key={i} variant="error">
                                    {err}
                                </HelperTextItem>
                            )}
                        </HelperText>
                    </FormHelperText>}
                </FormGroup>
            </Form>
        </Modal>
    );
};
