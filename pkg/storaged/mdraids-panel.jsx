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

import { OverviewSidePanelRow } from "./overview.jsx";
import {
    fmt_size, mdraid_name, block_name,
    get_available_spaces, prepare_available_spaces
} from "./utils.js";
import { dialog_open, TextInput, SelectOne, SelectSpaces } from "./dialog.jsx";

const _ = cockpit.gettext;

const MDRaidRow = ({ client, path }) => {
    const mdraid = client.mdraids[path];
    const block = client.mdraids_block[path];

    return (
        <OverviewSidePanelRow client={client}
                              kind="array"
                              name={mdraid_name(mdraid)}
                              devname={block && block_name(block)}
                              detail={fmt_size(mdraid.Size) + " " + _("RAID Device")}
                              go={() => cockpit.location.go(["mdraid", mdraid.UUID])}
                              job_path={path} />
    );
};

export function mdraid_rows(client) {
    function cmp_mdraid(path_a, path_b) {
        // TODO - ignore host part
        return client.mdraids[path_a].Name.localeCompare(client.mdraids[path_b].Name);
    }

    return Object.keys(client.mdraids).sort(cmp_mdraid)
            .map(p => <MDRaidRow key={p} client={client} path={p} />);
}

export function create_mdraid(client) {
    dialog_open({
        Title: _("Create RAID Device"),
        Fields: [
            TextInput("name", _("Name"), { }),
            SelectOne("level", _("RAID Level"),
                      {
                          value: "raid5",
                          choices: [
                              {
                                  value: "raid0",
                                  title: _("RAID 0 (Stripe)")
                              },
                              {
                                  value: "raid1",
                                  title: _("RAID 1 (Mirror)")
                              },
                              {
                                  value: "raid4",
                                  title: _("RAID 4 (Dedicated Parity)")
                              },
                              {
                                  value: "raid5",
                                  title: _("RAID 5 (Distributed Parity)")
                              },
                              {
                                  value: "raid6",
                                  title: _("RAID 6 (Double Distributed Parity)")
                              },
                              {
                                  value: "raid10",
                                  title: _("RAID 10 (Stripe of Mirrors)")
                              }
                          ]
                      }),
            SelectOne("chunk", _("Chunk Size"),
                      {
                          value: "512",
                          visible: function (vals) {
                              return vals.level != "raid1";
                          },
                          choices: [
                              { value: "4", title: _("4 KiB") },
                              { value: "8", title: _("8 KiB") },
                              { value: "16", title: _("16 KiB") },
                              { value: "32", title: _("32 KiB") },
                              { value: "64", title: _("64 KiB") },
                              { value: "128", title: _("128 KiB") },
                              { value: "512", title: _("512 KiB") },
                              { value: "1024", title: _("1 MiB") },
                              { value: "2048", title: _("2 MiB") }
                          ]
                      }),
            SelectSpaces("disks", _("Disks"),
                         {
                             empty_warning: _("No disks are available."),
                             validate: function (disks, vals) {
                                 var disks_needed = vals.level == "raid6" ? 4 : 2;
                                 if (disks.length < disks_needed)
                                     return cockpit.format(_("At least $0 disks are needed."),
                                                           disks_needed);
                             },
                             spaces: get_available_spaces(client)
                         })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, vals.disks).then(paths => {
                    return client.manager.MDRaidCreate(paths, vals.level,
                                                       vals.name, (vals.chunk || 0) * 1024,
                                                       { });
                });
            }
        }
    });
}
