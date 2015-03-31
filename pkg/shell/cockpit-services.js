/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

define([
    "jquery",
    "base1/cockpit",
    "shell/controls",
    "shell/shell",
    "system/server",
    "shell/cockpit-main"
], function($, cockpit, controls, shell, server) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;
var N_ = cockpit.noop;

function resource_debug() {
    if (window.debugging == "all" || window.debugging == "resource" || true)
        console.debug.apply(console, arguments);
}

function format_cpu_usage(usage) {
    if (usage === undefined || isNaN(usage))
        return "";
    return Math.round(usage) + "%";
}

function systemd_unit_name_esc(str) {
    var validchars = /[0-9a-zA-Z:-_.\\]/;
    var res = "";
    var i;

    for (i = 0; i < str.length; i++) {
        var c = str[i];
        if (c == "/")
            res += "-";
        else if (c == "-" || c == "\\" || !validchars.test(c)) {
            res += "\\x";
            var h = c.charCodeAt(0).toString(16);
            while (h.length < 2)
                h = "0" + h;
            res += h;
        } else
            res += c;
    }
    return res;
}

function systemd_kill_slashes(str) {
    str = str.replace(/\/+/g, "/");
    if (str.length > 1)
        str = str.replace(/\/$/, "").replace(/^\//, "");
    return str;
}

function systemd_path_esc(str) {
    str = systemd_kill_slashes(str);
    if (str == "/")
        return "-";
    else
        return systemd_unit_name_esc(str);
}

function systemd_param_esc(str) {
    if (str.length > 0 && str[0] == "/")
        return systemd_path_esc(str);
    else
        return systemd_unit_name_esc(str);
}

// xgettext fodder

// load_state
N_("loaded");
N_("error");
N_("masked");
N_("not-found");
// active_state
N_("active");
N_("reloading");
N_("inactive");
N_("failed");
N_("activating");
N_("deactivating");
// sub_state (most common)
N_("running");
N_("dead");
N_("listening");
N_("exited");
N_("waiting");
N_("elapsed");
// file_state
N_("enabled");
N_("enabled-runtime");
N_("linked");
N_("linked-runtime");
N_("masked");
N_("masked-runtime");
N_("static");
N_("disabled");
N_("invalid");

function render_service (name, desc, load_state, active_state, sub_state, file_state,
                         manager)
{
    var waiting, active, color_style;

    if (!load_state)
        load_state = "";

    if (!active_state)
        active_state = "";

    if (!sub_state)
        sub_state = "";

    if (active_state == 'failed' || load_state == 'error')
        color_style = ';color:red';
    else
        color_style = '';

    if (load_state == "loaded")
        load_state = "";

    waiting = (active_state == "activating" || active_state == "deactivating" || active_state == "reloading");
    active = (active_state == "active" || active_state == "reloading");

    load_state = _(load_state);
    active_state = _(active_state);
    sub_state = _(sub_state);
    file_state = _(file_state);

    if (sub_state !== "" && sub_state != active_state)
        active_state = active_state + " (" + sub_state + ")";

    if (load_state !== "")
        active_state = load_state + " / " + active_state;

    var tr = ($('<tr>', { 'data-unit': name
                        }).
              click(function () { cockpit.location.go("service", { s: name }); }).
              append(
                  $('<td style="font-weight:bold">').text(desc),
                  $('<td>').text(name),
                  $('<td>', { style: "text-align:right;white-space:nowrap" + color_style }).text(active_state)));

    if (manager) {
        var img_waiting = $('<div class="waiting">');
        var btn_play = $('<button class="btn btn-default btn-control services-privileged btn-play">').
            on("click", function() {
                manager.call('ServiceAction', name, 'start', function (error) {
                    if (error)
                        shell.show_unexpected_error(error);
                });
                return false;
            });
        var btn_stop = $('<button class="btn btn-default btn-control services-privileged btn-stop">').
            on("click", function() {
                manager.call('ServiceAction', name, 'stop', function (error) {
                    if (error)
                        shell.show_unexpected_error(error);
                });
                return false;
            });

        img_waiting.toggle(waiting);
        btn_play.toggle(!waiting && !active);
        btn_stop.toggle(!waiting && active);

        tr.append(
            $('<td class="cell-buttons" style="padding-left:20px;padding-right:5px">').append(
                btn_play, btn_stop, img_waiting));

        var geard_match = name.match(/ctr-(.*)\.service/);

        if (geard_match) {
            var btn_eject = $('<button class="btn btn-default btn-control services-privileged btn-eject">').
                on("click", function() {
                    cockpit.spawn([ "gear", "delete", geard_match[1] ]).
                        fail(shell.show_unexpected_error);
                    return false;
                });

            tr.append(
                $('<td class="cell-buttons" style="padding-left:5px;padding-right:5px">').append(
                    btn_eject));
        }
    }

    return tr;
}

function update_service_privileged() {
    controls.update_privileged_ui(
        shell.default_permission, ".services-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify services"),
            cockpit.user.name)
    );
}

$(shell.default_permission).on("changed", update_service_privileged);

PageServices.prototype = {
    _init: function() {
        this.id = "services";
        this.geard_check_done = false;
        this.geard_present = false;
    },

    getTitle: function() {
        return C_("page-title", "Services");
    },

    setup: function() {
        update_service_privileged();
        var self = this;
        $('#services-add').click(function () {
            $('#service-add-dialog').modal('show');
        });
    },

    enter: function() {
        var me = this;

        if (!me.geard_check_done) {
            me.geard_check_done = true;
            cockpit.spawn([ "which", "gear" ], { error : "output" }).
                done(function () {
                    me.geard_present = true;
                    shell.content_refresh();
                });
        }

        function tabbtn(title, id, val, active, attrs) {
            var btn =
                $('<label class="btn btn-default">').append(
                    title,
                    $('<input>', $.extend({ id: id,
                                            type: "radio",
                                            name: "services-filter",
                                            value: val,
                                            checked: active? "checked" : undefined
                                          }, attrs)));
            if (active)
                btn.addClass("active");
            return btn;
        }

        var my_services_btn = null;
        if (me.geard_present) {
            my_services_btn =
                tabbtn(_("Services"),        "services-filter-my-services", "^ctr-.*\\.service$", true,
                       { "data-show-graphs": true, "data-include-buttons": true });
        }

        $('#shell-header-extra').append(
            $('<div class="btn-group" data-toggle="buttons">').append(
                my_services_btn,
                tabbtn(_("Targets"),         "services-filter-targets",     "\\.target$",  false),
                tabbtn(_("System Services"), "services-filter-services",    "\\.service$", !my_services_btn),
                tabbtn(_("Sockets"),         "services-filter-sockets",     "\\.socket$",  false),
                tabbtn(_("Timers"),          "services-filter-timers",      "\\.timer$",   false),
                tabbtn(_("Paths"),           "services-filter-paths",       "\\.path$",    false)));

        $('#shell-header-extra input').on('change', function (event) {
            me.update();
        });

        /* TODO: This code needs to be migrated away from old dbus */
        me.client = shell.dbus(null);

        me.manager = me.client.get("/com/redhat/Cockpit/Services",
                                   "com.redhat.Cockpit.Services");
        $(me.manager).on("ServiceUpdate.services", function (event, service) {
            me.update_service (service[0], service[1], service[2], service[3], service[4], service[5]);
        });
        $(me.manager).on("ServiceUpdateAll.services", function (event) {
            me.update();
        });

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        me.monitor = me.client.get ("/com/redhat/Cockpit/LxcMonitor",
                                    "com.redhat.Cockpit.MultiResourceMonitor");

        function is_interesting_cgroup(cgroup) {
            return cgroup && !!cgroup.match("ctr-.*\\.service$");
        }

        function highlight_service_row(event, id) {
            $('#services .list-group-item').removeClass('highlight');
            if (id) {
                id = id.split('/').pop();
                $('[data-unit="' + shell.esc(id) + '"]').addClass('highlight');
            }
        }

        this.cpu_plot = shell.setup_multi_plot('#services-cpu-graph', me.monitor, 4, blues.concat(blues),
                                                 is_interesting_cgroup);
        $(this.cpu_plot).on('update-total', function (event, total) {
            $('#services-cpu-text').text(format_cpu_usage(total));
        });
        $(this.cpu_plot).on('highlight', highlight_service_row);

        this.mem_plot = shell.setup_multi_plot('#services-mem-graph', me.monitor, 0, blues.concat(blues),
                                                 is_interesting_cgroup);
        $(this.mem_plot).on('update-total', function (event, total) {
            $('#services-mem-text').text(cockpit.format_bytes(total, 1024));
        });
        $(this.mem_plot).on('highlight', highlight_service_row);

        $("#services-list-enabled, #services-list-disabled, #services-list-static").parents(".panel").hide();
        $("#services-list-enabled, #services-list-disabled, #services-list-static").empty();
        me.items = { };

        me.update();
    },

    show: function() {
        if ($('#services-graphs').is(':visible')) {
            this.cpu_plot.start();
            this.mem_plot.start();
        }
    },

    leave: function() {
        var self = this;

        this.cpu_plot.destroy();
        this.mem_plot.destroy();
        $(self.manager).off('.services');
        self.client.release();
        self.client = null;
        self.manager = null;
    },

    update_service: function (name, desc, load_state, active_state, sub_state, file_state) {
        var pattern = $('input[name="services-filter"]:checked').val();
        var include_buttons =
            ($('input[name="services-filter"]:checked').attr('data-include-buttons') !== undefined);
        if (pattern && name.match(pattern)) {
            if (!include_buttons || load_state != "not-found") {
                var item = $(render_service(name, desc, load_state, active_state, sub_state, file_state,
                                            include_buttons? this.manager : null));
                if (this.items[name])
                    this.items[name].replaceWith(item);
                else {
                    // XXX - sort it properly
                    if (file_state == 'enabled') {
                        item.appendTo($("#services-list-enabled"));
                        $("#services-list-enabled").parents(".panel").show();
                    } else if (file_state == 'disabled') {
                        item.appendTo($("#services-list-disabled"));
                        $("#services-list-disabled").parents(".panel").show();
                    } else {
                        item.appendTo($("#services-list-static"));
                        $("#services-list-static").parents(".panel").show();
                    }
                }
                this.items[name] = item;
            } else {
                if (this.items[name])
                    this.items[name].remove();
                delete this.items[name];
            }
        }
    },

    update: function() {
        var me = this;

        if ($('input[name="services-filter"]:checked').attr('data-show-graphs') !== undefined) {
            $('#services-graphs').show();
            $('#services-add').show();
            if ($('#services-graphs').is(':visible')) {
                this.cpu_plot.start();
                this.mem_plot.start();
            }
        } else {
            $('#services-graphs').hide();
            $('#services-add').hide();
            this.cpu_plot.stop();
            this.mem_plot.stop();
        }

        function compare_service(a,b)
        {
            return (a[1]).localeCompare(b[1]);
        }

        /* HACK
         *
         * When description is not set, cockpitd
         * couldn't parse the unit file.  We fix that
         * up by getting the service info
         * asynchronously from systemd directly.
         *
         * https://github.com/cockpit-project/cockpit/issues/826
         */
        function hack_get_service_info(name) {
            me.manager.call('GetServiceInfo', name, function (error, result) {
                if (result) {
                    me.update_service(result.Id,
                                      result.Description,
                                      result.LoadState,
                                      result.ActiveState,
                                      result.SubState,
                                      result.UnitFileState);
                }
            });
        }

        me.manager.call('ListServices', function(error, services) {
            var pattern;
            var service;
            var include_buttons;

            if (error) {
                console.log ("error %s", error.message);
            } else {
                var list_enabled = $("#services-list-enabled"), enabled_added;
                var list_disabled = $("#services-list-disabled"), disabled_added;
                var list_static = $("#services-list-static"), static_added;

                var i;
                list_enabled.empty(); enabled_added = false;
                list_disabled.empty(); disabled_added = false;
                list_static.empty(); static_added = false;
                me.items = { };
                services.sort(compare_service);
                pattern = $('input[name="services-filter"]:checked').val();
                include_buttons =
                    ($('input[name="services-filter"]:checked').attr('data-include-buttons') !== undefined);
                for (i = 0; i < services.length; i++) {
                    service = services[i];
                    if (!pattern || (service[0].match(pattern) && (service[2] != "not-found" || !include_buttons))) {
                        if (service[1] == "Unknown" && me.manager)
                            hack_get_service_info(service[0]);

                        var item = $(render_service (service[0],
                                                     service[1],
                                                     service[2],
                                                     service[3],
                                                     service[4],
                                                     service[5],
                                                     include_buttons? me.manager : null));

                        if (me.items[service[0]]) {
                            me.items[service[0]].replaceWith(item);
                        } else if (service[5] == 'enabled') {
                            item.appendTo(list_enabled);
                            enabled_added = true;
                        } else if (service[5] == 'disabled') {
                            item.appendTo(list_disabled);
                            disabled_added = true;
                        } else {
                            item.appendTo(list_static);
                            static_added = true;
                        }
                        me.items[service[0]] = item;
                    }
                }
                list_enabled.parents(".panel").toggle(enabled_added);
                list_disabled.parents(".panel").toggle(disabled_added);
                list_static.parents(".panel").toggle(static_added);
            }
        });
        update_service_privileged();
    }
};

function PageServices() {
    this._init();
}

shell.pages.push(new PageServices());

PageServiceAdd.prototype = {
    _init: function() {
        this.id = "service-add-dialog";
    },

    setup: function() {
        $('#service-add-add').click($.proxy(this, "add"));
    },

    enter: function() {
        this.docker = shell.docker();
        $(this.docker).on("image.services", $.proxy(this, "update"));

        $('#service-add-image, #service-add-name').val("");
        this.update();
    },

    show: function() {
    },

    leave: function() {
        $(shell.docker).off(".services");
        this.docker.release();
        this.docker = null;
    },

    update: function() {
        var $images = $('#service-add-images');

        var images = [];
        for (var id in this.docker.images) {
            var image = this.docker.images[id];
            if (image && image.RepoTags && image.RepoTags[0] != "<none>:<none>")
                images.push(image);
        }

        images.sort(function (a, b) {
            var an = a.RepoTags[0];
            var bn = b.RepoTags[0];

            return (an > bn)? 1 : (an < bn)? -1 : 0;
        });

        $images.html(
            images.map(function (image) {
                return $('<a class="list-group-item">').
                           text(image.RepoTags[0]).
                           click(function () {
                               $('#service-add-image').val(image.RepoTags[0]);
                           });
            }));
    },

    add: function() {
        $('#service-add-dialog').modal('hide');
        cockpit.spawn([ "gear", "install", "--has-foreground", $('#service-add-image').val(), $('#service-add-name').val() ]).
            fail(shell.show_unexpected_error);
    }
};

function PageServiceAdd() {
    this._init();
}

shell.dialogs.push(new PageServiceAdd());

PageService.prototype = {
    _init: function() {
        this.id = "service";
        this.section_id = "services";
    },

    getTitle: function() {
        return C_("page-title", "Services");
    },

    setup: function() {
        var self = this;

        var unit_action_spec = [
            { title: _("Start"),                 action: 'start',     is_default: true },
            { title: _("Stop"),                  action: 'stop' },
            { title: _("Restart"),               action: 'restart' },
            { title: _("Reload"),                action: 'reload' },
            { title: _("Reload or Restart"),     action: 'reload-or-restart' },
            { title: _("Try Restart"),           action: 'try-restart' },
            { title: _("Reload or Try Restart"), action: 'reload-or-try-restart' },
            { title: _("Isolate"),               action: 'isolate' }
        ];

        self.unit_action_btn = shell.action_btn(function (op) { self.action(op); },
                                                  unit_action_spec, "services-privileged");
        $('#service-unit-action-btn').html(self.unit_action_btn);

        var file_action_spec = [
            { title: _("Enable"),                action: 'enable',     is_default: true },
            { title: _("Enable Forcefully"),     action: 'force-enable' },
            { title: _("Disable"),               action: 'disable' },
            { title: _("Preset"),                action: 'preset' },
            { title: _("Preset Forcefully"),     action: 'force-preset' },
            { title: _("Mask"),                  action: 'mask' },
            { title: _("Mask Forcefully"),       action: 'force-mask' },
            { title: _("Unmask"),                action: 'unmask' }
        ];

        self.file_action_btn = shell.action_btn(function (op) { self.action(op); },
                                                  file_action_spec, "services-privileged");
        $('#service-file-action-btn').html(self.file_action_btn);

        $("#service-refresh").on('click', function () {
            self.update();
        });

        $("#service-instantiate").on('click', function () {
            var tp = self.service.indexOf("@");
            var sp = self.service.lastIndexOf(".");
            if (tp != -1) {
                var s = self.service.substring(0, tp+1);
                s = s + systemd_param_esc($("#service-parameter").val());
                if (sp != -1)
                    s = s + self.service.substring(sp);
                cockpit.location.go("service", { s: s });
            }
        });
    },

    enter: function() {
        var me = this;

        /* TODO: This code needs to be migrated away from old dbus */
        me.client = shell.dbus(null);

        me.manager = me.client.get("/com/redhat/Cockpit/Services",
                                   "com.redhat.Cockpit.Services");

        $(me.manager).on("ServiceUpdate", function (event, info) {
            if (info[0] == me.service)
                me.update();
        });
        $(me.manager).on("ServiceUpdateAll", function () {
            me.update();
        });

        me.service = shell.get_page_param('s') || "";
        me.update();
        me.watch_journal();

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        me.monitor = me.client.get ("/com/redhat/Cockpit/LxcMonitor",
                                    "com.redhat.Cockpit.MultiResourceMonitor");

        function endsWith(string, suffix) {
            return string.indexOf(suffix, string.length - suffix.length) !== -1;
        }

        function is_interesting_cgroup(cgroup) {
            return cgroup && endsWith(cgroup, me.service);
        }

        this.cpu_plot = shell.setup_multi_plot('#service-cpu-graph', me.monitor, 4, blues.concat(blues),
                                                 is_interesting_cgroup);
        $(this.cpu_plot).on('update-total', function (event, total) {
            $('#service-cpu-text').text(format_cpu_usage(total));
        });

        this.mem_plot = shell.setup_multi_plot('#service-mem-graph', me.monitor, 0, blues.concat(blues),
                                                 is_interesting_cgroup);
        $(this.mem_plot).on('update-total', function (event, total) {
            $('#service-mem-text').text(cockpit.format_bytes(total, 1024));
        });
    },

    show: function() {
        this.cpu_plot.start();
        this.mem_plot.start();
    },

    leave: function() {
        this.cpu_plot.destroy();
        this.mem_plot.destroy();
        if (this.journal_watcher)
            this.journal_watcher.stop();
        delete this.journal_watcher;
        this.client.release();
        this.client = null;
    },

    watch_journal: function () {
        this.journal_watcher = server.logbox([ "_SYSTEMD_UNIT=" + this.service, "+",
                                               "COREDUMP_UNIT=" + this.service, "+",
                                               "UNIT=" + this.service ], 10);
        $('#service-log').empty().append(this.journal_watcher);
    },

    update: function () {
        var me = this;

        var tp = me.service.indexOf("@");
        var sp = me.service.lastIndexOf(".");

        me.template = undefined;
        if (tp != -1 && tp+1 != sp && tp+1 != me.service.length) {
            me.template = me.service.substring(0, tp+1);
            if (sp != -1)
                me.template = me.template + me.service.substring(sp);
        }

        $('#service .breadcrumb .active').text(me.service);

        function add_proc_info(procs, info, level) {
            var i;
            if (level > 0)
                procs.append("<div class=\"list-group-item\">" + shell.esc(info[0]) + "</div>");
            for (i = 1; i < info.length; i++) {
                if (true) {
                    procs.append("<div class=\"list-group-item\">" + shell.esc(info[i].Pid) + " " + shell.esc(info[i].CmdLine) + "</div>");
                } else {
                    add_proc_info(info[i], level+1);
                }
            }
        }

        me.manager.call('GetServiceInfo', me.service, function (error, info) {
            if (error) {
                $("#service-unknown").show();
                $("#service-known").hide();

                $("#service-name").text(me.service);
                return;
            }

            $("#service-unknown").hide();
            $("#service-known").show();

            $("#service-name").text(info.Description || info.Id || "--");

            if (info.IsTemplate) {
                $("#service-unit-row").hide();
                $("#service-instantiate-row").show();
            } else {
                $("#service-unit-row").show();
                $("#service-instantiate-row").hide();

                var active_state = info.ActiveState;
                var sub_state = info.SubState;

                $("#service-active-state").text(_(active_state));
                $("#service-sub-state").text(_(sub_state));

                var timestamp;
                if (active_state == 'active' || active_state == 'reloading')
                    timestamp = info.ActiveEnterTimestamp;
                else if (active_state == 'inactive' ||active_state == 'failed')
                    timestamp = info.InactiveEnterTimestamp;
                else if (active_state == 'activating')
                    timestamp = info.InactiveExitTimestamp;
                else
                    timestamp = info.ActiveExitTimestamp;

                if (active_state == 'active' || active_state == 'reloading' ||
                    active_state == 'activating')
                    me.set_unit_action('stop');
                else
                    me.set_unit_action('start');

                $("#service-since").text(new Date(timestamp/1000).toLocaleString());
            }

            if (me.template) {
                $("#service-template-row").show();
                var html = cockpit.format(_("This service is an instance of the $template service template."),
                             { template: cockpit.format('<a class="cockpit-link" onclick="${cmd}">$title</a>',
                                           { cmd: shell.esc("cockpit.location.go('service', " +
                                                              JSON.stringify({ s: me.template }) + ");"),
                                             title: shell.esc(me.template)
                                           })
                             });
                $("#service-template-link").html(html);
            } else
                $("#service-template-row").hide();

            var load_state = info.LoadState;
            var file_state = info.UnitFileState;

            $("#service-load-state").text(_(load_state));

            $("#service-file-row").show();
            $("#service-load-error-box").hide();
            $("#service-template-box").hide();
            $("#service-file-box").hide();

            if (info.IsTemplate) {
                $("#service-template-box").show();
                $("#service-template-state").text(_(file_state));
            } else if (load_state == "error") {
                $("#service-load-error-box").show();
                $("#service-load-error").text(shell.esc(info.LoadError[1]));
            } else {
                var path = info.SourcePath || info.FragmentPath;
                if (path || file_state) {
                    $("#service-file-box").show();
                    $("#service-file").text(shell.esc(path));
                    $("#service-file-state").text(_(file_state));
                } else
                    $("#service-file-row").hide();
            }

            if (load_state == 'masked')
                me.set_file_action('unmask');
            else if (file_state == 'static')
                me.set_file_action('mask');
            else if (file_state == 'enabled')
                me.set_file_action('disable');
            else
                me.set_file_action('enable');

            var procs = $("#service-processes");
            if (info.Processes) {
                procs.closest('.panel').show();
                procs.empty();
                procs.append("<div class=\"list-group-item\"> " + _("CGroup") + ": " + shell.esc(info.DefaultControlGroup) + "</div>");


                add_proc_info (procs, info.Processes, 0);
            } else {
                procs.closest('.panel').hide();
            }
        });
        update_service_privileged();
    },

    set_unit_action: function(op) {
        shell.action_btn_select(this.unit_action_btn, op);
    },

    set_file_action: function(op) {
        shell.action_btn_select(this.file_action_btn, op);
    },

    action: function(op) {
        this.manager.call('ServiceAction', this.service, op, function (error) {
            if (error)
                shell.show_error_dialog(_("Error"), error.message);
        });
    }
};

function PageService() {
    this._init();
}

shell.pages.push(new PageService());

});
