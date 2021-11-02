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

import { SidePanelRow } from "./side-panel.jsx";
import { dialog_open, TextInput, CheckBoxes, PassInput, SelectSpaces } from "./dialog.jsx";
import {
    decode_filename, fmt_size,
    get_available_spaces, prepare_available_spaces,
} from "./utils.js";
import { validate_pool_name, unlock_pool } from "./stratis-details.jsx";
import { StorageButton } from "./storage-controls.jsx";
import { UnlockIcon } from "@patternfly/react-icons";

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

const StratisPoolRow = ({ client, path }) => {
    const pool = client.stratis_pools[path];

    return (
        <SidePanelRow client={client}
                      name={pool.Name}
                      devname={"/dev/stratis/" + pool.Name + "/"}
                      detail={cockpit.format(_("$0 Stratis Pool"), fmt_size(pool.TotalPhysicalSize))}
                      go={() => cockpit.location.go(["pool", pool.Uuid])}
                      job_path={path} />
    );
};

const StratisLockedPoolRow = ({ client, uuid }) => {
    const action = <StorageButton onClick={() => unlock_pool(client, uuid, true)}><UnlockIcon /></StorageButton>;

    return (
        <SidePanelRow client={client}
                      name={uuid}
                      truncate_name={false}
                      detail={_("Locked encrypted Stratis pool")}
                      actions={action}
                      go={() => cockpit.location.go(["pool", uuid])} />
    );
};

export function stratis_rows(client) {
    function cmp_pool(path_a, path_b) {
        return client.stratis_pools[path_a].Name.localeCompare(client.stratis_pools[path_b].Name);
    }

    function cmp_locked_pool(uuid_a, uuid_b) {
        return uuid_a.localeCompare(uuid_b);
    }

    const pools = Object.keys(client.stratis_pools).sort(cmp_pool)
            .map(p => <StratisPoolRow key={p} client={client} path={p} />);

    const locked_pools = Object.keys(client.stratis_manager.LockedPools).sort(cmp_locked_pool)
            .map(uuid => <StratisLockedPoolRow key={uuid} client={client} uuid={uuid} />);

    return pools.concat(locked_pools);
}

function store_new_passphrase(client, desc_prefix, passphrase) {
    return client.stratis_list_keys()
            .catch(() => [{ }])
            .then(keys => {
                let desc;
                for (let i = 0; i < 1000; i++) {
                    desc = desc_prefix + (i > 0 ? "." + i.toFixed() : "");
                    if (keys.indexOf(desc) == -1)
                        break;
                }
                return client.stratis_store_passphrase(desc, passphrase)
                        .then(() => Promise.resolve(desc));
            });
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
        Title: _("Create Stratis Pool"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: name,
                          validate: name => validate_pool_name(client, null, name)
                      }),
            CheckBoxes("encrypt", "",
                       {
                           fields: [
                               { tag: "on", title: _("Encrypt data") }
                           ],
                           nested_fields: [
                               PassInput("passphrase", _("Passphrase"),
                                         {
                                             validate: function (phrase) {
                                                 if (phrase === "")
                                                     return _("Passphrase cannot be empty");
                                             },
                                             visible: vals => vals.encrypt.on
                                         }),
                               PassInput("passphrase2", _("Confirm"),
                                         {
                                             validate: function (phrase2, vals) {
                                                 if (phrase2 != vals.passphrase)
                                                     return _("Passphrases do not match");
                                             },
                                             visible: vals => vals.encrypt.on
                                         })
                           ]
                       }),
            SelectSpaces("disks", _("Block devices"),
                         {
                             empty_warning: _("No block devices are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one block device is needed.");
                             },
                             spaces: get_available_spaces(client)
                         })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, vals.disks).then(function (paths) {
                    const devs = paths.map(p => decode_filename(client.blocks[p].PreferredDevice));

                    function create(key_desc) {
                        return client.stratis_create_pool(vals.name, devs, key_desc)
                                .then((result, code, message) => {
                                    if (code)
                                        return Promise.reject(message);
                                });
                    }

                    if (vals.encrypt.on) {
                        return store_new_passphrase(client, vals.name, vals.passphrase)
                                .then(key_desc => {
                                    return create(key_desc)
                                            .finally(() => {
                                                return client.stratis_manager.UnsetKey(key_desc)
                                                        .then((result, code, message) => {
                                                            if (code)
                                                                console.warn(message);
                                                        });
                                            });
                                });
                    } else {
                        return create(false);
                    }
                });
            }
        }
    });
}
