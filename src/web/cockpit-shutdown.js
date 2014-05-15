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

PageShutdown.prototype = {
    _init: function() {
        this.id = "shutdown";
    },

    getTitle: function() {
        return C_("page-title", "Shutdown & Restart");
    },

    setup: function() {
        var self = this;

        $("#shutdown-shutdown").on("click", function() {
            self.shutdown('shutdown');
        });
        $("#shutdown-restart").on("click", function() {
            self.shutdown('restart');
        });
        $("#shutdown-cancel").on("click", function() {
            $("#shutdown-cancel").prop('disable', true);
            self.cancel();
        });
        $("#shutdown-delay").on('change', function () {
            self.update_delay();
        });
        self.update_delay();
        $("#shutdown-exact-hours,#shutdown-exact-minutes").on('keyup change', function() {
            self.check_valid_delay();
        });

        $("#shutdown-confirm-apply").on('click', function() {
            self.confirm_apply();
        });
    },

    enter: function() {
        var me = this;

        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: 'dbus-json1' });

        this.manager = this.client.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");
        this.manager.call('GetServerTime', function(error, now_seconds, abbrev, offset_seconds) {
            if (!error) {
                me.server_time_offset_millis = Date.now() - now_seconds*1000;
                me.server_tz_offset_seconds = offset_seconds;
                me.server_tz_abbrev = abbrev;
                me.update_shutdown_info();
            } else
                console.log(error.message);
        });

        $(this.manager).on("notify:ShutdownSchedule.shutdown", $.proxy(this, "update_shutdown_shedule"));
        me.update_shutdown_shedule();
    },

    show: function() {
    },

    leave: function() {
        $(this.manager).off(".shutdown");
        this.manager = null;
        this.client.release();
        this.client = null;
    },

    update_delay: function() {
        var me = this;
        var d = $("#shutdown-delay").val();
        if (d == "x") {
            $("#shutdown-exact-time-row").show();
        } else {
            $("#shutdown-exact-time-row").hide();
        }
        if (d == "0") {
            $("#shutdown-message-row").hide();
        } else {
            $("#shutdown-message-row").show();
        }
        me.check_valid_delay();
    },

    check_valid_delay: function() {
        var me = this;
        var valid = true;
        if ($("#shutdown-delay").val() == "x") {
            var h = parseInt($("#shutdown-exact-hours").val(), 10);
            var m = parseInt($("#shutdown-exact-minutes").val(), 10);
            valid = (h >= 0 && h < 24) && (m >= 0 && m < 60);
            if (valid) {
                $("#shutdown-exact-error").css('opacity', 0.0);
                $("#shutdown-exact-error").removeAttr('title');
            } else {
                $("#shutdown-exact-error").css('opacity', 1.0);
                $("#shutdown-exact-error").attr('title', _("This is not a valid time"));
            }
        }
        $("#shutdown-shutdown,#shutdown-restart").prop('disabled', !valid);
    },

    update_shutdown_shedule: function() {
        var me = this;

        // We sit still while a confirmation dialog is open

        // XXX - but if it is a "show in progress dialog", we should
        // close it when the shutdown/restart is cancelled.

        if ($('#shutdown-confirm').is(':visible'))
            return;

        me.schedule = this.manager.ShutdownSchedule;

        if (me.schedule) {
            me.shutdown_when_millis = me.schedule.when_seconds*1000;
            me.shutdown_kind = me.schedule.kind;
            me.update_shutdown_info();
            if (me.shutdown_when_millis) {
                if (!me.timer)
                    me.timer = setInterval(function() { me.update_shutdown_info(); },
                                           1000);
            } else {
                if (me.timer)
                    clearInterval(me.timer);
                me.timer = 0;
            }
        }
    },

    update_shutdown_info: function() {
        var me = this;

        if (me.shutdown_when_millis) {
            $("#shutdown-idle").hide();
            $("#shutdown-active").show();
            if (me.server_time_offset_millis) {
                var server_now_millis = Date.now() - me.server_time_offset_millis;
                var delay = me.shutdown_when_millis - server_now_millis;
                if (delay < 0) {
                    if (me.kind == "shutdown")
                        $("#shutdown-info").text(_("A shutdown is in progress."));
                    else
                        $("#shutdown-info").text(_("A restart is in progress."));
                    me.show_in_progress(me.shutdown_kind);
                } else {
                    if (me.kind == "shutdown")
                        $("#shutdown-info").text(F(_("The system is set to shutdown in %{delay}"),
                                                   { 'delay': cockpit_format_delay(delay) }));
                    else
                        $("#shutdown-info").text(F(_("The system is set to restart in %{delay}"),
                                                   { 'delay': cockpit_format_delay(delay) }));
                }
            } else {
                var t = new Date(me.shutdown_when_millis).toUTCString();
                if (me.kind == "shutdown")
                    $("#shutdown-info").text(F(_("The system is set to shutdown at %{time}"),
                                               { 'time': t }));
                else
                    $("#shutdown-info").text(F(_("The system is set to restart at %{time}"),
                                               { 'time': t }));
            }
        } else {
            $("#shutdown-idle").show();
            $("#shutdown-active").hide();
        }
    },

    shutdown: function(kind) {
        var me = this;
        var delay = $("#shutdown-delay").val();
        var message = $("#shutdown-message").val();

        if (!cockpit_check_role ('wheel', this.client))
            return;

        $("#shutdown-cancel").prop('disabled', false);

        if (delay == "0") {
            me.confirm(kind);
        } else {
            var when;
            if (delay == "x")
                when = $("#shutdown-exact-hours").val() + ":" + $("#shutdown-exact-minutes").val();
            else
                when = "+" + delay;

            this.manager.call('Shutdown', kind, when, message, function(error) {
                if (error)
                    cockpit_show_unexpected_error(error);
            });
        }
    },

    cancel: function() {
        if (!cockpit_check_role ('wheel', this.client))
            return;

        this.manager.call('CancelShutdown', function(error) {
            if (error)
                cockpit_show_unexpected_error(error);
        });
    },

    confirm: function(kind) {
        var me = this;
        me.confirm_kind = kind;

        $("#shutdown-confirm-spinner").hide();
        $("#shutdown-confirm-buttons").show();
        if (kind == 'shutdown') {
            $("#shutdown-confirm-title").text(_("Proceed with System Shutdown?"));
            $("#shutdown-confirm-body").text(_("All services will be halted.  You will not be able to log back in until the system is started again."));
            $("#shutdown-confirm-apply").text(_("Shutdown"));
        } else {
            $("#shutdown-confirm-title").text(_("Proceed with System Restart?"));
            $("#shutdown-confirm-body").text(_("All services will be halted while the system is restarted."));
            $("#shutdown-confirm-apply").text(_("Restart"));
        }
        $("#shutdown-confirm").modal('show');
    },

    confirm_apply: function() {
        var me = this;
        $("#shutdown-confirm").modal('hide');
        this.manager.call("Shutdown", me.confirm_kind, "now", "", function (error) {
            if (error)
                cockpit_show_unexpected_error(error);
        });
    },

    show_in_progress: function(kind) {
        var me = this;
        $("#shutdown-confirm-spinner").show();
        $("#shutdown-confirm-buttons").hide();

        var hostname = this.manager.PrettyHostname || this.manager.Hostname || this.address;

        if (kind == 'shutdown') {
            $("#shutdown-confirm-title").text(_("System Shutdown"));
            $("#shutdown-confirm-body").text(F(_("%{hostname} is being shutdown."),
                                               { 'hostname': hostname }));
        } else {
            $("#shutdown-confirm-title").text(_("System Restart"));
            $("#shutdown-confirm-body").text(F(_("Please wait while %{hostname} is restarted."),
                                               { 'hostname': hostname }));
        }

        $("#shutdown-confirm").modal('show');
    }
};

function PageShutdown() {
    this._init();
}

cockpit_pages.push(new PageShutdown());
