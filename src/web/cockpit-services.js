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

function cockpit_render_service (name, desc, load_state, active_state, sub_state, file_state)
{
    var color_style;

    if (active_state == 'failed' || load_state == 'error')
        color_style = ';color:red';
    else
        color_style = '';

    return ("<a class=\"list-group-item\" onclick=\"" + cockpit_esc(cockpit_go_down_cmd("service", { s: name })) + "\">" +
            "<table style=\"width:100%\">" +
            "<tr><td style=\"text-align:left\">" +
            "<span style=\"font-weight:bold\">" +
            cockpit_esc(desc) +
            "</span><br/><span>" +
            cockpit_esc(name) +
            "</span></td>" +
            "<td style=\"text-align:right" + color_style + "\">" +
            '<td style="width:60px">' + cockpit_esc(_(load_state)) + "</td>" +
            '<td style="width:60px">' + cockpit_esc(_(active_state)) + "</td>" +
            '<td style="width:80px">' + cockpit_esc(_(sub_state)) + "</td>" +
            '<td style="width:60px">' + cockpit_esc(_(file_state)) + "</td>" +
            "</tr></table>" +
            "</a>");
}

PageServices.prototype = {
    _init: function() {
        this.id = "services";
    },

    getTitle: function() {
        return C_("page-title", "System Services");
    },

    enter: function() {
        var me = this;

        $('#content-header-extra').append(' \
            <div class="btn-group" data-toggle="buttons"> \
              <label class="btn btn-default" translatable="yes">Targets \
                <input type="radio" name="services-filter" id="services-filter-targets" value=".target"/> \
              </label> \
              <label class="btn btn-default active" translatable="yes">Services \
                <input type="radio" name="services-filter" id="services-filter-services" value=".service" checked="checked"/> \
              </label> \
              <label class="btn btn-default" translatable="yes">Sockets \
                <input type="radio" name="services-filter" id="services-filter-sockets" value=".socket"/> \
              </label> \
              <label class="btn btn-default" translatable="yes">Timers \
                <input type="radio" name="services-filter" id="services-filter-timers" value=".timer"/> \
              </label> \
              <label class="btn btn-default" translatable="yes">Paths \
                <input type="radio" name="services-filter" id="services-filter-paths" value=".path"/> \
              </label> \
            </div>');

        $('#content-header-extra label').on('click', function (event) {
            me.update();
        });

        me.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        me.client = cockpit.dbus(me.address, { protocol: 'dbus-json1' });

        me.manager = me.client.get("/com/redhat/Cockpit/Services",
                                   "com.redhat.Cockpit.Services");
        $(me.manager).on("ServiceUpdate.services", function (event, service) {
            me.update_service (service[0], service[1], service[2], service[3], service[4], service[5]);
        });
        $(me.manager).on("ServiceUpdateAll.services", function (event) {
            me.update();
        });

        me.update();
    },

    show: function() {
    },

    leave: function() {
        var self = this;

        $(self.manager).off('.services');
        self.client.release();
        self.client = null;
        self.manager = null;
    },

    update_service: function (name, desc, load_state, active_state, sub_state, file_state) {
        var suffix = $('input[name="services-filter"]:checked').val();
        if (suffix && name.endsWith(suffix)) {
            var item = $(cockpit_render_service(name, desc, load_state, active_state, sub_state, file_state));
            if (this.items[name])
                this.items[name].replaceWith(item);
            else {
                // XXX - sort it properly
                if (file_state == 'enabled')
                    item.appendTo($("#services-list-enabled"));
                else if (file_state == 'disabled')
                    item.appendTo($("#services-list-disabled"));
                else
                    item.appendTo($("#services-list-static"));
            }
            this.items[name] = item;
        }
    },

    update: function() {
        var me = this;

        function compare_service(a,b)
        {
            return (a[1]).localeCompare(b[1]);
        }

        me.manager.call('ListServices', function(error, services) {
            var suffix;
            var service;

            if (error) {
                console.log ("error %s", error.message);
            } else {
                var list_enabled = $("#services-list-enabled");
                var list_disabled = $("#services-list-disabled");
                var list_static = $("#services-list-static");

                var i;
                list_enabled.empty();
                list_disabled.empty();
                list_static.empty();
                me.items = { };
                services.sort(compare_service);
                suffix = $('input[name="services-filter"]:checked').val();
                for (i = 0; i < services.length; i++) {
                    service = services[i];
                    if (!suffix || service[0].endsWith(suffix)) {
                        var item = $(cockpit_render_service (service[0],
                                                          service[1],
                                                          service[2],
                                                          service[3],
                                                          service[4],
                                                          service[5]));
                        if (service[5] == 'enabled')
                            item.appendTo(list_enabled);
                        else if (service[5] == 'disabled')
                            item.appendTo(list_disabled);
                        else
                            item.appendTo(list_static);
                        me.items[service[0]] = item;
                    }
                }
            }
        });
    }
};

function PageServices() {
    this._init();
}

cockpit_pages.push(new PageServices());

PageService.prototype = {
    _init: function() {
        this.id = "service";
    },

    getTitle: function() {
        return C_("page-title", "Service");
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

        self.unit_action_btn = cockpit_action_btn(function (op) { self.action(op); },
                                                  unit_action_spec);
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

        self.file_action_btn = cockpit_action_btn(function (op) { self.action(op); },
                                                  file_action_spec);
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
                cockpit_go_down ({ page: "service", s: s });
            }
        });
    },

    enter: function() {
        var me = this;

        me.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        me.client = cockpit.dbus(me.address, { protocol: 'dbus-json1' });

        me.manager = me.client.get("/com/redhat/Cockpit/Services",
                                   "com.redhat.Cockpit.Services");

        $(me.manager).on("ServiceUpdate", function (event, info) {
            if (info[0] == me.service)
                me.update();
        });
        $(me.manager).on("ServiceUpdateAll", function () {
            me.update();
        });

        me.service = cockpit_get_page_param('s') || "";
        me.update();
        me.watch_journal();
    },

    show: function() {
    },

    leave: function() {
        this.journal_watcher.stop();
    },

    watch_journal: function () {
        this.journal_watcher = cockpit_simple_logbox (this.client,
                                                      $('#service-log'),
                                                      [ [ "_SYSTEMD_UNIT=" + this.service ],
                                                        [ "COREDUMP_UNIT=" + this.service ],
                                                        [ "UNIT=" + this.service ]
                                                      ],
                                                      10);
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
                var html = F(_("This service is an instance of the %{template} service template."),
                             { template: F('<a class="cockpit-link" onclick="%{cmd}">%{title}</a>',
                                           { cmd: cockpit_esc(cockpit_go_down_cmd("service", { s: me.template })),
                                             title: cockpit_esc(me.template)
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
                $("#service-load-error").text(cockpit_esc(info.LoadError[1]));
            } else {
                var path = info.SourcePath || info.FragmentPath;
                if (path || file_state) {
                    $("#service-file-box").show();
                    $("#service-file").text(cockpit_esc(path));
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
                procs.append("<div class=\"list-group-item\"> " + _("CGroup") + ": " + cockpit_esc(info.DefaultControlGroup) + "</div>");

                function add_proc_info(info, level) {
                    var i;
                    if (level > 0)
                        procs.append("<div class=\"list-group-item\">" + cockpit_esc(info[0]) + "</div>");
                    for (i = 1; i < info.length; i++) {
                        if (true) {
                            procs.append("<div class=\"list-group-item\">" + cockpit_esc(info[i].Pid) + " " + cockpit_esc(info[i].CmdLine) + "</div>");
                        } else {
                            add_proc_info(info[i], level+1);
                        }
                    }
                }

                add_proc_info (info.Processes, 0);
            } else {
                procs.closest('.panel').hide();
            }
        });
    },

    set_unit_action: function(op) {
        cockpit_action_btn_select (this.unit_action_btn, op);
    },

    set_file_action: function(op) {
        cockpit_action_btn_select (this.file_action_btn, op);
    },

    action: function(op) {
        if (!cockpit_check_role ('wheel', this.client))
            return;

        this.manager.call('ServiceAction', this.service, op, function (error) {
            if (error)
                cockpit_show_error_dialog(_("Error"), error.message);
        });
    }
};

function PageService() {
    this._init();
}

cockpit_pages.push(new PageService());
