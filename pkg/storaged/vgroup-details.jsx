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
import utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import Content from "./content-views.jsx";
import { StorageButton, StorageBlockNavLink } from "./storage-controls.jsx";
import { dialog_open, TextInput, SelectSpaces,
    BlockingMessage, TeardownMessage } from "./dialogx.jsx";

const _ = cockpit.gettext;

class VGroupSidebar extends React.Component {
    render() {
        var self = this;
        var client = self.props.client;
        var vgroup = self.props.vgroup;
        var pvols = client.vgroups_pvols[vgroup.path] || [];

        function filter_inside_vgroup(spc) {
            var block = spc.block;
            if (client.blocks_part[block.path])
                block = client.blocks[client.blocks_part[block.path].Table];
            var lvol = (block &&
                        client.blocks_lvm2[block.path] &&
                        client.lvols[client.blocks_lvm2[block.path].LogicalVolume]);
            return !lvol || lvol.VolumeGroup != vgroup.path;
        }

        function add_disk() {
            dialog_open({ Title: _("Add Disks"),
                          Fields: [
                              SelectSpaces("disks", _("Disks"),
                                           { empty_warning: _("No disks are available."),
                                             validate: function(disks) {
                                                 if (disks.length === 0)
                                                     return _("At least one disk is needed.");
                                             },
                                             spaces: utils.get_available_spaces(client).filter(filter_inside_vgroup)
                                           })
                          ],
                          Action: {
                              Title: _("Add"),
                              action: function(vals) {
                                  return utils.prepare_available_spaces(client, vals.disks).then(function() {
                                      var paths = Array.prototype.slice.call(arguments);
                                      return cockpit.all(paths.map(function(p) {
                                          return vgroup.AddDevice(p, {});
                                      }));
                                  });
                              }
                          }
            });
        }

        function render_pvol(pvol) {
            var remove_action = null;
            var remove_excuse = null;

            function pvol_remove() {
                return vgroup.RemoveDevice(pvol.path, true, {});
            }

            function pvol_empty_and_remove() {
                return (vgroup.EmptyDevice(pvol.path, {})
                        .then(function() {
                            vgroup.RemoveDevice(pvol.path, true, {});
                        }));
            }

            if (pvols.length === 1) {
                remove_excuse = _("The last physical volume of a volume group cannot be removed.");
            } else if (pvol.FreeSize < pvol.Size) {
                if (pvol.Size <= vgroup.FreeSize)
                    remove_action = pvol_empty_and_remove;
                else
                    remove_excuse = cockpit.format(
                        _("There is not enough free space elsewhere to remove this physical volume. At least $0 more free space is needed."),
                        utils.fmt_size(pvol.Size - vgroup.FreeSize)
                    );
            } else {
                remove_action = pvol_remove;
            }

            return (
                <tr key={pvol.path}>
                    <td className="storage-icon">
                        <div><img src="images/storage-disk.png" /></div>
                    </td>
                    <td>
                        <StorageBlockNavLink client={client} block={ client.blocks[pvol.path] } />
                        <br />
                        <span>
                            {cockpit.format(_("$0, $1 free"),
                                            utils.fmt_size(pvol.Size),
                                            utils.fmt_size(pvol.FreeSize))}
                        </span>
                    </td>
                    <td className="storage-action">
                        <StorageButton onClick={remove_action} excuse={remove_excuse}>
                            <span className="fa fa-minus" />
                        </StorageButton>
                    </td>
                </tr>);
        }

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <span>{_("Physical Volumes")}</span>
                    <span className="pull-right">
                        <StorageButton onClick={add_disk}>
                            <span className="fa fa-plus" />
                        </StorageButton>
                    </span>
                </div>
                <table className="table">
                    <tbody>
                        { pvols.map(render_pvol) }
                    </tbody>
                </table>
            </div>
        );
    }
}

export class VGroupDetails extends React.Component {
    constructor() {
        super();
        this.poll_timer = null;
    }

    ensurePolling(needs_polling) {
        if (needs_polling && this.poll_timer === null) {
            this.poll_timer = window.setInterval(() => { this.props.vgroup.Poll() }, 2000);
        } else if (!needs_polling && this.poll_timer !== null) {
            window.clearInterval(this.poll_timer);
            this.poll_timer = null;
        }
    }

    componentWillUnmount() {
        this.ensurePolling(false);
    }

    render() {
        var client = this.props.client;
        var vgroup = this.props.vgroup;

        this.ensurePolling(vgroup.NeedsPolling);

        function rename() {
            var location = cockpit.location;

            dialog_open({ Title: _("Rename Volume Group"),
                          Fields: [
                              TextInput("name", _("Name"),
                                        { value: vgroup.Name,
                                          validate: utils.validate_lvm2_name
                                        })
                          ],
                          Action: {
                              Title: _("Rename"),
                              action: function (vals) {
                                  return vgroup.Rename(vals.name, { })
                                          .done(function () {
                                              location.go([ 'vg', vals.name ]);
                                          });
                              }
                          }
            });
        }

        function delete_() {
            var location = cockpit.location;
            var usage = utils.get_active_usage(client, vgroup.path);

            if (usage.Blocking) {
                dialog_open({ Title: cockpit.format(_("$0 is in active use"),
                                                    vgroup.Name),
                              Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({ Title: cockpit.format(_("Please confirm deletion of $0"), vgroup.Name),
                          Footer: TeardownMessage(usage),
                          Action: {
                              Danger: _("Deleting a volume group will erase all data on it."),
                              Title: _("Delete"),
                              action: function () {
                                  return utils.teardown_active_usage(client, usage)
                                          .then(function () {
                                              return vgroup.Delete(true,
                                                                   { 'tear-down': { t: 'b', v: true }
                                                                   })
                                                      .done(function () {
                                                          location.go('/');
                                                      });
                                          });
                              }
                          }
            });
        }

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">
                    {cockpit.format(_("Volume Group $0"), vgroup.Name)}
                    <span className="pull-right">
                        <StorageButton onClick={rename}>{_("Rename")}</StorageButton>
                        { "\n" }
                        <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                    </span>
                </div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        <tbody>
                            <tr>
                                <td>{_("storage", "UUID")}</td>
                                <td>{ vgroup.UUID }</td>
                            </tr>
                            <tr>
                                <td>{_("storage", "Capacity")}</td>
                                <td>{ utils.fmt_size_long(vgroup.Size) }</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );

        var sidebar = <VGroupSidebar client={this.props.client} vgroup={vgroup} />;

        var content = <Content.VGroup client={this.props.client} vgroup={vgroup} />;

        return <StdDetailsLayout client={this.props.client}
                                 header={ header }
                                 sidebar={ sidebar }
                                 content={ content } />;
    }
}
