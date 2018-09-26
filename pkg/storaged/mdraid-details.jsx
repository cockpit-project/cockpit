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
import { StorageButton, StorageBlockNavLink, StorageOnOff } from "./storage-controls.jsx";
import { dialog_open, SelectSpaces, BlockingMessage, TeardownMessage } from "./dialogx.jsx";

const _ = cockpit.gettext;

class MDRaidSidebar extends React.Component {
    render() {
        var self = this;
        var client = self.props.client;
        var mdraid = self.props.mdraid;

        function filter_inside_mdraid(spc) {
            var block = spc.block;
            if (client.blocks_part[block.path])
                block = client.blocks[client.blocks_part[block.path].Table];
            return block && block.MDRaid != mdraid.path;
        }

        function add_disk() {
            dialog_open({ Title: _("Add Disks"),
                          Fields: [
                              SelectSpaces("disks", _("Disks"),
                                           {
                                               empty_warning: _("No disks are available."),
                                               validate: function (disks) {
                                                   if (disks.length === 0)
                                                       return _("At least one disk is needed.");
                                               },
                                               spaces: utils.get_available_spaces(client).filter(filter_inside_mdraid)
                                           })
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

        var n_spares = 0;
        var n_recovering = 0;
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
                <tr key={block.path}>
                    <td className="storage-icon">
                        <div><img src="images/storage-disk.png" /></div>
                    </td>
                    <td>
                        {slot || "-"} <StorageBlockNavLink client={client} block={block} />
                        <br />
                        <span className="state">{states}</span>
                    </td>
                    { dynamic_members
                        ? <td className="storage-action">
                            <StorageButton onClick={remove} excuse={remove_excuse}>
                                <span className="fa fa-minus" />
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
                    {dynamic_members
                        ? <span className="pull-right">
                            <StorageButton onClick={add_disk} excuse={add_excuse}>
                                <span className="fa fa-plus" />
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
}

export class MDRaidDetails extends React.Component {
    render() {
        var client = this.props.client;
        var mdraid = this.props.mdraid;
        var block = mdraid && client.mdraids_block[mdraid.path];

        function format_level(str) {
            return { "raid0": _("RAID 0"),
                     "raid1": _("RAID 1"),
                     "raid4": _("RAID 4"),
                     "raid5": _("RAID 5"),
                     "raid6": _("RAID 6"),
                     "raid10": _("RAID 10")
            }[str] || cockpit.format(_("RAID ($0)"), str);
        }

        var level = format_level(mdraid.Level);
        if (mdraid.NumDevices > 0)
            level += ", " + cockpit.format(_("$0 Disks"), mdraid.NumDevices);
        if (mdraid.ChunkSize > 0)
            level += ", " + cockpit.format(_("$0 Chunk Size"), utils.fmt_size(mdraid.ChunkSize));

        function toggle_bitmap(val) {
            return mdraid.SetBitmapLocation(utils.encode_filename(val ? 'internal' : 'none'), {});
        }

        var bitmap = null;
        if (mdraid.BitmapLocation) {
            var value = utils.decode_filename(mdraid.BitmapLocation) != "none";
            bitmap = (
                <tr>
                    <td>{_("storage", "Bitmap")}</td>
                    <td><StorageOnOff state={value} onChange={toggle_bitmap} /></td>
                </tr>
            );
        }

        var degraded_message = null;
        if (mdraid.Degraded > 0) {
            var text = cockpit.format(
                cockpit.ngettext("$0 disk is missing", "$0 disks are missing", mdraid.Degraded),
                mdraid.Degraded
            );
            degraded_message = (
                <div className="alert alert-danger">
                    <span className="pficon pficon-error-circle-o" />
                    <span>{_("The RAID Array is in a degraded state")}</span> - {text}
                </div>
            );
        }

        /* Older versions of Udisks/storaged don't have a Running property */
        var running = mdraid.Running;
        if (running === undefined)
            running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

        function start() {
            return mdraid.Start({ "start-degraded": { t: 'b', v: true } });
        }

        function stop() {
            var usage = utils.get_active_usage(client, block ? block.path : "");

            if (usage.Blocking) {
                dialog_open({ Title: cockpit.format(_("$0 is in active use"), utils.mdraid_name(mdraid)),
                              Body: BlockingMessage(usage),
                });
                return;
            }

            if (usage.Teardown) {
                dialog_open({ Title: cockpit.format(_("Please confirm stopping of $0"),
                                                    utils.mdraid_name(mdraid)),
                              Footer: TeardownMessage(usage),
                              Action: {
                                  Title: _("Stop Device"),
                                  action: function () {
                                      return utils.teardown_active_usage(client, usage)
                                              .then(function () {
                                                  return mdraid.Stop({});
                                              });
                                  }
                              }
                });
                return;
            }

            return mdraid.Stop({});
        }

        function delete_dialog() {
            var location = cockpit.location;

            function delete_() {
                if (mdraid.Delete)
                    return mdraid.Delete({ 'tear-down': { t: 'b', v: true } });

                // If we don't have a Delete method, we simulate
                // it by stopping the array and wiping all
                // members.

                function wipe_members() {
                    return cockpit.all(client.mdraids_members[mdraid.path].map(function (member) {
                        return member.Format('empty', { });
                    }));
                }

                if (mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0)
                    return mdraid.Stop({}).then(wipe_members);
                else
                    return wipe_members();
            }

            var usage = utils.get_active_usage(client, block ? block.path : "");

            if (usage.Blocking) {
                dialog_open({ Title: cockpit.format(_("$0 is in active use"), utils.mdraid_name(mdraid)),
                              Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({ Title: cockpit.format(_("Please confirm deletion of $0"),
                                                utils.mdraid_name(mdraid)),
                          Footer: TeardownMessage(usage),
                          Action: {
                              Title: _("Delete"),
                              Danger: _("Deleting a RAID device will erase all data on it."),
                              action: function () {
                                  return utils.teardown_active_usage(client, usage)
                                          .then(delete_)
                                          .then(function () {
                                              location.go('/');
                                          });
                              }
                          }
            });
        }

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">
                    { cockpit.format(_("RAID Device $0"), utils.mdraid_name(mdraid)) }
                    <span className="pull-right">
                        { running
                            ? <StorageButton onClick={stop}>{_("Stop")}</StorageButton>
                            : <StorageButton onClick={start}>{_("Start")}</StorageButton>
                        }
                        { "\n" }
                        <StorageButton kind="danger" onClick={delete_dialog}>{_("Delete")}</StorageButton>
                    </span>
                </div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        <tbody>
                            <tr>
                                <td>{_("storage", "Device")}</td>
                                <td>{ block ? utils.decode_filename(block.PreferredDevice) : "-" }</td>
                            </tr>
                            <tr>
                                <td>{_("storage", "UUID")}</td>
                                <td>{ mdraid.UUID }</td>
                            </tr>
                            <tr>
                                <td>{_("storage", "Capacity")}</td>
                                <td>{ utils.fmt_size_long(mdraid.Size) }</td>
                            </tr>
                            <tr>
                                <td>{_("storage", "RAID Level")}</td>
                                <td>{ level }</td>
                            </tr>
                            { bitmap }
                            <tr>
                                <td>{_("storage", "State")}</td>
                                <td>{ running ? _("Running") : _("Not running") }</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );

        var sidebar = <MDRaidSidebar client={this.props.client} mdraid={mdraid} />;

        var content = <Content.Block client={this.props.client} block={block} />;

        return <StdDetailsLayout client={this.props.client} alert={degraded_message}
                                 header={ header }
                                 sidebar={ sidebar }
                                 content={ content } />;
    }
}
