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

import { SidePanelRow } from "./side-panel.jsx";
import {
    fmt_size, decode_filename,
    get_available_spaces, prepare_available_spaces,
    get_config
} from "./utils.js";
import { dialog_open, TextInput, SelectSpace, SizeSlider, CheckBoxes } from "./dialog.jsx";

const _ = cockpit.gettext;

export function vdo_feature(client) {
    return {
        is_enabled: () => client.features.vdo,
        package: get_config("vdo_package", false),
        enable: () => {
            client.features.vdo = true;
            client.vdo_overlay.start();
            return Promise.resolve();
        },

        dialog_options: {
            title: _("Install VDO support"),
            text: _("The $0 package must be installed to create VDO devices.")
        }
    };
}

const VDORow = ({ client, vdo }) => {
    const block = client.slashdevs_block[vdo.dev];
    return (
        <SidePanelRow client={client}
                      kind="array"
                      name={vdo.name}
                      devname={vdo.dev}
                      detail={fmt_size(vdo.logical_size) + " " + _("VDO device")}
                      location={"#/vdo/" + vdo.name}
                      job_path={block && block.path} />
    );
};

export function vdo_rows(client) {
    function cmp_vdo(a, b) {
        return a.name.localeCompare(b.Name);
    }
    return client.vdo_overlay.volumes.sort(cmp_vdo)
            .map(vdo => <VDORow key={vdo.name} client={client} vdo={vdo} />);
}

export function create_vdo(client) {
    var name;
    for (var i = 0; i < 1000; i++) {
        name = "vdo" + i.toFixed();
        if (!client.vdo_overlay.by_name[name])
            break;
    }

    dialog_open({
        Title: _("Create VDO device"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: name,
                          validate: function (name) {
                              if (name == "")
                                  return _("Name can not be empty.");
                          }
                      }),
            SelectSpace("space", _("Disk"),
                        {
                            empty_warning: _("No disks are available."),
                            validate: function (spc) {
                                if (!spc)
                                    return _("A disk is needed.");
                            },
                            spaces: get_available_spaces(client)
                        }),
            SizeSlider("lsize", _("Logical size"),
                       {
                           max: 3 * 1024 * 1024 * 1024 * 1024,
                           round: 512,
                           value: 1024 * 1024 * 1024 * 1024,
                           allow_infinite: true
                       }),
            SizeSlider("index_mem", _("Index memory"),
                       {
                           max: 2 * 1024 * 1024 * 1024,
                           round: function (val) {
                               var round = val < 1024 * 1024 * 1024 ? 256 * 1024 * 1024 : 1024 * 1024 * 1024;
                               return Math.round(val / round) * round;
                           },
                           value: 256 * 1024 * 1024,
                           allow_infinite: true,
                       }),
            CheckBoxes("options", _("Options"),
                       {
                           fields: [
                               {
                                   tag: "compression", title: _("Compression"),
                                   tooltip: _("Save space by compressing individual blocks with LZ4")
                               },
                               {
                                   tag: "deduplication", title: _("Deduplication"),
                                   tooltip: _("Save space by storing identical data blocks just once")
                               },
                               {
                                   tag: "emulate_512", title: _("Use 512 byte emulation"),
                                   tooltip: _("For legacy applications only. Reduces performance.")
                               }
                           ],
                           value: {
                               compression: true,
                               deduplication: true,
                               emulate_512: false
                           }
                       })
        ],
        update: (dlg, vals, trigger) => {
            if (trigger == "space") {
                dlg.set_values({ lsize: vals.space.size });
                dlg.set_options("lsize", { max: 3 * vals.space.size });
            }
        },
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, [vals.space]).then(function (paths) {
                    var block = client.blocks[paths[0]];
                    return cockpit.spawn(["wipefs", "-a", decode_filename(block.PreferredDevice)],
                                         {
                                             superuser: true,
                                             err: "message"
                                         })
                            .then(function () {
                                return client.vdo_overlay.create({
                                    name: vals.name,
                                    block: block,
                                    logical_size: vals.lsize,
                                    index_mem: vals.index_mem,
                                    compression: vals.options.compression,
                                    deduplication: vals.options.deduplication,
                                    emulate_512: vals.emulate_512
                                });
                            });
                });
            }
        }
    });
}
