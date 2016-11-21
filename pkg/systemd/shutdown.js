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

var $ = require("jquery");
var cockpit = require("cockpit");

/* These add themselves to jQuery so just including is enough */
require("patterns");
require("bootstrap-datepicker/dist/js/bootstrap-datepicker");

var _ = cockpit.gettext;

/* The server time object */
var server_time = null;

/* The current operation */
var operation = null;

/* The entry point, shows the dialog */
module.exports = function shutdown(op, st) {
    operation = op;
    server_time = st;
    $('#shutdown-dialog').modal('show');
};

$('#shutdown-dialog .shutdown-date').datepicker({
    autoclose: true,
    todayHighlight: true,
    format: 'yyyy-mm-dd',
    startDate: "today",
});

$("#shutdown-dialog input")
    .on('focusout', update)
    .on('change', update);

/* The delay in the dialog */
var delay = 0;
$("#shutdown-dialog .dropdown li")
    .on("click", function(ev) {
        delay = $(this).attr("value");
        update();
    });

/* Prefilling the date if it's been set */
var cached_date = null;
$('#shutdown-dialog .shutdown-date')
    .on('focusin', function() {
        cached_date = $(this).val();
    })
    .on('focusout', function() {
        if ($(this).val().length === 0)
            $(this).val(cached_date);
    });

$("#shutdown-dialog").on("show.bs.modal", function(ev) {

    /* The date picker also triggers this event, since it is modal */
    if (ev.target.id !== "shutdown-dialog")
        return;

    $("#shutdown-dialog textarea").
        val("").
        attr("placeholder", _("Message to logged in users")).
        attr("rows", 5);

    /* Track the value correctly */
    delay = $("#shutdown-dialog li:first-child").attr("value");

    server_time.wait().then(function() {
        $('#shutdown-dialog .shutdown-date').val(server_time.format());
        $('#shutdown-dialog .shutdown-hours').val(server_time.utc_fake_now.getUTCHours());
        $('#shutdown-dialog .shutdown-minutes').val(server_time.utc_fake_now.getUTCMinutes());
    });

    if (operation == 'shutdown') {
        $('#shutdown-dialog .modal-title').text(_("Shut Down"));
        $("#shutdown-dialog .btn-danger").text(_("Shut Down"));
    } else {
        $('#shutdown-dialog .modal-title').text(_("Restart"));
        $("#shutdown-dialog .btn-danger").text(_("Restart"));
    }

    update();
});

function update() {
    $("#shutdown-dialog input").parent().toggle(delay == "x");
    $("#shutdown-dialog .dropdown button span").text($("#shutdown-dialog li[value='" + delay + "']").text());

    var val = parseInt($('#shutdown-dialog .shutdown-minutes').val(), 10);
    if (val < 10)
        $('#shutdown-dialog .shutdown-minutes').val("0" + val);
}

/* Validate the input fields */
function calculate() {
    if (delay != "x")
        return cockpit.resolve("+" + delay);

    var datestr = $("#shutdown-dialog .shutdown-date").val();
    var hourstr = $("#shutdown-dialog .shutdown-hours").val();
    var minstr = $("#shutdown-dialog .shutdown-minutes").val();

    var h = parseInt(hourstr, 10);
    var m = parseInt(minstr, 10);

    var time_error = false;
    if (isNaN(h) || h < 0 || h > 23  ||
        isNaN(m) || m < 0 || m > 59) {
        time_error = true;
    }

    var date = new Date(datestr);

    var date_error = false;
    if (isNaN(date.getTime()) || date.getTime() < 0)
        date_error = true;

    var ex = null;
    if (time_error && date_error) {
        ex = new Error(_("Invalid date format and invalid time format"));
    } else if (time_error) {
        ex = new Error (_("Invalid time format"));
    } else if (date_error) {
        ex = new Error (_("Invalid date format"));
    }

    if (ex) {
        ex.target = "table td:last-child div";
        return cockpit.reject(ex);
    }

    var cmd = ["date", "--date=" + datestr + " " + hourstr + ":" + minstr, "+%s"];
    return cockpit.spawn(cmd, { err: "message" }).then(function(data) {
        var input_timestamp = parseInt(data, 10);
        var server_timestamp = parseInt(server_time.now.getTime() / 1000, 10);
        var offset = Math.ceil((input_timestamp - server_timestamp) / 60);

        /* If the time in minutes just changed, make it happen now */
        if (offset === -1) {
            offset = 0;

        /* Otherwise this is a failure */
        } else if (offset < 0) {
            console.log("Shutdown offset in minutes is in the past:", offset);
            ex = new Error(_("Cannot schedule event in the past"));
            ex.target = "table td:last-child div";
            return cockpit.reject(ex);
        }

        return "+" + offset;
    });
}

/* Perform the actual action */
function perform(message) {
    return calculate().then(function(when) {
        var arg = (operation == "shutdown") ? "--poweroff" : "--reboot";
        var message = $("#shutdown-dialog textarea").val();
        if (operation == "restart")
            cockpit.hint("restart");
        return cockpit.spawn(["shutdown", arg, when, message], { superuser: true, err: "message" });
    });
}

/* Perform the action */

$("#shutdown-dialog .btn-danger").click(function() {
    $("#shutdown-dialog").dialog("promise", perform());
});
