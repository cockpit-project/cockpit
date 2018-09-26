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

import { OverviewSidePanel, OverviewSidePanelRow } from "./overview.jsx";
import { } from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import { dialog_open, TextInput, PassInput, SelectRow } from "./dialogx.jsx";

const _ = cockpit.gettext;

export class IscsiPanel extends React.Component {
    constructor() {
        super();
        this.state = { armed: false };
    }

    render() {
        var self = this;
        var client = this.props.client;

        function iscsi_discover() {
            dialog_open({ Title: _("Add iSCSI Portal"),
                          Fields: [
                              TextInput("address", _("Server Address"),
                                        { validate: val => val === "" ? _("Server address cannot be empty.") : null,
                                        }),
                              TextInput("username", _("Username"), { }),
                              PassInput("password", _("Password"), { })
                          ],
                          Action: {
                              Title: _("Next"),
                              action: function (vals, progress_callback) {
                                  var dfd = cockpit.defer();

                                  var options = { };
                                  if (vals.username || vals.password) {
                                      options.username = { t: 's', v: vals.username };
                                      options.password = { t: 's', v: vals.password };
                                  }

                                  var cancelled = false;
                                  client.manager_iscsi.call('DiscoverSendTargets',
                                                            [ vals.address,
                                                                0,
                                                                options
                                                            ])
                                          .done(function (results) {
                                              if (!cancelled) {
                                                  dfd.resolve();
                                                  iscsi_add(vals, results[0]);
                                              }
                                          })
                                          .fail(function (error) {
                                              if (cancelled)
                                                  return;

                                              // HACK - https://github.com/storaged-project/storaged/issues/26
                                              if (error.message.indexOf("initiator failed authorization") != -1)
                                                  error = {
                                                      "username": true, // make it red without text below
                                                      "password": _("Invalid username or password")
                                                  };
                                              else if (error.message.indexOf("cannot resolve host name") != -1)
                                                  error = {
                                                      "address": _("Unknown host name")
                                                  };
                                              else if (error.message.indexOf("connection login retries") != -1)
                                                  error = {
                                                      "address": _("Unable to reach server")
                                                  };

                                              dfd.reject(error);
                                          });

                                  progress_callback(null, function () {
                                      cancelled = true;
                                      dfd.reject();
                                  });

                                  return dfd.promise();
                              }
                          }
            });
        }

        function iscsi_login(target, cred_vals) {
            var options = {
                'node.startup': { t: 's', v: "automatic" }
            };
            if (cred_vals.username || cred_vals.password) {
                options.username = { t: 's', v: cred_vals.username };
                options.password = { t: 's', v: cred_vals.password };
            }
            return client.manager_iscsi.call('Login',
                                             [ target[0],
                                                 target[1],
                                                 target[2],
                                                 target[3],
                                                 target[4],
                                                 options
                                             ]);
        }

        function iscsi_add(discover_vals, nodes) {
            dialog_open({ Title: cockpit.format(_("Available targets on $0"),
                                                discover_vals.address),
                          Fields: [
                              SelectRow("target", [ _("Name"), _("Address"), _("Port") ],
                                        { choices: nodes.map(n => ({ columns: [ n[0], n[2], n[3] ],
                                                                     value: n })) })
                          ],
                          Action: {
                              Title: _("Add"),
                              action: function (vals) {
                                  return iscsi_login(vals.target, discover_vals)
                                          .catch(err => {
                                              if (err.message.indexOf("authorization") != -1)
                                                  iscsi_add_with_creds(discover_vals, vals);
                                              else
                                                  return cockpit.reject(err);
                                          });
                              }
                          }
            });
        }

        function iscsi_add_with_creds(discover_vals, login_vals) {
            dialog_open({ Title: _("Authentication required"),
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
                                              // HACK - https://github.com/storaged-project/storaged/issues/26
                                              if (err.message.indexOf("authorization") != -1)
                                                  err = {
                                                      "username": true, // makes it red without text below
                                                      "password": _("Invalid username or password")
                                                  };
                                              return cockpit.reject(err);
                                          });
                              }
                          }
            });
        }

        function iscsi_change_name() {
            client.manager_iscsi.call('GetInitiatorName')
                    .done(function (results) {
                        var name = results[0];
                        dialog_open({ Title: _("Change iSCSI Initiator Name"),
                                      Fields: [
                                          TextInput("name", _("Name"), { value: name })
                                      ],
                                      Action: {
                                          Title: _("Change"),
                                          action: function (vals) {
                                              return client.manager_iscsi.call('SetInitiatorName',
                                                                               [ vals.name,
                                                                                   { }
                                                                               ]);
                                          }
                                      }
                        });
                    });
        }

        function cmp_session(path_a, path_b) {
            var a = client.iscsi_sessions[path_a];
            var b = client.iscsi_sessions[path_b];
            var a_name = a.data["target_name"] || "";
            var b_name = b.data["target_name"] || "";

            return a_name.localeCompare(b_name);
        }

        function make_session(path) {
            var session = client.iscsi_sessions[path];

            function iscsi_remove() {
                self.setState({ armed: false });
                return session.Logout({ 'node.startup': { t: 's', v: "manual" } });
            }

            var actions = null;
            if (self.state.armed)
                actions = (
                    <StorageButton kind="danger" onClick={iscsi_remove}>
                        <span className="pficon pficon-delete" />
                    </StorageButton>
                );

            return (
                <OverviewSidePanelRow client={client}
                                      kind="array"
                                      name={session.data["target_name"] || ""}
                                      detail={session.data["persistent_address"] + ":" +
                                              session.data["persistent_port"]}
                                      actions={actions}
                                      key={path} />
            );
        }

        const toggle_armed = (event) => {
            if (!event || event.button !== 0)
                return;
            this.setState({ armed: !this.state.armed });
        };

        var sessions = Object.keys(client.iscsi_sessions).sort(cmp_session)
                .map(make_session);

        var actions = [
            sessions.length > 0
                ? <button key="armed" className={"btn btn-default fa fa-check" + (this.state.armed ? " active" : "")}
                    onClick={toggle_armed} /> : null,
            "\n",
            <StorageButton key="edit-iscsi" onClick={iscsi_change_name} id="edit-iscsi">
                <span className="pficon pficon-edit" />
            </StorageButton>,
            "\n",
            <StorageButton key="add-iscsi-portal" kind="primary" onClick={iscsi_discover} id="add-iscsi-portal">
                <span className="fa fa-plus" />
            </StorageButton>
        ];

        var iscsi_feature = {
            is_enabled: () => client.features.iscsi
        };

        return (
            <OverviewSidePanel id="iscsi-sessions"
                               title={_("iSCSI Targets")}
                               empty_text={_("No iSCSI targets set up")}
                               hover={false}
                               actions={actions}
                               client={client}
                               feature={iscsi_feature}>
                { sessions }
            </OverviewSidePanel>
        );
    }
}
