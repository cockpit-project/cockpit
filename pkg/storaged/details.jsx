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
    var SidebarViews = require("./sidebar-views.jsx");

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
                                  action: function () {
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

            return { breadcrumb: drive && utils.drive_name(drive),
                     header: mustache.render(block_detail_tmpl,
                                             { Block: block_model,
                                               Drive: drive_model
                                             })
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

            return { breadcrumb: utils.mdraid_name(mdraid),
                     header: mustache.render(mdraid_detail_tmpl,
                                             { MDRaid: mdraid_model,
                                               MDRaidButton: mustache.render(action_btn_tmpl,
                                                                             { arg: mdraid.path,
                                                                               def: def_action,
                                                                               actions: actions
                                                                             }),
                                               Block: block_model
                                             })
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

            var actions = [
                { action: "vgroup_rename", title: _("Rename") },
                { action: "vgroup_delete", title: _("Delete") }
            ];

            return { breadcrumb: vgroup.Name,
                     header: mustache.render(vgroup_detail_tmpl,
                                             { VGroup: vgroup_model,
                                               VGroupButton: mustache.render(action_btn_tmpl,
                                                                             { arg: vgroup.path,
                                                                               def: actions[0], // Rename
                                                                               actions: actions
                                                                             }),
                                             })
                   };
        }

        function render() {
            var html;
            if (type == 'block')
                html = render_block();
            else if (type == 'mdraid')
                html = render_mdraid();
            else if (type == 'vgroup')
                html = render_vgroup();

            if (html) {
                $('#storage-detail .breadcrumb .active').text(html.breadcrumb || name);
                $('button.tooltip-ct').tooltip('destroy');
                $('#detail-header').amend(html.header);
                $('button.tooltip-ct').tooltip();
            } else {
                $('#storage-detail .breadcrumb .active').text(name);
                $('#detail-header').text(_("Not found"));
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

            var content = document.getElementById("detail-content");
            var sidebar = document.getElementById("detail-sidebar");

            React.unmountComponentAtNode(content);
            React.unmountComponentAtNode(sidebar);
            if (type == 'block') {
                $('#detail-body').attr("class", "col-md-12");
                React.render(
                    <ContentViews.Block client={client} name={name} />,
                    content
                );
            } else if (type == 'mdraid') {
                $('#detail-body').attr("class", "col-md-8 col-lg-9 col-md-pull-4 col-lg-pull-3");
                React.render(
                    <ContentViews.MDRaid client={client} name={name} />,
                    content
                );
                React.render(
                    <SidebarViews.MDRaid client={client} name={name} />,
                    sidebar
                );
            } else if (type == 'vgroup') {
                $('#detail-body').attr("class", "col-md-8 col-lg-9 col-md-pull-4 col-lg-pull-3");
                React.render(
                    <ContentViews.VGroup client={client} name={name} />,
                    content
                );
                React.render(
                    <SidebarViews.VGroup client={client} name={name} />,
                    sidebar
                );
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
