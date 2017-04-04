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

"use strict";

var cockpit = require("cockpit");
var dialog = require("./dialog");
var utils = require("./utils.js");
var $ = require("jquery");

var React = require("react");
var StorageControls = require("./storage-controls.jsx");

var StorageButton = StorageControls.StorageButton;
var StorageBlockNavLink = StorageControls.StorageBlockNavLink;

var _ = cockpit.gettext;

var MDRaid = React.createClass({
    getInitialState: function() {
        return { mdraid: null, block: null };
    },
    onClientChanged: function() {
        var mdraid = this.props.client.uuids_mdraid[this.props.name];
        var block = mdraid && this.props.client.mdraids_block[mdraid.path];
        this.setState({ mdraid: mdraid, block: block });
    },
    componentDidMount: function() {
        $(this.props.client).on("changed", this.onClientChanged);
        this.onClientChanged();
    },
    componentWillUnmount: function() {
        $(this.props.model).off("changed", this.onClientChanged);
    },

    render: function() {
        var self = this;
        var client = self.props.client;
        var mdraid = self.state.mdraid;

        if (!mdraid)
            return null;

        function filter_inside_mdraid(spc) {
            var block = spc.block;
            if (client.blocks_part[block.path])
                block = client.blocks[client.blocks_part[block.path].Table];
            return block && block.MDRaid != mdraid.path;
        }

        function add_disk() {
                dialog.open({ Title: _("Add Disks"),
                              Fields: [
                                  { SelectMany: "disks",
                                    Title: _("Disks"),
                                    Options: (
                                        utils.get_available_spaces(client)
                                            .filter(filter_inside_mdraid)
                                            .map(utils.available_space_to_option)
                                    ),
                                    EmptyWarning: _("No disks are available."),
                                    validate: function (disks) {
                                        if (disks.length === 0)
                                            return _("At least one disk is needed.");
                                    }
                                  }
                              ],
                              Action: {
                                  Title: _("Add"),
                                  action: function(vals) {
                                      return utils.prepare_available_spaces(client, vals.disks).then(function() {
                                          var paths = Array.prototype.slice.call(arguments);
                                          return cockpit.all(paths.map(function(p) {
                                              return mdraid.AddDevice(p, {});
                                          }));
                                      });
                                  }
                              }
                });
        }

        var members = client.mdraids_members[mdraid.path] || [];
        var dynamic_members = (mdraid.Level != "raid0");

        var n_spares = 0, n_recovering = 0;
        mdraid.ActiveDevices.forEach(function(as) {
            if (as[2].indexOf("spare") >= 0) {
                if (as[1] < 0)
                    n_spares += 1;
                else
                    n_recovering += 1;
            }
        });

        /* Older versions of Udisks/storaged don't have a Running property */
        var running = mdraid.Running;
        if (running === undefined)
            running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

        function render_member(block) {
            var active_state = utils.array_find(mdraid.ActiveDevices, function(as) {
                return as[0] == block.path;
            });

            function state_text(state) {
                return { faulty:       _("FAILED"),
                         in_sync:      _("In Sync"),
                         spare:        active_state[1] < 0 ? _("Spare") : _("Recovering"),
                         write_mostly: _("Write-mostly"),
                         blocked:      _("Blocked")
                }[state] || cockpit.format(_("Unknown ($0)"), state);
            }

            var slot = active_state && active_state[1] >= 0 && active_state[1].toString();
            var states = active_state && active_state[2].map(state_text).join(", ");

            var is_in_sync = (active_state && active_state[2].indexOf("in_sync") >= 0);
            var is_recovering = (active_state && active_state[2].indexOf("spare") >= 0 && active_state[1] >= 0);

            var remove_excuse = false;
            if (!running)
                remove_excuse = _("The RAID device must be running in order to remove disks.");
            else if ((is_in_sync && n_recovering > 0) || is_recovering)
                remove_excuse = _("This disk cannot be removed while the device is recovering.");
            else if (is_in_sync && n_spares < 1)
                remove_excuse = _("A spare disk needs to be added first before this disk can be removed.");
            else if (members.length <= 1)
                remove_excuse = _("The last disk of a RAID device cannot be removed.");

            function remove() {
                return mdraid.RemoveDevice(block.path, { wipe: { t: 'b', v: true } });
            }

            return (
                <tr>
                    <td className="storage-icon">
                        <div><img src="images/storage-disk.png"></img></div>
                    </td>
                    <td>
                        {slot? slot : "-"} <StorageBlockNavLink client={client} block={block}/>
                        <br/>
                        <span className="state">{states}</span>
                    </td>
                    { dynamic_members ?
                     <td className="storage-action">
                         <StorageButton onClick={remove} excuse={remove_excuse}>
                             <span className="fa fa-minus"></span>
                         </StorageButton>
                     </td>
                     : null }
                </tr>);
        }

        var add_excuse = false;
        if (!running)
            add_excuse = _("The RAID device must be running in order to add spare disks.");

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <span>{_("Disks")}</span>
                    {dynamic_members ?
                     <span className="pull-right">
                         <StorageButton onClick={add_disk} excuse={add_excuse}>
                             <span className="fa fa-plus"></span>
                         </StorageButton>
                     </span>
                     : null}
                </div>
                <table className="table">
                    <tbody>
                        {members.map(render_member)}
                    </tbody>
                </table>
            </div>
        );
    }
});

var VGroup = React.createClass({
    getInitialState: function() {
        return { vgroup: null };
    },
    onClientChanged: function() {
        this.setState({ vgroup: this.props.client.vgnames_vgroup[this.props.name] });
    },
    componentDidMount: function() {
        $(this.props.client).on("changed", this.onClientChanged);
        this.onClientChanged();
    },
    componentWillUnmount: function() {
        $(this.props.model).off("changed", this.onClientChanged);
    },

    render: function () {
        var self = this;
        var client = self.props.client;
        var vgroup = self.state.vgroup;

        if (!vgroup)
            return null;

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
            dialog.open({ Title: _("Add Disks"),
                          Fields: [
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: (
                                    utils.get_available_spaces(client)
                                         .filter(filter_inside_vgroup)
                                         .map(utils.available_space_to_option)
                                ),
                                EmptyWarning: _("No disks are available."),
                                validate: function(disks) {
                                    if (disks.length === 0)
                                        return _("At least one disk is needed.");
                                }
                              }
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
                <tr>
                    <td className="storage-icon">
                        <div><img src="images/storage-disk.png"></img></div>
                    </td>
                    <td>
                        <StorageBlockNavLink client={client} block={ client.blocks[pvol.path] }/>
                        <br></br>
                        <span>
                            {cockpit.format(_("$0, $1 free"),
                                            utils.fmt_size(pvol.Size),
                                            utils.fmt_size(pvol.FreeSize))}
                        </span>
                    </td>
                    <td className="storage-action">
                        <StorageButton onClick={remove_action} excuse={remove_excuse}>
                            <span className="fa fa-minus"></span>
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
                            <span className="fa fa-plus"></span>
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
});

module.exports = {
    MDRaid: MDRaid,
    VGroup: VGroup
};
