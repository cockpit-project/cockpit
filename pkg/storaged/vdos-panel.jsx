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
    fmt_size, decode_filename,
    get_available_spaces, available_space_to_option, prepare_available_spaces
} from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import dialog from "./dialog.js";

const _ = cockpit.gettext;

export class VDOsPanel extends React.Component {
    render() {
        var client = this.props.client;

        function create_vdo() {
            var name;
            for (var i = 0; i < 1000; i++) {
                name = "vdo" + i.toFixed();
                if (!client.vdo_overlay.by_name[name])
                    break;
            }

            var spaces = get_available_spaces(client).map(available_space_to_option);

            dialog.open({ Title: _("Create VDO Device"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                Value: name,
                                validate: function (name) {
                                    if (name == "")
                                               return _("Name can not be empty.");
                                }
                              },
                              { SelectOneOfMany: "space",
                                Title: _("Disk"),
                                EmptyWarning: _("No disks are available."),
                                Options: spaces,
                                validate: function (spc) {
                                    if (spc === undefined)
                                        return _("A disk is needed.");
                                }
                              },
                              { SizeSlider: "lsize",
                                Title: _("Logical Size"),
                                Max: 3*1024*1024*1024*1024,
                                Round: 512,
                                Value: 1024*1024*1024*1024,
                                AllowInfinite: true,
                                update: function (vals, trigger) {
                                    if (trigger == "space") {
                                        return {
                                            Max: 3*vals.space.size,
                                            Value: vals.space.size
                                        };
                                    } else
                                    return vals.lsize;
                                }
                              },
                              { SizeSlider: "index_mem",
                                Title: _("Index Memory"),
                                Max: 2*1024*1024*1024,
                                Round: function (val) {
                                    var round = val < 1024*1024*1024 ? 256*1024*1024 : 1024*1024*1024;
                                    return Math.round(val / round) * round;
                                },
                                Value: 256*1024*1024,
                                AllowInfinite: true,
                              },
                              { CheckBox: "compression",
                                Title: _("Compression"),
                                Value: true,
                                RowTitle: _("Options")
                              },
                              { CheckBox: "deduplication",
                                Title: _("Deduplication"),
                                Value: true
                              },
                              { CheckBox: "asynchronous",
                                Title: _("Transfer data asynchronously"),
                                Value: false,
                              },
                              { CheckBox: "emulate_512",
                                Title: _("Use 512 Byte emulation"),
                                Value: false
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals) {
                                  return prepare_available_spaces(client, [ vals.space ]).then(function (path) {
                                      var block = client.blocks[path];
                                      return cockpit.spawn([ "wipefs", "-a", decode_filename(block.PreferredDevice) ],
                                                           { superuser: true,
                                                             err: "message"
                                                           })
                                                    .then(function () {
                                                        return client.vdo_overlay.create({
                                                            name: vals.name,
                                                            block: block,
                                                            logical_size: vals.lsize,
                                                            index_mem: vals.index_mem,
                                                            compression: vals.compression,
                                                            deduplication: vals.deduplication,
                                                            asynchronous: vals.asynchronous,
                                                            emulate_512: vals.emulate_512
                                                        });
                                                    });
                                  });
                              }
                          }
            });
        }

        function cmp_vdo(a, b) {
            return a.name.localeCompare(b.Name);
        }

        function make_vdo(vdo) {
            var block = client.slashdevs_block[vdo.dev];
            return (
                <OverviewSidePanelRow client={client}
                                      kind="array"
                                      name={vdo.name}
                                      detail={fmt_size(vdo.logical_size)}
                                      go={() => cockpit.location.go([ "vdo", vdo.name ])}
                                      job_path={block && block.path}/>
            );
        }

        var vdos = client.vdo_overlay.volumes.sort(cmp_vdo).map(make_vdo);

        var actions = (
            <StorageButton kind="primary" onClick={create_vdo} id="create-vdo">
                <span className="fa fa-plus"/>
            </StorageButton>
        );

        return (
            <OverviewSidePanel id="vdos"
                               title={_("VDO Devices")}
                               empty_text={_("No storage set up as VDO")}
                               actions={actions}>
                { vdos }
            </OverviewSidePanel>
        );
    }
}
