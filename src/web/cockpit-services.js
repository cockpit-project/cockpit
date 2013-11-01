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

    return ("<li><a onclick=\"" + cockpit_esc(cockpit_go_down_cmd("service", { s: name })) + "\">" +
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
            "</a></li>");
}

PageServices.prototype = {
    _init: function() {
        this.id = "services";
    },

    getTitle: function() {
        return C_("page-title", "System Services");
    },

    show: function() {
    },

    enter: function(first_visit) {
    var me = this;

        $('#content-header-extra').append(' \
            <fieldset data-role="controlgroup" data-type="horizontal" data-mini="true" style="padding-left:10px"> \
              <input data-theme="c" type="radio" name="services-filter" id="services-filter-targets" value=".target"/> \
              <label for="services-filter-targets" translatable="yes">Targets</label> \
              <input data-theme="c" type="radio" name="services-filter" id="services-filter-services" value=".service" checked="checked"/> \
              <label for="services-filter-services" translatable="yes">Services</label> \
              <input data-theme="c" type="radio" name="services-filter" id="services-filter-sockets" value=".socket"/> \
              <label for="services-filter-sockets" translatable="yes">Sockets</label> \
              <input data-theme="c" type="radio" name="services-filter" id="services-filter-timers" value=".timer"/> \
              <label for="services-filter-timers" translatable="yes">Timers</label> \
              <input data-theme="c" type="radio" name="services-filter" id="services-filter-paths" value=".path"/> \
              <label for="services-filter-paths" translatable="yes">Paths</label> \
            </fieldset>').trigger('create');
        $('input[name="services-filter"]').on('click', function (event) {
            me.update();
        });

        me.update();
        if (first_visit) {
            var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Services",
                                                  "com.redhat.Cockpit.Services");
            $(manager).on("ServiceUpdate", function (event, service) {
                me.update_service (service[0], service[1], service[2], service[3], service[4], service[5]);
            });
            $(manager).on("ServiceUpdateAll", function (event) {
                me.update();
            });
            $(cockpit_dbus_client).on('ready', function () {
                me.update();
            });
        }
    },

    leave: function() {
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
            $("#services-list-enabled").listview('refresh');
            $("#services-list-disabled").listview('refresh');
            $("#services-list-static").listview('refresh');
        }
    },

    update: function() {
        var me = this;
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Services",
                                              "com.redhat.Cockpit.Services");

        function compare_service(a,b)
        {
            return (a[1]).localeCompare(b[1]);
        }

        manager.call('ListServices', function(error, services) {
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
                    if (suffix && service[0].endsWith(suffix)) {
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
                list_enabled.listview('refresh');
                list_disabled.listview('refresh');
                list_static.listview('refresh');
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

    show: function() {
    },

    enter: function(first_visit) {
        var me = this;
        me.service = cockpit_get_page_param('s') || "";
        me.update();
        me.watch_journal();

        if (first_visit) {
            var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Services",
                                                  "com.redhat.Cockpit.Services");

            $("#service-unit-action").on('click', function () {
                me.unit_action();
            });
            $("#service-unit-actions").on('click', function () {
                var o = $("#service-unit-actions").offset();
                $("#service-unit-actions-menu").popup('open', { x: o.left, y: o.top });
            });
            $("#service-unit-actions-menu button").on('click', function () {
                $("#service-unit-actions-menu").popup('close');
                me.action($(this).attr("data-op"));
            });

            $("#service-file-action").on('click', function () {
                me.file_action();
            });
            $("#service-file-actions").on('click', function () {
                var o = $("#service-file-actions").offset();
                $("#service-file-actions-menu").popup('open', { x: o.left, y: o.top });
            });
            $("#service-file-actions-menu button").on('click', function () {
                $("#service-file-actions-menu").popup('close');
                me.action($(this).attr("data-op"));
            });

            $(manager).on("ServiceUpdate", function (event, info) {
                if (info[0] == me.service)
                    me.update();
            });
            $(manager).on("ServiceUpdateAll", function () {
                me.update();
            });
            $("#service-refresh").on('click', function () {
                me.update();
            });
            $(cockpit_dbus_client).on('ready', function () {
                me.update();
            });

            $("#service-instantiate").on('click', function () {
                var tp = me.service.indexOf("@");
                var sp = me.service.lastIndexOf(".");
                if (tp != -1) {
                    var s = me.service.substring(0, tp+1);
                    s = s + systemd_param_esc($("#service-parameter").val());
                    if (sp != -1)
                        s = s + me.service.substring(sp);
                    cockpit_go_down ({ page: "service", s: s });
                }
            });
        }
    },

    leave: function() {
        this.journal_watcher.stop();
    },

    watch_journal: function () {
        this.journal_watcher = cockpit_simple_logbox ($('#service-log'),
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

        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Services",
                                              "com.redhat.Cockpit.Services");
        manager.call('GetServiceInfo', me.service, function (error, info) {
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
                    me.set_unit_action(_("Stop"), "stop");
                else
                    me.set_unit_action(_("Start"), "start");

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
                me.set_file_action(_("Unmask"), "unmask");
            else if (file_state == 'static')
                me.set_file_action(_("Mask"), "mask");
            else if (file_state == 'enabled')
                me.set_file_action(_("Disable"), "disable");
            else
                me.set_file_action(_("Enable"), "enable");

            if (info.Processes) {
                var procs = $("#service-processes");
                procs.show();
                procs.empty();
                procs.append("<li><center style=\"font-weight:bold\">" + _("Processes") + "</center></li>");
                procs.append("<li> " + _("CGroup") + ": " + cockpit_esc(info.DefaultControlGroup) + "</li>");

                function add_proc_info(info, level) {
                    var i;
                    if (level > 0)
                        procs.append("<li>" + cockpit_esc(info[0]) + "</li>");
                    for (i = 1; i < info.length; i++) {
                        if (true) {
                            procs.append("<li>" + cockpit_esc(info[i].Pid) + " " + cockpit_esc(info[i].CmdLine) + "</li>");
                        } else {
                            add_proc_info(info[i], level+1);
                        }
                    }
                }

                add_proc_info (info.Processes, 0);
                procs.listview('refresh');
            } else {
                $("#service-processes").hide();
            }

            $("#service-state-list").listview('refresh');
        });
    },

    set_unit_action: function(label, op) {
        $("#service-unit-action").text(label);
        $("#service-unit-action").button('refresh');
        this.unit_op = op;
    },

    unit_action: function() {
        this.action(this.unit_op);
    },

    set_file_action: function(label, op) {
        $("#service-file-action").text(label);
        $("#service-file-action").button('refresh');
        this.file_op = op;
    },

    file_action: function() {
        this.action(this.file_op);
    },

    action: function(op) {
        if (!cockpit_check_role ('wheel'))
            return;

        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Services",
                                              "com.redhat.Cockpit.Services");
        manager.call('ServiceAction', this.service, op, function (error) {
            if (error)
                cockpit_show_error_dialog(_("Error"), error.message);
        });
    }
};

function PageService() {
    this._init();
}

cockpit_pages.push(new PageService());
