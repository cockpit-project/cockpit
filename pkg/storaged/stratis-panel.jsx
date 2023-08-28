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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";

import { dialog_open, TextInput, CheckBoxes, PassInput, SelectSpaces } from "./dialog.jsx";
import {
    decode_filename, fmt_size,
    get_available_spaces, prepare_available_spaces,
} from "./utils.js";
import { validate_pool_name, start_pool } from "./stratis-details.jsx";
import { StorageButton } from "./storage-controls.jsx";
import { PlayIcon } from "@patternfly/react-icons";

import { std_reply, get_unused_keydesc, with_stored_passphrase, confirm_tang_trust } from "./stratis-utils.js";
import { validate_url, get_tang_adv } from "./crypto-keyslots.jsx";

const _ = cockpit.gettext;

export function stratis_feature(client) {
    return {
        is_enabled: () => client.features.stratis,
        package: client.get_config("stratis_package", false),
        enable: () => {
            return cockpit.spawn(["systemctl", "start", "stratisd"], { superuser: true })
                    .then(() => client.stratis_start());
        },

        dialog_options: {
            title: _("Install Stratis support"),
            text: _("The $0 package must be installed to create Stratis pools.")
        }
    };
}

function stratis_pool_row(client, path) {
    const pool = client.stratis_pools[path];

    return {
        client,
        name: pool.Name,
        hasWarning: pool.AvailableActions && pool.AvailableActions !== "fully_operational",
        key: path,
        devname: "/dev/stratis/" + pool.Name + "/",
        detail: cockpit.format(_("$0 Stratis pool"), fmt_size(pool.TotalPhysicalSize)),
        go: () => cockpit.location.go(["pool", pool.Uuid]),
        job_path: path
    };
}

function stratis_stopped_pool_row(client, uuid) {
    const action = <StorageButton ariaLabel={_("Start pool")} onClick={() => start_pool(client, uuid, true)}><PlayIcon /></StorageButton>;

    return {
        client,
        actions: action,
        name: uuid,
        key: uuid,
        truncate_name: false,
        detail: _("Stopped Stratis pool"),
        go: () => cockpit.location.go(["pool", uuid])
    };
}

export function stratis_rows(client, options) {
    function cmp_pool(path_a, path_b) {
        return client.stratis_pools[path_a].Name.localeCompare(client.stratis_pools[path_b].Name);
    }

    function cmp_stopped_pool(uuid_a, uuid_b) {
        return uuid_a.localeCompare(uuid_b);
    }

    const pools = Object.keys(client.stratis_pools).sort(cmp_pool)
            .map(p => stratis_pool_row(client, p));

    const stopped_pools = Object.keys(client.stratis_manager.StoppedPools).sort(cmp_stopped_pool)
            .map(uuid => stratis_stopped_pool_row(client, uuid));

    return pools.concat(stopped_pools);
}

export function create_stratis_pool(client) {
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
                          validate: name => validate_pool_name(client, null, name)
                      }),
            SelectSpaces("disks", _("Block devices"),
                         {
                             empty_warning: _("No block devices are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one block device is needed.");
                             },
                             spaces: get_available_spaces(client)
                         }),
            CheckBoxes("encrypt_pass", client.features.stratis_crypto_binding ? _("Options") : "",
                       {
                           fields: [
                               {
                                   tag: "on",
                                   title: (client.features.stratis_crypto_binding
                                       ? _("Encrypt data with a passphrase")
                                       : _("Encrypt data"))
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
                           visible: () => client.features.stratis_crypto_binding,
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
            CheckBoxes("managed", "",
                       {
                           visible: () => client.features.stratis_managed_fsys_sizes,
                           fields: [
                               {
                                   tag: "on",
                                   title: _("Manage filesystem sizes"),
                                   tooltip: _("When this option is checked, the new pool will not allow overprovisioning. You need to specify a maximum size for each filesystem that is created in the pool. Filesystems can not be made larger after creation. Snapshots are fully allocated on creation. The sum of all maximum sizes can not exceed the size of the pool. The advantage of this is that filesystems in this pool can not run out of space in a surprising way. The disadvantage is that you need to know the maximum size for each filesystem in advance and creation of snapshots is limited.")
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
                        return client.stratis_create_pool(vals.name, devs, key_desc, clevis_info)
                                .then(std_reply)
                                .then(result => {
                                    if (vals.managed && vals.managed.on && result[0]) {
                                        const path = result[1][0];
                                        return client.wait_for(() => client.stratis_pools[path])
                                                .then(pool => {
                                                    return client.stratis_set_overprovisioning(pool, false);
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
