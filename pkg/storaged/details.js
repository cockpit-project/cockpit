/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var mustache = require("mustache");
    var journal = require("journal");

    var React = require("react");
    var ContentViews = require("./content-views.jsx");

    var utils = require("./utils");
    var dialog = require("./dialog");
    var permissions = require("./permissions");

    var _ = cockpit.gettext;

    /* DETAILS
     */

    function init_details(client, jobs) {
        var type, name;

        var multipathd_service = utils.get_multipathd_service();

        var actions = {
            mdraid_start: function mdraid_start(path) {
                return client.mdraids[path].Start({ "start-degraded": { t: 'b', v: true } });
            },
            mdraid_stop: function mdraid_stop(path) {
                return client.mdraids[path].Stop({});
            },
            mdraid_start_scrub: function mdraid_start_scrub(path) {
                return client.mdraids[path].RequestSyncAction("repair", {});
            },
            mdraid_stop_scrub: function mdraid_stop_scrub(path) {
                return client.mdraids[path].RequestSyncAction("idle", {});
            },
            mdraid_toggle_bitmap: function mdraid_toggle_bitmap(path) {
                var old = utils.decode_filename(client.mdraids[path].BitmapLocation);
                return client.mdraids[path].SetBitmapLocation(utils.encode_filename(old == 'none'? 'internal' : 'none'), {});
            },
            mdraid_add_disk: function mdraid_add_disk(path) {
                var mdraid = client.mdraids[path];

                dialog.open({ Title: _("Add Disks"),
                              Fields: [
                                  { SelectMany: "disks",
                                    Title: _("Disks"),
                                    Options: (utils.get_free_blockdevs(client).
                                              filter(function (b) {
                                                  if (client.blocks_part[b.path])
                                                      b = client.blocks[client.blocks_part[b.path].Table];
                                                  return b && client.blocks[b.path].MDRaid != path;
                                              }).
                                              map(function (b) {
                                                  return { value: b.path, Title: b.Name + " " + b.Description };
                                              })),
                                    validate: function (disks) {
                                        if (disks.length === 0)
                                            return _("At least one disk is needed.");
                                    }
                                  }
                              ],
                              Action: {
                                  Title: _("Add"),
                                  action: function (vals) {
                                      return cockpit.all(vals.disks.map(function (p) {
                                          return mdraid.AddDevice(p, {});
                                      }));
                                  }
                              }
                            });
            },
            mdraid_remove_disk: function mdraid_remove_disk(path) {
                var block = client.blocks[path];
                var mdraid = client.mdraids[block.MDRaidMember];
                return mdraid.RemoveDevice(path, { wipe: { t: 'b', v: true } });
            },
            mdraid_delete: function mdraid_delete(path) {
                var location = cockpit.location;
                var mdraid = client.mdraids[path];
                if (!mdraid)
                    return;

                function delete_() {
                    if (mdraid.Delete)
                        return mdraid.Delete({ 'tear-down': { t: 'b', v: true } });

                    // If we don't have a Delete method, we simulate
                    // it by stopping the array and wiping all
                    // members.

                    function wipe_members() {
                        return cockpit.all(client.mdraids_members[path].map(function (member) {
                            return member.Format('empty', { });
                        }));
                    }

                    if (mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0)
                        return mdraid.Stop({}).then(wipe_members);
                    else
                        return wipe_members();
                }

                var block = client.mdraids_block[path];
                dialog.open({ Title: cockpit.format(_("Please confirm deletion of $0"),
                                                    utils.mdraid_name(mdraid)),
                              Alerts: block && utils.get_usage_alerts(client, block.path),
                              Fields: [ ],
                              Action: {
                                  Title: _("Delete"),
                                  Danger: _("Deleting a RAID device will erase all data on it."),
                                  action: function (vals) {
                                      return delete_().
                                              done(function () {
                                                  location.go('/');
                                              });
                                  }
                              }
                            });
            },

            vgroup_rename: function vgroup_rename(path) {
                var location = cockpit.location;
                var vgroup = client.vgroups[path];
                if (!vgroup)
                    return;

                dialog.open({ Title: _("Rename Volume Group"),
                              Fields: [
                                  { TextInput: "name",
                                    Title: _("Name"),
                                    Value: vgroup.Name,
                                    validate: utils.validate_lvm2_name
                                  },
                              ],
                              Action: {
                                  Title: _("Create"),
                                  action: function (vals) {
                                      return vgroup.Rename(vals.name, { }).
                                          done(function () {
                                              location.go([ 'vg', vals.name ]);
                                          });
                                  }
                              }
                            });

            },
            vgroup_delete: function vgroup_delete(path) {
                var location = cockpit.location;
                var vgroup = client.vgroups[path];
                if (!vgroup)
                    return;

                dialog.open({ Title: cockpit.format(_("Please confirm deletion of $0"), vgroup.Name),
                              Alerts: utils.get_usage_alerts(client, path),
                              Fields: [
                              ],
                              Action: {
                                  Danger: _("Deleting a volume group will erase all data on it."),
                                  Title: _("Delete"),
                                  action: function () {
                                      return vgroup.Delete(true,
                                                           { 'tear-down': { t: 'b', v: true }
                                                           }).
                                          done(function () {
                                              location.go('/');
                                          });
                                  }
                              }
                            });
            },
            vgroup_add_disk: function vgroup_add_disk(path) {
                var vgroup = client.vgroups[path];
                if (!vgroup)
                    return;

                dialog.open({ Title: _("Add Disks"),
                              Fields: [
                                  { SelectMany: "disks",
                                    Title: _("Disks"),
                                    Options: (utils.get_free_blockdevs(client).
                                              filter(function (b) {
                                                  if (client.blocks_part[b.path])
                                                      b = client.blocks[client.blocks_part[b.path].Table];
                                                  var lvol = (b &&
                                                              client.blocks_lvm2[b.path] &&
                                                              client.lvols[client.blocks_lvm2[b.path].LogicalVolume]);
                                                  return !lvol || lvol.VolumeGroup != path;
                                              }).
                                              map(function (b) {
                                                  return { value: b.path, Title: b.Name + " " + b.Description };
                                              })),
                                    validate: function (disks) {
                                        if (disks.length === 0)
                                            return _("At least one disk is needed.");
                                    }
                                  }
                              ],
                              Action: {
                                  Title: _("Add"),
                                  action: function (vals) {
                                      return cockpit.all(vals.disks.map(function (p) {
                                          return vgroup.AddDevice(p, {});
                                      }));
                                  }
                              }
                            });
            },
            pvol_empty_and_remove: function vgroup_add_disk(path) {
                var pvol = client.blocks_pvol[path];
                var vgroup = pvol && client.vgroups[pvol.VolumeGroup];
                if (!vgroup)
                    return;

                return (vgroup.EmptyDevice(path, {})
                        .then(function () {
                            vgroup.RemoveDevice(path, true, {});
                        }));
            },
            pvol_remove: function vgroup_add_disk(path) {
                var pvol = client.blocks_pvol[path];
                var vgroup = pvol && client.vgroups[pvol.VolumeGroup];
                if (!vgroup)
                    return;

                return vgroup.RemoveDevice(path, true, {});
            },

            job_cancel: function job_cancel(path) {
                var job = client.storaged_jobs[path] || client.udisks_jobs[path];
                if (job)
                    return job.Cancel({});
            }
        };

        $('#storage-detail').on('click', '[data-action]', function () {
            var action = $(this).attr('data-action');
            var args = [ ];
            if ($(this).attr('data-args'))
                args = JSON.parse($(this).attr('data-args'));
            else if ($(this).attr('data-arg'))
                args = [ $(this).attr('data-arg') ];
            var promise = actions[action].apply(this, args);
            if (promise)
                promise.fail(function (error) {
                    $('#error-popup-title').text(_("Error"));
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                });
        });

        var action_btn_tmpl = $("#action-btn-tmpl").html();
        mustache.parse(action_btn_tmpl);

        var block_detail_tmpl = $("#block-detail-tmpl").html();
        mustache.parse(block_detail_tmpl);

        function render_block() {
            $('#storage-detail .breadcrumb .active').text(name);

            var block = client.slashdevs_block[name];
            if (!block)
                return;

            var block_model = {
                dbus: block,
                Name: utils.block_name(block),
                Size: utils.fmt_size_long(block.Size)
            };

            var drive = client.drives[block.Drive];
            var drive_ata = client.drives_ata[block.Drive];

            var assessment = null;
            if (drive_ata) {
                assessment = {
                    Failing: client.drives_ata.SmartFailing,
                    Temperature: drive_ata.SmartTemperature > 0 && utils.format_temperature(drive_ata.SmartTemperature)
                };
            }

            var drive_model = null;
            if (drive) {
                var drive_block = client.drives_block[drive.path];
                var multipath_blocks = client.drives_multipath_blocks[drive.path];

                var multipath_model = null;
                if (multipath_blocks.length > 0) {
                    multipath_model = {
                        Devices: multipath_blocks.map(utils.block_name)
                    };
                }

                drive_model = {
                    dbus: drive,
                    Size: drive.Size > 0 && utils.fmt_size_long(drive.Size),
                    Assessment: assessment,
                    Device: drive_block && utils.block_name(drive_block),
                    Multipath: multipath_model,
                    MultipathActive: multipathd_service.state == "running"
                };
            }

            return { header: mustache.render(block_detail_tmpl,
                                             { Block: block_model,
                                               Drive: drive_model
                                             }),
                     sidebar: null,
                   };
        }

        var mdraid_detail_tmpl = $("#mdraid-detail-tmpl").html();
        mustache.parse(mdraid_detail_tmpl);

        var mdraid_members_tmpl = $("#mdraid-members-tmpl").html();
        mustache.parse(mdraid_members_tmpl);

        function render_mdraid() {
            var mdraid = client.uuids_mdraid[name];
            if (!mdraid)
                return;

            var block = client.mdraids_block[mdraid.path];

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

            var bitmap = null;
            if (mdraid.BitmapLocation)
                bitmap = {
                    Value: utils.decode_filename(mdraid.BitmapLocation) != "none"
                };

            var degraded_message = null;
            if (mdraid.Degraded > 0) {
                degraded_message = cockpit.format(
                                       cockpit.ngettext("$0 disk is missing", "$0 disks are missing", mdraid.Degraded),
                                       mdraid.Degraded
                                   );
            }

            /* Older versions of Udisks/storaged don't have a Running property */
            var running = mdraid.Running;
            if (running === undefined)
                running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

            var mdraid_model = {
                dbus: mdraid,
                Name: utils.mdraid_name(mdraid),
                Size: utils.fmt_size_long(mdraid.Size),
                Level: level,
                Bitmap: bitmap,
                Degraded: degraded_message,
                State: running ? _("Running") : _("Not running"),
            };

            var block_model = null;
            if (block) {
                block_model = {
                    dbus: block,
                    Device: utils.decode_filename(block.PreferredDevice)
                };
            }

            function make_member(block) {
                var active_state = utils.array_find(mdraid.ActiveDevices, function (as) {
                    return as[0] == block.path;
                });

                function make_state(state) {
                    return {
                        Description: { faulty:       _("FAILED"),
                                       in_sync:      _("In Sync"),
                                       spare:        active_state[1] < 0 ? _("Spare") : _("Recovering"),
                                       write_mostly: _("Write-mostly"),
                                       blocked:      _("Blocked")
                                     }[state] || cockpit.format(_("Unknown ($0)"), state),
                        Danger: state == "faulty"
                    };
                }

                return {
                    path: block.path,
                    LinkTarget: utils.get_block_link_target(client, block.path),
                    Description: utils.decode_filename(block.PreferredDevice),
                    Slot: active_state && active_state[1] >= 0 && active_state[1].toString(),
                    States: active_state && active_state[2].map(make_state)
                };
            }

            var actions = [
                { title: _("Start"),           action: 'mdraid_start' },
                { title: _("Stop"),            action: 'mdraid_stop' },
                { title: _("Start Scrubbing"), action: 'mdraid_start_scrub' },
                { title: _("Stop Scrubbing"),  action: 'mdraid_stop_scrub' },
                { title: _("Delete"),          action: 'mdraid_delete' }
            ];

            var def_action;
            if (running)
                def_action = actions[1];  // Stop
            else
                def_action = actions[0];  // Start

            return { header: mustache.render(mdraid_detail_tmpl,
                                             { MDRaid: mdraid_model,
                                               MDRaidButton: mustache.render(action_btn_tmpl,
                                                                             { arg: mdraid.path,
                                                                               def: def_action,
                                                                               actions: actions
                                                                             }),
                                               Block: block_model
                                             }),
                     sidebar: mustache.render(mdraid_members_tmpl,
                                              { MDRaid: mdraid_model,
                                                Members: client.mdraids_members[mdraid.path].map(make_member),
                                                DynamicMembers: (mdraid.Level != "raid0")
                                              }),
                   };
        }

        var vgroup_detail_tmpl = $("#vgroup-detail-tmpl").html();
        mustache.parse(vgroup_detail_tmpl);

        var vgroup_pvs_tmpl = $("#vgroup-pvs-tmpl").html();
        mustache.parse(vgroup_pvs_tmpl);

        var poll_timer;

        function render_vgroup() {
            var vgroup = client.vgnames_vgroup[name];
            if (!vgroup)
                return;

            var pvols = client.vgroups_pvols[vgroup.path];

            if (vgroup.NeedsPolling && poll_timer === null) {
                poll_timer = window.setInterval(function () { vgroup.Poll(); }, 2000);
            } else if (!vgroup.NeedsPolling && poll_timer !== null) {
                window.clearInterval(poll_timer);
                poll_timer =  null;
            }

            var vgroup_model = {
                dbus: vgroup,
                Size: utils.fmt_size_long(vgroup.Size)
            };

            function make_pvol(pvol) {
                var block = client.blocks[pvol.path];
                var action = null;
                var excuse = null;
                if (pvols.length == 1) {
                    excuse = _("The last physical volume of a volume group cannot be removed.");
                } else if (pvol.FreeSize < pvol.Size) {
                    if (pvol.Size <= vgroup.FreeSize)
                        action = "pvol_empty_and_remove";
                    else
                        excuse = cockpit.format(_("There is not enough free space elsewhere to remove this physical volume.  At least $0 more free space is needed."),
                                                utils.fmt_size(pvol.Size - vgroup.FreeSize));
                } else {
                    action = "pvol_remove";
                }
                return {
                    dbus: block,
                    LinkTarget: utils.get_block_link_target(client, pvol.path),
                    Device: utils.decode_filename(block.PreferredDevice),
                    Sizes: cockpit.format(_("$0, $1 free"),
                                          utils.fmt_size(pvol.Size),
                                          utils.fmt_size(pvol.FreeSize)),
                    action: action,
                    args: JSON.stringify([ pvol.path ]),
                    Excuse: excuse
                };
            }

            var actions = [
                { action: "vgroup_rename", title: _("Rename") },
                { action: "vgroup_delete", title: _("Delete") }
            ];

            return { header: mustache.render(vgroup_detail_tmpl,
                                             { VGroup: vgroup_model,
                                               VGroupButton: mustache.render(action_btn_tmpl,
                                                                             { arg: vgroup.path,
                                                                               def: actions[0], // Rename
                                                                               actions: actions
                                                                             }),
                                             }),
                     sidebar: mustache.render(vgroup_pvs_tmpl,
                                              { VGroup: vgroup_model,
                                                PVols: pvols.map(make_pvol)
                                              }),
                   };
        }

        function render() {
            $('#storage-detail .breadcrumb .active').text(name);

            var html;
            if (type == 'block')
                html = render_block();
            else if (type == 'mdraid')
                html = render_mdraid();
            else if (type == 'vgroup')
                html = render_vgroup();

            if (html) {
                $('button.tooltip-ct').tooltip('destroy');
                $('#detail-header').amend(html.header);
                $('#detail-sidebar').amend(html.sidebar);
                $('button.tooltip-ct').tooltip();

                if (html.sidebar)
                    $('#detail-body').attr("class", "col-md-8 col-lg-9 col-md-pull-4 col-lg-pull-3");
                else
                    $('#detail-body').attr("class", "col-md-12");

            } else {
                $('#detail-header').text(_("Not found"));
                $('#detail-sidebar').empty();
            }

            jobs.update('#storage-detail');
            $('#detail-jobs').amend(jobs.render());
            permissions.update();
        }

        $(multipathd_service).on('changed', render);
        $(client).on('changed', render);

        $('#storage-detail-log').append(
            journal.logbox([ "_SYSTEMD_UNIT=storaged.service", "+",
                            "_SYSTEMD_UNIT=udisks2.service", "+",
                            "_SYSTEMD_UNIT=dm-event.service", "+",
                            "_SYSTEMD_UNIT=smartd.service", "+",
                            "_SYSTEMD_UNIT=multipathd.service"
                          ],
                          10));

        $('#storage-detail .breadcrumb a').on("click", function() {
            cockpit.location.go('/');
        });

        function hide() {
            name = null;
            utils.hide("#storage-detail");
        }

        function show(t, n) {
            if (poll_timer !== null) {
                window.clearInterval(poll_timer);
                poll_timer =  null;
            }

            type = t;
            name = n;
            render();

            var content = document.querySelector("#detail-content");
            React.unmountComponentAtNode(content);
            if (type == 'block') {
                React.render(React.createElement(ContentViews.Block,
                                                 { client: client,
                                                   name: name
                                                 }), content);
            } else if (type == 'mdraid') {
                React.render(React.createElement(ContentViews.MDRaid,
                                                 { client: client,
                                                   name: name
                                                 }), content);
            } else if (type == 'vgroup') {
                React.render(React.createElement(ContentViews.VGroup,
                                                 { client: client,
                                                   name: name
                                                 }), content);
            }

            utils.show_soon("#storage-detail", !!content.firstChild);
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        init: init_details
    };

}());
