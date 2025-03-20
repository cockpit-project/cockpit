/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import cockpit from "cockpit";
import client from "../client";

import {
    mdraid_name, validate_mdraid_name, get_available_spaces, prepare_available_spaces,
    encode_filename, decode_filename
} from "../utils.js";
import { dialog_open, TextInput, SelectOne, SelectSpaces } from "../dialog.jsx";

const _ = cockpit.gettext;

async function mdraid_create(members, level, name, chunk, metadata_version) {
    if (!metadata_version || client.at_least("2.11")) {
        const opts = { };
        if (metadata_version)
            opts.version = { t: "ay", v: encode_filename(metadata_version) };
        await client.manager.MDRaidCreate(members, level, name, chunk, opts);
    } else {
        // Let's call mdadm explicitly if we need to set the metadata
        // version and UDisks2 is older than 2.11.

        // The member block devices are all empty already and we don't
        // need to wipe them.  We need to wait for their D-Bus proxies
        // since they might have just been created by
        // prepare_available_spaces.

        const devs = [];
        for (const path of members) {
            devs.push(decode_filename((await client.wait_for(() => client.blocks[path])).PreferredDevice));
        }

        await cockpit.spawn([
            "mdadm", "--create", name, "--run",
            "--level=" + level,
            ...(chunk ? ["--chunk=" + String(chunk / 1024)] : []),
            "--metadata=" + metadata_version,
            "--raid-devices=" + String(devs.length),
            ...devs
        ], { superuser: "require", err: "message" });
    }
}

export function create_mdraid() {
    function mdraid_exists(name) {
        for (const p in client.mdraids) {
            if (mdraid_name(client.mdraids[p]) == name)
                return true;
        }
        return false;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = "raid" + i.toFixed();
        if (!mdraid_exists(name))
            break;
    }

    dialog_open({
        Title: _("Create RAID device"),
        Fields: [
            TextInput("name", _("Name"), {
                value: name,
                validate: validate_mdraid_name,
            }),
            SelectOne("level", _("RAID level"),
                      {
                          value: "raid5",
                          choices: [
                              {
                                  value: "raid0",
                                  title: _("RAID 0 (stripe)")
                              },
                              {
                                  value: "raid1",
                                  title: _("RAID 1 (mirror)")
                              },
                              {
                                  value: "raid4",
                                  title: _("RAID 4 (dedicated parity)")
                              },
                              {
                                  value: "raid5",
                                  title: _("RAID 5 (distributed parity)")
                              },
                              {
                                  value: "raid6",
                                  title: _("RAID 6 (double distributed parity)")
                              },
                              {
                                  value: "raid10",
                                  title: _("RAID 10 (stripe of mirrors)")
                              }
                          ]
                      }),
            SelectOne("chunk", _("Chunk size"),
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
                                 const disks_needed = vals.level == "raid6" ? 4 : 2;
                                 if (disks.length < disks_needed)
                                     return cockpit.format(cockpit.ngettext("At least $0 disk is needed.", "At least $0 disks are needed.", disks_needed),
                                                           disks_needed);
                             },
                             spaces: get_available_spaces(client)
                         })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                // When in Anaconda mode, we explicitly use metadata
                // version 1.0 since the default doesn't work for
                // things that the bootloaders need to access.
                //
                const metadata_version = client.in_anaconda_mode() ? "1.0" : null;

                return prepare_available_spaces(client, vals.disks).then(paths => {
                    return mdraid_create(paths, vals.level, vals.name, (vals.chunk || 0) * 1024, metadata_version);
                });
            }
        }
    });
}
