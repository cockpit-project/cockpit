/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import React from "react";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CheckIcon, EditIcon, PlusIcon, TrashIcon } from "@patternfly/react-icons";

import { SidePanel } from "./side-panel.jsx";
import { } from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import { dialog_open, TextInput, PassInput, SelectRow } from "./dialog.jsx";

const _ = cockpit.gettext;

export class IscsiPanel extends React.Component {
    constructor() {
        super();
        this.state = { armed: false };
    }

    render() {
        const self = this;
        const client = this.props.client;

        function iscsi_discover() {
            dialog_open({
                Title: _("Add iSCSI portal"),
                Fields: [
                    TextInput("address", _("Server address"),
                              { validate: val => val === "" ? _("Server address cannot be empty.") : null, }),
                    TextInput("username", _("Username"), { }),
                    PassInput("password", _("Password"), { })
                ],
                Action: {
                    Title: _("Next"),
                    action: (vals, progress_callback) => new Promise((resolve, reject) => {
                        const options = { };
                        if (vals.username || vals.password) {
                            options.username = { t: 's', v: vals.username };
                            options.password = { t: 's', v: vals.password };
                        }

                        let cancelled = false;
                        client.manager_iscsi.call('DiscoverSendTargets',
                                                  [vals.address,
                                                      0,
                                                      options
                                                  ])
                                .then(function (results) {
                                    if (!cancelled) {
                                        resolve();
                                        iscsi_add(vals, results[0]);
                                    }
                                })
                                .catch(function (error) {
                                    if (cancelled)
                                        return;

                                    // HACK - https://github.com/storaged-project/udisks/issues/26
                                    if (error.message.indexOf("initiator failed authorization") != -1)
                                        error = {
                                            username: true, // make it red without text below
                                            password: _("Invalid username or password")
                                        };
                                    else if (error.message.indexOf("cannot resolve host name") != -1)
                                        error = {
                                            address: _("Unknown host name")
                                        };
                                    else if (error.message.indexOf("connection login retries") != -1)
                                        error = {
                                            address: _("Unable to reach server")
                                        };

                                    reject(error);
                                });

                        progress_callback(null, function () {
                            cancelled = true;
                            reject();
                        });
                    }),
                }
            });
        }

        function iscsi_login(target, cred_vals) {
            const options = {
                'node.startup': { t: 's', v: "automatic" }
            };
            if (cred_vals.username || cred_vals.password) {
                options.username = { t: 's', v: cred_vals.username };
                options.password = { t: 's', v: cred_vals.password };
            }
            return client.manager_iscsi.call('Login',
                                             [target[0],
                                                 target[1],
                                                 target[2],
                                                 target[3],
                                                 target[4],
                                                 options
                                             ]);
        }

        function iscsi_add(discover_vals, nodes) {
            dialog_open({
                Title: cockpit.format(_("Available targets on $0"),
                                      discover_vals.address),
                Fields: [
                    SelectRow("target", [_("Name"), _("Address"), _("Port")],
                              {
                                  choices: nodes.map(n => ({
                                      columns: [n[0], n[2], n[3]],
                                      value: n
                                  }))
                              })
                ],
                Action: {
                    Title: _("Add"),
                    action: function (vals) {
                        return iscsi_login(vals.target, discover_vals)
                                .catch(err => {
                                    if (err.message.indexOf("authorization") != -1)
                                        iscsi_add_with_creds(discover_vals, vals);
                                    else
                                        return Promise.reject(err);
                                });
                    }
                }
            });
        }

        function iscsi_add_with_creds(discover_vals, login_vals) {
            dialog_open({
                Title: _("Authentication required"),
                Fields: [
                    TextInput("username", _("Username"),
                              { value: discover_vals.username }),
                    PassInput("password", _("Password"),
                              { value: discover_vals.password })
                ],
                Action: {
                    Title: _("Add"),
                    action: function (vals) {
                        return iscsi_login(login_vals.target, vals)
                                .catch(err => {
                                    // HACK - https://github.com/storaged-project/udisks/issues/26
                                    if (err.message.indexOf("authorization") != -1)
                                        err = {
                                            username: true, // makes it red without text below
                                            password: _("Invalid username or password")
                                        };
                                    return Promise.reject(err);
                                });
                    }
                }
            });
        }

        function iscsi_change_name() {
            client.manager_iscsi.call('GetInitiatorName')
                    .then(function (results) {
                        const name = results[0];
                        dialog_open({
                            Title: _("Change iSCSI initiator name"),
                            Fields: [
                                TextInput("name", _("Name"), { value: name })
                            ],
                            Action: {
                                Title: _("Change"),
                                action: function (vals) {
                                    return client.manager_iscsi.call('SetInitiatorName',
                                                                     [vals.name,
                                                                         { }
                                                                     ]);
                                }
                            }
                        });
                    });
        }

        function cmp_session(path_a, path_b) {
            const a = client.iscsi_sessions[path_a];
            const b = client.iscsi_sessions[path_b];
            const a_name = a.data.target_name || "";
            const b_name = b.data.target_name || "";

            return a_name.localeCompare(b_name);
        }

        function make_session(path) {
            const session = client.iscsi_sessions[path];

            function iscsi_remove() {
                self.setState({ armed: false });
                return session.Logout({ 'node.startup': { t: 's', v: "manual" } });
            }

            let actions = null;
            if (self.state.armed)
                actions = (
                    <StorageButton kind="danger" onClick={iscsi_remove}>
                        <TrashIcon className="ct-TrashIcon" />
                    </StorageButton>
                );

            return {
                client,
                actions,
                kind: "array",
                name: session.data.target_name || "",
                key: path,
                detail: session.data.persistent_address + ":" + session.data.persistent_port
            };
        }

        const toggle_armed = (event) => {
            if (!event || event.button !== 0)
                return;
            this.setState(prevState => ({ armed: !prevState.armed }));
        };

        const sessions = Object.keys(client.iscsi_sessions).sort(cmp_session)
                .map(make_session);

        const actions = (
            <>
                { sessions.length > 0
                    ? <Button aria-label={_("Toggle")} variant="secondary" className={"toggle-armed" + (this.state.armed ? " active" : "")}
                  onClick={toggle_armed}><CheckIcon /></Button>
                    : null
                }
                { "\n" }
                <StorageButton ariaLabel={_("Edit")} onClick={iscsi_change_name} id="edit-iscsi">
                    <EditIcon />
                </StorageButton>
                { "\n" }
                <StorageButton ariaLabel={_("Add")} kind="primary" onClick={iscsi_discover} id="add-iscsi-portal">
                    <PlusIcon />
                </StorageButton>
            </>
        );

        const iscsi_feature = {
            is_enabled: () => client.features.iscsi
        };

        return (
            <SidePanel id="iscsi-sessions"
                       title={_("iSCSI targets")}
                       empty_text={_("No iSCSI targets set up")}
                       hover={false}
                       actions={actions}
                       client={client}
                       feature={iscsi_feature}
                       rows={sessions} />
        );
    }
}
