/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
    get_available_spaces, prepare_available_spaces
} from "./utils.js";

const _ = cockpit.gettext;

export function stratis_feature(client) {
    return {
        is_enabled: () => client.features.stratis,
    };
}

const StratisPoolRow = ({ client, path }) => {
    const pool = client.stratis_pools[path];

    return (
        <SidePanelRow client={client}
                      name={pool.Name}
                      devname={"/dev/stratis/" + pool.Name + "/"}
                      detail={cockpit.format(_("$0 Stratis Pool"), fmt_size(pool.data.TotalPhysicalSize))}
                      go={() => cockpit.location.go(["pool", pool.Uuid])}
                      job_path={path} />
    );
};

const StratisLockedPoolRow = ({ client, uuid }) => {
    const locked_props = client.stratis_manager.data.LockedPoolsWithDevs[uuid];
    const devs = locked_props.devs.v.map(d => d.devnode);

    return (
        <SidePanelRow client={client}
                      name={uuid}
                      detail={cockpit.format(_("Locked Stratis Pool on $0"), devs.join(", "))}
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

    const locked_pools = Object.keys(client.stratis_manager.data.LockedPoolsWithDevs).sort(cmp_locked_pool)
            .map(uuid => <StratisLockedPoolRow key={uuid} client={client} uuid={uuid} />);

    return pools.concat(locked_pools);
}

function store_new_passphrase(client, desc_prefix, passphrase) {
    const manager = client.stratis_manager;
    return manager.client.call(manager.path, "org.storage.stratis2.FetchProperties.r2", "GetProperties", [["KeyList"]])
            .catch(() => [{ }])
            .then(([result]) => {
                let keys = [];
                if (result.KeyList && result.KeyList[0])
                    keys = result.KeyList[1].v;
                console.log("RES", keys);
                let desc;
                for (var i = 0; i < 1000; i++) {
                    desc = desc_prefix + (i > 0 ? "." + i.toFixed() : "");
                    if (keys.indexOf(desc) == -1)
                        break;
                }
                return cockpit.spawn(["stratis", "key", "set", desc, "--keyfile-path", "/dev/stdin"], { superuser: true })
                        .input(passphrase)
                        .then(() => Promise.resolve(desc));
            });
}

export function create_stratis_pool(client) {
    function find_pool(name) {
        for (var p in client.stratis_pools) {
            if (client.stratis_pools[p].Name == name)
                return client.stratis_pools[p];
        }
        return null;
    }

    var name;
    for (var i = 0; i < 1000; i++) {
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
                          validate: function (name) {
                              if (name == "")
                                  return _("Name can not be empty.");
                          }
                      }),
            CheckBoxes("encrypt", "",
                       {
                           fields: [
                               { tag: "on", title: _("Encrypt data") }
                           ]
                       }),
            [
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
            ],
            SelectSpaces("disks", _("Disks"),
                         {
                             empty_warning: _("No disks are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one disk is needed.");
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
                        return client.stratis_manager.CreatePool(vals.name, [false, 0],
                                                                 devs,
                                                                 key_desc ? [true, key_desc] : [false, ""])
                                .then((result, code, message) => {
                                    if (code)
                                        return Promise.reject(message);
                                });
                    }

                    if (vals.encrypt.on) {
                        return store_new_passphrase(client, vals.name, vals.passphrase)
                                .then(key_desc => {
                                    return create(key_desc)
                                            .then(() => {
                                                // XXX - remove key also in case of failure
                                                return client.stratis_manager.UnsetKey(key_desc)
                                                        .then((result, code, message) => {
                                                            if (code)
                                                                return Promise.reject(message);
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
