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
    get_available_spaces, prepare_available_spaces,
    get_config
} from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import { dialog_open, TextInput, SelectSpace, SizeSlider, CheckBox } from "./dialogx.jsx";

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

            dialog_open({ Title: _("Create VDO Device"),
                          Fields: [
                              TextInput("name", _("Name"),
                                        { value: name,
                                          validate: function (name) {
                                              if (name == "")
                                                  return _("Name can not be empty.");
                                          }
                                        }),
                              SelectSpace("space", _("Disk"),
                                          { empty_warning: _("No disks are available."),
                                            validate: function (spc) {
                                                if (spc === undefined)
                                                    return _("A disk is needed.");
                                            },
                                            spaces: get_available_spaces(client)
                                          }),
                              SizeSlider("lsize", _("Logical Size"),
                                         { max: 3 * 1024 * 1024 * 1024 * 1024,
                                           round: 512,
                                           value: 1024 * 1024 * 1024 * 1024,
                                           allow_infinite: true
                                         }),
                              SizeSlider("index_mem", _("Index Memory"),
                                         { max: 2 * 1024 * 1024 * 1024,
                                           round: function (val) {
                                               var round = val < 1024 * 1024 * 1024 ? 256 * 1024 * 1024 : 1024 * 1024 * 1024;
                                               return Math.round(val / round) * round;
                                           },
                                           value: 256 * 1024 * 1024,
                                           allow_infinite: true,
                                         }),
                              CheckBox("compression", _("Compression"),
                                       { value: true,
                                         row_title: _("Options") }),
                              CheckBox("deduplication", _("Deduplication"),
                                       { value: true }),
                              CheckBox("emulate_512", _("Use 512 Byte emulation"),
                                       { value: false })
                          ],
                          update: (dlg, vals, trigger) => {
                              if (trigger == "space") {
                                  dlg.set_values({ "lsize": vals.space.size });
                                  dlg.set_options("lsize", { max: 3 * vals.space.size });
                              }
                          },
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
                                      job_path={block && block.path}
                                      key={vdo.dev} />
            );
        }

        var vdos = client.vdo_overlay.volumes.sort(cmp_vdo).map(make_vdo);

        var actions = (
            <StorageButton kind="primary" onClick={create_vdo} id="create-vdo">
                <span className="fa fa-plus" />
            </StorageButton>
        );

        var vdo_feature = {
            is_enabled: () => client.features.vdo,
            package: get_config("vdo_package", false),
            enable: () => {
                client.features.vdo = true;
                client.vdo_overlay.start();
            }
        };

        return (
            <OverviewSidePanel id="vdos"
                               title={_("VDO Devices")}
                               empty_text={_("No storage set up as VDO")}
                               actions={actions}
                               client={client}
                               feature={vdo_feature}
                               install_title={_("Install VDO support")}
                               not_installed_text={_("VDO support not installed")}>
                { vdos }
            </OverviewSidePanel>
        );
    }
}
