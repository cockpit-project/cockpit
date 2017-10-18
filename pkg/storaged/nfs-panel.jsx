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
import $ from "jquery";

import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";
import { format_fsys_usage } from "./utils.js";
import dialog from "./dialog.js";
import format from "./format-dialog.jsx";

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
            dialog.open({ Title: dialog_title,
                          Teardown: {
                              HasUnits: true,
                              Units: users.map(function (u) { return { Unit: u.unit, Name: u.desc }; })
                          },
                          Fields: [ ],
                          Action: users? {
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

function nfs_fstab_dialog(client, entry) {

    var server_to_check;
    var server_check_deferred;

    function remote_choices(vals) {
        if (vals.server == server_to_check)
            return false;

        server_to_check = vals.server;
        if (server_check_deferred)
            server_check_deferred.resolve(false);

        var this_deferred = cockpit.defer();
        server_check_deferred = this_deferred;

        cockpit.spawn([ "showmount", "-e", "--no-headers", server_to_check ], { err: "message" })
               .done(function (output) {
                   if (this_deferred == server_check_deferred) {
                       var dirs = [ ];
                       output.split("\n").forEach(function (line) {
                           var d = line.split(" ")[0];
                           if (d)
                               dirs.push(d);
                       });
                       this_deferred.resolve(dirs);
                       server_check_deferred = null;
                   } else {
                       this_deferred.resolve(false);
                   }
               }).
                fail(function (error) {
                    console.warn(error);
                    this_deferred.resolve([ ]);
                });

        return this_deferred.promise();
    }

    var mount_options = entry? entry.fields[3] : "defaults";
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
        dialog.open({ Title: entry? _("NFS Mount") : _("New NFS Mount"),
                      Alerts: busy? [ { Message: _("This NFS mount is in use and only its options can be changed.") } ] : null,
                      Fields: [
                          { TextInput: "server",
                            Title: _("Server Address"),
                            Value: entry? entry.fields[0].split(":")[0] : "",
                            validate: function (val) {
                                if (val === "")
                                    return _("Server cannot be empty.");
                            },
                            disabled: busy
                          },
                          { ComboBox: "remote",
                            Title: _("Path on Server"),
                            Value: entry? entry.fields[0].split(":")[1] : "",
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
                            Value: entry? entry.fields[1] : "",
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
                          Title: entry? _("Apply") : _("Add"),
                          action: function (vals) {
                              var fields = [ vals.server + ":" + vals.remote,
                                             vals.dir,
                                             entry? entry.fields[2]: "nfs",
                                             mounting_options(vals) || "defaults" ];
                              if (entry)
                                  return client.nfs.update_entry(entry, fields);
                              else
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

export class NFSPanel extends React.Component {
    constructor() {
        super();
        this.state = { armed: false };
    }

    render() {
        var self = this;
        var client = this.props.client;

        function checked(error_title, promise) {
            promise.fail(function (error) {
                $('#error-popup-title').text(error_title);
                $('#error-popup-message').text(error.toString());
                $('#error-popup').modal('show');
            });
        }

        function make_nfs_mount(entry) {
            var fsys_size;
            if (entry.mounted)
                fsys_size = client.nfs.get_fsys_size(entry);

            var server = entry.fields[0].split(":")[0];
            var remote_dir = entry.fields[0].split(":")[1];

            function mount() {
                checked("Could not mount the filesystem",
                        client.nfs.mount_entry(entry));
                self.setState({ armed: false });
            }

            function unmount() {
                client.nfs.unmount_entry(entry)
                    .fail(function (error) {
                        nfs_busy_dialog(client,
                                        _("Unable to unmount filesystem"),
                                        entry, error,
                                        _("Stop and unmount"),
                                        function (users) {
                                            return client.nfs.stop_and_unmount_entry(users, entry);
                                        });
                    });
                self.setState({ armed: false });
            }

            function edit() {
                nfs_fstab_dialog(client, entry);
                self.setState({ armed: false });
            }

            function remove() {
                client.nfs.remove_entry(entry)
                      .fail(function (error) {
                          nfs_busy_dialog(client,
                                          _("Unable to remove mount"),
                                          entry, error,
                                          _("Stop and remove"),
                                          function (users) {
                                              return client.nfs.stop_and_remove_entry(users, entry);
                                          });
                      });
                self.setState({ armed: false });
            }

            return (
                <tr>
                    <td>{ server + " " + remote_dir }</td>
                    <td>{ entry.fields[1] }</td>
                    {
                        self.state.armed ?
                        [
                            <td className="text-right">
                                { entry.mounted ?
                                  <StorageButton onClick={unmount}>{_("Unmount")}</StorageButton>
                                  : <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                                }
                                { "\n" }
                                { entry.fstab ?
                                  [ <StorageButton onClick={edit}>
                                      <span className="pficon pficon-edit"/>
                                    </StorageButton>,
                                    "\n",
                                    <StorageButton kind="danger" onClick={remove}>
                                        <span className="pficon pficon-delete"/>
                                    </StorageButton>
                                  ]
                                : null
                                }
                            </td>
                        ]
                        : [
                            <td>
                                { entry.mounted ?
                                  <StorageUsageBar stats={fsys_size} critical={0.95}/>
                                  : _("Not mounted")
                                }
                            </td>,
                            <td className="usage-text">
                                { entry.mounted && fsys_size ?
                                  format_fsys_usage(fsys_size[0], fsys_size[1])
                                      : ""
                                }
                            </td>
                        ]
                    }
                </tr>
            );
        }

        var mounts = client.nfs.entries.map(make_nfs_mount);

        const toggle_armed = (event) => {
            if (!event || event.button !== 0)
                return;
            this.setState({ armed: !this.state.armed });
        }

        function add() {
            nfs_fstab_dialog(client, null);
        }

        return (
            <div className="panel panel-default storage-mounts" id="nfs-mounts">
                <div className="panel-heading">
                    <span className="pull-right">
                        { mounts.length > 0 ?
                          <button className={"btn btn-default fa fa-check" + (this.state.armed? " active" : "")}
                                  onClick={toggle_armed}/>
                          : null
                        }
                        { "\n" }
                        <StorageButton kind="primary" onClick={add}>
                          <span className="fa fa-plus"/>
                        </StorageButton>
                    </span>
                    <span>{_("NFS Mounts")}</span>
                </div>
                { mounts.length > 0 ?
                  <table className="table">
                      <thead>
                          <tr>
                              <th className="mount-name">{_("Server")}</th>
                              <th className="mount-point">{_("Mount Point")}</th>
                              {
                                  this.state.armed ?
                                  [
                                      <th className="mount-actions">&nbsp;</th>
                                  ]
                                  : [
                                      <th className="mount-size-graph">{_("Size")}</th>,
                                      <th className="mount-size-number">&nbsp;</th>
                                  ]
                              }
                          </tr>
                      </thead>
                      <tbody>
                          { mounts }
                      </tbody>
                  </table>
                  : <div className="empty-panel-text">{_("No NFS mounts set up")}</div>
                }
            </div>
        );
    }
}
