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

PageShutdownDialog.prototype = {
    _init: function() {
        this.id = "shutdown-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Shutdown");
    },

    setup: function() {
        $("#shutdown-restart").click($.proxy(this, "restart"));
        $("#shutdown-poweroff").click($.proxy(this, "poweroff"));
        $("#shutdown-delay").html(
            this.delay_btn = cockpit_select_btn($.proxy(this, "update"),
                                                [ { choice: "1",   title: _("1 Minute") },
                                                  { choice: "5",   title: _("5 Minutes") },
                                                  { choice: "20",  title: _("20 Minutes") },
                                                  { choice: "40",  title: _("40 Minutes") },
                                                  { choice: "60",  title: _("60 Minutes") },
                                                  { choice: "0",   title: _("No Delay") },
                                                  { choice: "x",   title: _("Specific Time") }
                                                ]).
                css("display", "inline"));

        $("#shutdown-time input").change($.proxy(this, "update"));
    },

    enter: function() {
        cockpit.get_page_param('machine', 'server') || "localhost";
        this.cockpitd = cockpit.dbus(this.address);
        this.cockpitd_manager = this.cockpitd.get("/com/redhat/Cockpit/Manager",
                                                  "com.redhat.Cockpit.Manager");
        $(this.cockpitd_manager).on("notify.shutdown", $.proxy(this, "update"));

        $("#shutdown-message").
            val("").
            attr("placeholder", _("Message to logged in users"));

        cockpit_select_btn_select (this.delay_btn, "1");

        this.update();
    },

    show: function() {
    },

    leave: function() {
        $(this.cockpitd_manager).off(".shutdown");
        this.cockpitd.release();
        this.cockpitd = null;
        this.cockpitd_manager = null;
    },

    update: function() {
        var disabled = false;

        if (this.cockpitd) {
            var host = this.cockpitd_manager.PrettyHostname || this.cockpitd_manager.Hostname || this.address;
            $('#shutdown-dialog .modal-title').text(F(_("Shutdown %{host}"), { host: host }));
        }

        var delay = cockpit_select_btn_selected(this.delay_btn);
        $("#shutdown-time").toggle(delay == "x");
        if (delay == "x") {
            var h = parseInt($("#shutdown-time input:nth-child(1)").val(), 10);
            var m = parseInt($("#shutdown-time input:nth-child(3)").val(), 10);
            var valid = (h >= 0 && h < 24) && (m >= 0 && m < 60);
            $("#shutdown-time").toggleClass("has-error", !valid);
            if (!valid)
                disabled = true;
        }

        $("#shutdown-dialog button.btn-primary").prop('disabled', disabled);
    },

    shutdown: function(op) {
        var delay = cockpit_select_btn_selected(this.delay_btn);
        var message = $("#shutdown-message").val();
        var when;

        if (delay == "x")
            when = ($("#shutdown-time input:nth-child(1)").val() + ":" +
                    $("#shutdown-time input:nth-child(3)").val());
        else
            when = "+" + delay;

        this.cockpitd_manager.call('Shutdown', op, when, message, function(error) {
            $('#shutdown-dialog').modal('hide');
            if (error && error.name != 'Disconnected')
                cockpit.show_unexpected_error(error);
        });
    },

    restart: function() {
        this.shutdown('restart');
    },

    poweroff: function() {
        this.shutdown('shutdown');
    }
};

function PageShutdownDialog() {
    this._init();
}

cockpit.pages.push(new PageShutdownDialog());
