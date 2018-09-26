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
    fmt_size, validate_lvm2_name,
    get_available_spaces, prepare_available_spaces
} from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";
import { dialog_open, TextInput, SelectSpaces } from "./dialogx.jsx";

const _ = cockpit.gettext;

export class VGroupsPanel extends React.Component {
    render() {
        var client = this.props.client;

        function create_vgroup() {
            function find_vgroup(name) {
                for (var p in client.vgroups) {
                    if (client.vgroups[p].Name == name)
                        return client.vgroups[p];
                }
                return null;
            }

            var name;
            for (var i = 0; i < 1000; i++) {
                name = "vgroup" + i.toFixed();
                if (!find_vgroup(name))
                    break;
            }

            dialog_open({ Title: _("Create Volume Group"),
                          Fields: [
                              TextInput("name", _("Name"),
                                        { value: name,
                                          validate: validate_lvm2_name
                                        }),
                              SelectSpaces("disks", _("Disks"),
                                           { empty_warning: _("No disks are available."),
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
                                  return prepare_available_spaces(client, vals.disks).then(function () {
                                      var paths = Array.prototype.slice.call(arguments);
                                      return client.manager_lvm2.VolumeGroupCreate(vals.name, paths, { });
                                  });
                              }
                          }
            });
        }

        function cmp_vgroup(path_a, path_b) {
            return client.vgroups[path_a].Name.localeCompare(client.vgroups[path_b].Name);
        }

        function make_vgroup(path) {
            var vgroup = client.vgroups[path];

            return (
                <OverviewSidePanelRow client={client}
                                      kind="array"
                                      name={vgroup.Name}
                                      detail={fmt_size(vgroup.Size)}
                                      go={() => cockpit.location.go([ "vg", vgroup.Name ])}
                                      job_path={path}
                                      key={path} />
            );
        }

        var vgroups = Object.keys(client.vgroups).sort(cmp_vgroup)
                .map(make_vgroup);

        var actions = (
            <StorageButton kind="primary" onClick={create_vgroup} id="create-volume-group">
                <span className="fa fa-plus" />
            </StorageButton>
        );

        var lvm2_feature = {
            is_enabled: () => client.features.lvm2
        };

        return (
            <OverviewSidePanel id="vgroups"
                               title={_("Volume Groups")}
                               empty_text={_("No volume groups created")}
                               actions={actions}
                               client={client}
                               feature={lvm2_feature}>
                { vgroups }
            </OverviewSidePanel>
        );
    }
}
