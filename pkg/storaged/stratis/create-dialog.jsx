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
import client from "../client.js";

import { dialog_open, TextInput, CheckBoxes, PassInput, SelectSpaces } from "../dialog.jsx";
import { decode_filename, get_available_spaces, prepare_available_spaces } from "../utils.js";

import { validate_pool_name, std_reply, get_unused_keydesc, with_stored_passphrase, confirm_tang_trust } from "./utils.jsx";
import { validate_url, get_tang_adv } from "../crypto/tang.jsx";

const _ = cockpit.gettext;

function manager_create_pool(name, devs, key_desc, clevis_info) {
    // "clevis_info" is either falsy or an array with two elements:
    //
    //   [ pin, pin_config ]
    //
    // This array can be used directly with the (b(ss)) signature of
    // the r6 CreatePool call, but needs to be taken apart for the
    // a((bu)ss) signature of the r8 CreatePool call.

    if (client.stratis_interface_revision < 8) {
        let key_desc_arg = [false, ""];
        if (key_desc)
            key_desc_arg = [true, key_desc];
        let clevis_info_arg = [false, ["", ""]];
        if (clevis_info)
            clevis_info_arg = [true, clevis_info];
        return client.stratis_manager.CreatePool(name,
                                                 devs,
                                                 key_desc_arg,
                                                 clevis_info_arg);
    } else {
        const any_slot = [false, 0];
        const key_descs_arg = [];
        if (key_desc)
            key_descs_arg.push([any_slot, key_desc]);
        const clevis_infos_arg = [];
        if (clevis_info)
            clevis_infos_arg.push([any_slot, clevis_info[0], clevis_info[1]]);
        return client.stratis_manager.CreatePool(name,
                                                 devs,
                                                 key_descs_arg,
                                                 clevis_infos_arg,
                                                 [false, 0], // journal_size
                                                 [false, ""], // tag_spec
                                                 [false, false]); // allocate_superblock
    }
}

export function create_stratis_pool() {
    function find_pool(name) {
        for (const p in client.stratis_pools) {
            if (client.stratis_pools[p].Name == name)
                return client.stratis_pools[p];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = "pool" + i.toFixed();
        if (!find_pool(name))
            break;
    }

    dialog_open({
        Title: _("Create Stratis pool"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: name,
                          validate: name => validate_pool_name(null, name)
                      }),
            SelectSpaces("disks", _("Block devices"),
                         {
                             empty_warning: _("No block devices are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one block device is needed.");
                             },
                             spaces: get_available_spaces()
                         }),
            CheckBoxes("encrypt_pass", _("Options"),
                       {
                           fields: [
                               {
                                   tag: "on",
                                   title: _("Encrypt data with a passphrase"),
                               }
                           ],
                           nested_fields: [
                               PassInput("passphrase", _("Passphrase"),
                                         {
                                             validate: function (phrase) {
                                                 if (phrase === "")
                                                     return _("Passphrase cannot be empty");
                                             },
                                             visible: vals => vals.encrypt_pass.on,
                                             new_password: true
                                         }),
                               PassInput("passphrase2", _("Confirm"),
                                         {
                                             validate: function (phrase2, vals) {
                                                 if (phrase2 != vals.passphrase)
                                                     return _("Passphrases do not match");
                                             },
                                             visible: vals => vals.encrypt_pass.on,
                                             new_password: true
                                         })
                           ]
                       }),
            CheckBoxes("encrypt_tang", "",
                       {
                           fields: [
                               { tag: "on", title: _("Encrypt data with a Tang keyserver") }
                           ],
                           nested_fields: [
                               TextInput("tang_url", _("Keyserver address"),
                                         {
                                             validate: validate_url,
                                             visible: vals => vals.encrypt_tang && vals.encrypt_tang.on
                                         }),
                           ]
                       }),
            CheckBoxes("overprov", "",
                       {
                           value: { on: true },
                           fields: [
                               {
                                   tag: "on",
                                   title: _("Overprovisioning"),
                               }
                           ]
                       })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, vals.disks).then(function (paths) {
                    const devs = paths.map(p => decode_filename(client.blocks[p].PreferredDevice));

                    function create(key_desc, adv) {
                        let clevis_info = null;
                        if (adv)
                            clevis_info = ["tang", JSON.stringify({ url: vals.tang_url, adv })];
                        return manager_create_pool(vals.name, devs, key_desc, clevis_info)
                                .then(std_reply)
                                .then(result => {
                                    if (vals.overprov && !vals.overprov.on && result[0]) {
                                        const path = result[1][0];
                                        return client.wait_for(() => client.stratis_pools[path])
                                                .then(pool => {
                                                    return client.stratis_set_property(pool,
                                                                                       "Overprovisioning",
                                                                                       "b", false);
                                                });
                                    }
                                });
                    }

                    function create2(adv) {
                        if (vals.encrypt_pass.on) {
                            return get_unused_keydesc(client, vals.name)
                                    .then(keydesc => with_stored_passphrase(client, keydesc, vals.passphrase,
                                                                            () => create(keydesc, adv)));
                        } else {
                            return create(false, adv);
                        }
                    }

                    if (vals.encrypt_tang && vals.encrypt_tang.on) {
                        return get_tang_adv(vals.tang_url)
                                .then(adv => confirm_tang_trust(vals.tang_url, adv, () => create2(adv)));
                    } else {
                        return create2(false);
                    }
                });
            }
        }
    });
}
