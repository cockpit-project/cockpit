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
import {
    fmt_size, mdraid_name,
    get_available_spaces, available_space_to_option, prepare_available_spaces
} from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import dialog from "./dialog.js";

const _ = cockpit.gettext;

export class MDRaidsPanel extends React.Component {
    render() {
        var client = this.props.client;

        function create_mdraid() {
            dialog.open({ Title: _("Create RAID Device"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                              },
                              { SelectOne: "level",
                                Title: _("RAID Level"),
                                Options: [
                                    { value: "raid0", Title: _("RAID 0 (Stripe)") },
                                    { value: "raid1", Title: _("RAID 1 (Mirror)") },
                                    { value: "raid4", Title: _("RAID 4 (Dedicated Parity)") },
                                    { value: "raid5", Title: _("RAID 5 (Distributed Parity)"), selected: true },
                                    { value: "raid6", Title: _("RAID 6 (Double Distributed Parity)") },
                                    { value: "raid10", Title: _("RAID 10 (Stripe of Mirrors)") }
                                ]
                              },
                              { SelectOne: "chunk",
                                Title: _("Chunk Size"),
                                Options: [
                                    { value: "4", Title: _("4 KiB") },
                                    { value: "8", Title: _("8 KiB") },
                                    { value: "16", Title: _("16 KiB") },
                                    { value: "32", Title: _("32 KiB") },
                                    { value: "64", Title: _("64 KiB") },
                                    { value: "128", Title: _("128 KiB") },
                                    { value: "512", Title: _("512 KiB"), selected: true },
                                    { value: "1024", Title: _("1 MiB") },
                                    { value: "2048", Title: _("2 MiB") }
                                ],
                                visible: function (vals) {
                                    return vals.level != "raid1";
                                }
                              },
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: get_available_spaces(client).map(available_space_to_option),
                                EmptyWarning: _("No disks are available."),
                                validate: function (disks, vals) {
                                    var disks_needed = vals.level == "raid6" ? 4 : 2;
                                    if (disks.length < disks_needed)
                                        return cockpit.format(_("At least $0 disks are needed."),
                                                              disks_needed);
                                }
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals) {
                                  return prepare_available_spaces(client, vals.disks).then(function () {
                                      var paths = Array.prototype.slice.call(arguments);
                                      return client.manager.MDRaidCreate(paths, vals.level,
                                                                         vals.name, (vals.chunk || 0) * 1024,
                                                                         { });
                                  });
                              }
                          }
            });
        }

        function cmp_mdraid(path_a, path_b) {
            // TODO - ignore host part
            return client.mdraids[path_a].Name.localeCompare(client.mdraids[path_b].Name);
        }

        function make_mdraid(path) {
            var mdraid = client.mdraids[path];

            return (
                <OverviewSidePanelRow client={client}
                                      kind="array"
                                      name={mdraid_name(mdraid)}
                                      detail={fmt_size(mdraid.Size)}
                                      go={() => cockpit.location.go([ "mdraid", mdraid.UUID ])}
                                      job_path={path}
                                      key={path} />
            );
        }

        var mdraids = Object.keys(client.mdraids).sort(cmp_mdraid)
                .map(make_mdraid);

        var actions = (
            <StorageButton kind="primary" onClick={create_mdraid} id="create-mdraid">
                <span className="fa fa-plus" />
            </StorageButton>
        );

        return (
            <OverviewSidePanel id="mdraids"
                               title={_("RAID Devices")}
                               empty_text={_("No storage set up as RAID")}
                               actions={actions}>
                { mdraids }
            </OverviewSidePanel>
        );
    }
}
