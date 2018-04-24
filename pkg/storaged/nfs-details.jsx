/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import "polyfills";

import cockpit from "cockpit";
import React from "react";
import $ from "jquery";
import moment from "moment";

import dialog from "./dialog.js";
import format from "./format-dialog.jsx";
import { format_fsys_usage } from "./utils.js";

import { StdDetailsLayout } from "./details.jsx";
import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";

const _ = cockpit.gettext;

function nfs_busy_dialog(client,
    dialog_title,
    entry, error,
    action_title, action) {

    function show(users) {
        if (users.length === 0) {
            $('#error-popup-title').text(dialog_title);
            $('#error-popup-message').text(error.toString());
            $('#error-popup').modal('show');
        } else {
            let sessions = [ ], services = [ ];
            users.forEach((u) => {
                var since = moment.duration(-u.since * 1000).humanize(true);
                if (u.unit.endsWith(".scope")) {
                    sessions.push({ Name: u.desc, Command: u.cmd.substr(0, 200), Since: since });
                } else {
                    services.push({ Name: u.desc, Unit: u.unit, Since: since });
                }
            });

            dialog.open({ Title: dialog_title,
                          Teardown: {
                              HasSessions: sessions.length > 0,
                              Sessions: sessions,
                              HasServices: services.length > 0,
                              Services: services
                          },
                          Fields: [ ],
                          Action: users ? {
                              DangerButton: true,
                              Title: action_title,
                              action: function () {
                                  return action(users);
                              }
                          } : null
            });
        }
    }

    client.nfs.entry_users(entry)
            .done(function (users) {
                show(users);
            })
            .fail(function () {
                show([ ]);
            });
}

export function nfs_fstab_dialog(client, entry) {

    var server_to_check;

    function remote_choices(vals, setter) {
        if (vals.server == server_to_check)
            return;

        server_to_check = vals.server;
        setter([ ]);
        cockpit.spawn([ "showmount", "-e", "--no-headers", server_to_check ], { err: "message" })
                .done(function (output) {
                    var dirs = [ ];
                    output.split("\n").forEach(function (line) {
                        var d = line.split(" ")[0];
                        if (d)
                            dirs.push(d);
                    });
                    setter(dirs);
                })
                .fail(function (error) {
                    console.warn(error);
                });
    }

    var mount_options = entry ? entry.fields[3] : "defaults";
    var split_options = format.parse_options(mount_options == "defaults" ? "" : mount_options);
    var opt_auto = !format.extract_option(split_options, "noauto");
    var opt_ro = format.extract_option(split_options, "ro");
    var extra_options = format.unparse_options(split_options);

    function mounting_options(vals) {
        var opts = [ ];
        if (!vals.mount_auto)
            opts.push("noauto");
        if (vals.mount_ro)
            opts.push("ro");
        if (vals.mount_extra_options !== false)
            opts = opts.concat(format.parse_options(vals.mount_extra_options));
        return format.unparse_options(opts);
    }

    function show(busy) {
        dialog.open({ Title: entry ? _("NFS Mount") : _("New NFS Mount"),
                      Alerts: busy ? [ { Message: _("This NFS mount is in use and only its options can be changed.") } ] : null,
                      Fields: [
                          { TextInput: "server",
                            Title: _("Server Address"),
                            Value: entry ? entry.fields[0].split(":")[0] : "",
                            validate: function (val) {
                                if (val === "")
                                    return _("Server cannot be empty.");
                            },
                            disabled: busy
                          },
                          { ComboBox: "remote",
                            Title: _("Path on Server"),
                            Value: entry ? entry.fields[0].split(":")[1] : "",
                            Choices: remote_choices,
                            validate: function (val) {
                                if (val === "")
                                    return _("Path on server cannot be empty.");
                                if (val[0] !== "/")
                                    return _("Path on server must start with \"/\".");
                            },
                            disabled: busy
                          },
                          { TextInput: "dir",
                            Title: _("Local Mount Point"),
                            Value: entry ? entry.fields[1] : "",
                            validate: function (val) {
                                if (val === "")
                                    return _("Mount point cannot be empty.");
                                if (val[0] !== "/")
                                    return _("Mount point must start with \"/\".");
                            },
                            disabled: busy
                          },
                          { RowTitle: _("Mount Options"),
                            CheckBox: "mount_auto",
                            Title: _("Mount at boot"),
                            Value: opt_auto
                          },
                          { CheckBox: "mount_ro",
                            Title: _("Mount read only"),
                            Value: opt_ro
                          },
                          { CheckBoxText: "mount_extra_options",
                            Title: _("Custom mount option"),
                            Value: extra_options === "" ? false : extra_options,
                          }
                      ],
                      Action: {
                          Title: entry ? _("Apply") : _("Add"),
                          action: function (vals) {
                              var location = cockpit.location;
                              var fields = [ vals.server + ":" + vals.remote,
                                  vals.dir,
                                  entry ? entry.fields[2] : "nfs",
                                  mounting_options(vals) || "defaults" ];
                              if (entry) {
                                  return client.nfs.update_entry(entry, fields)
                                          .done(function () {
                                              if (entry.fields[0] != fields[0] || entry.fields[1] != fields[1])
                                                  location.go([ "nfs", fields[0], fields[1] ]);
                                          });
                              } else
                                  return client.nfs.add_entry(fields);
                          }
                      }
        });
    }

    if (entry) {
        client.nfs.entry_users(entry)
                .done(function (users) {
                    show(users.length > 0);
                })
                .fail(function () {
                    show(false);
                });
    } else
        show(false);
}

export class NFSDetails extends React.Component {
    render() {
        var client = this.props.client;
        var entry = this.props.entry;
        var fsys_size;
        if (entry.mounted)
            fsys_size = client.nfs.get_fsys_size(entry);

        function checked(error_title, promise) {
            promise.fail(function (error) {
                $('#error-popup-title').text(error_title);
                $('#error-popup-message').text(error.toString());
                $('#error-popup').modal('show');
            });
        }

        function mount() {
            checked("Could not mount the filesystem",
                    client.nfs.mount_entry(entry));
        }

        function unmount() {
            var location = cockpit.location;
            client.nfs.unmount_entry(entry)
                    .done(function () {
                        if (!entry.fstab)
                            location.go("/");
                    })
                    .fail(function (error) {
                        nfs_busy_dialog(client,
                                        _("Unable to unmount filesystem"),
                                        entry, error,
                                        _("Stop and Unmount"),
                                        function (users) {
                                            return client.nfs.stop_and_unmount_entry(users, entry)
                                                    .done(function () {
                                                        if (!entry.fstab)
                                                            location.go("/");
                                                    });
                                        });
                    });
        }

        function edit() {
            nfs_fstab_dialog(client, entry);
        }

        function remove() {
            var location = cockpit.location;
            client.nfs.remove_entry(entry)
                    .done(function () {
                        location.go("/");
                    })
                    .fail(function (error) {
                        nfs_busy_dialog(client,
                                        _("Unable to remove mount"),
                                        entry, error,
                                        _("Stop and remove"),
                                        function (users) {
                                            return client.nfs.stop_and_remove_entry(users, entry)
                                                    .done(function () {
                                                        location.go("/");
                                                    });
                                        });
                    });
        }

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">
                    {entry.fields[0]}
                    <span className="pull-right">
                        { entry.mounted
                            ? <StorageButton onClick={unmount}>{_("Unmount")}</StorageButton>
                            : <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                        }
                        { "\n" }
                        { entry.fstab
                            ? [
                                <StorageButton onClick={edit}>{_("Edit")}</StorageButton>,
                                "\n",
                                <StorageButton onClick={remove} kind="danger">{_("Remove")}</StorageButton>
                            ] : null
                        }
                    </span>
                </div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Server")}</td>
                            <td>{entry.fields[0]}</td>
                        </tr>
                        <tr>
                            <td>{_("Mount Point")}</td>
                            <td>{entry.fields[1]}</td>
                        </tr>
                        <tr>
                            <td>{_("Size")}</td>
                            <td>
                                { entry.mounted
                                    ? <StorageUsageBar stats={fsys_size} critical={0.95}/>
                                    : _("--")
                                }
                            </td>
                            <td>
                                { entry.mounted && fsys_size
                                    ? format_fsys_usage(fsys_size[0], fsys_size[1])
                                    : null
                                }
                            </td>
                        </tr>
                    </table>
                </div>
            </div>
        );

        return <StdDetailsLayout client={client} header={header}/>;
    }
}
