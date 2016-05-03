/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

require([
    "base1/cockpit",
    "base1/react",
    "performance/dialog-view",
    "playground/react-demo-dialog",
    "base1/cockpit-components-terminal",
    "playground/react-demo-listing",
], function(cockpit, React, dialog_pattern, demo_dialog, cockpit_terminal, demo_listing) {

"use strict";

var _ = cockpit.gettext;

/*-----------------------------------------------------------------------------
  Modal Dialog
  -----------------------------------------------------------------------------
 */

var last_action = "";

var on_dialog_standard_clicked = function(mode) {
    last_action = mode;
    var dfd = cockpit.defer();
    dfd.notify(_("Starting something long"));
    if (mode == 'steps') {
        var interval, count = 0;
        window.setInterval(function() {
            count += 1;
            dfd.notify("Step " + count);
        }, 500);
        window.setTimeout(function() {
            window.clearTimeout(interval);
            dfd.resolve();
        }, 5000);
        dfd.promise.cancel = function() {
            window.clearTimeout(interval);
            dfd.reject(_("Action canceled"));
        };
    } else if (mode == 'reject') {
        dfd.reject(_("Some error occurred"));
    } else {
        dfd.resolve();
    }
    return dfd.promise;
};

var on_dialog_done = function(success) {
    var result = success?"successful":"Canceled";
    var action = success?last_action:"no action";
    document.getElementById("demo-dialog-result").textContent = "Dialog closed: " + result + "(" + action + ")";
};

var on_standard_demo_clicked = function(static_error) {
    var dialog_props = {
        'title': _("Example React Dialog"),
        'body': React.createElement(demo_dialog),
    };
    var footer_props = {
        'actions': [
              { 'clicked': on_dialog_standard_clicked.bind(null, 'standard action'),
                'caption': _("OK"),
                'style': 'primary',
              },
              { 'clicked': on_dialog_standard_clicked.bind(null, 'dangerous action'),
                'caption': _("Danger"),
                'style': 'danger',
              },
              { 'clicked': on_dialog_standard_clicked.bind(null, 'steps'),
                'caption': _("Wait"),
                'style': 'primary',
              },
              { 'clicked': on_dialog_standard_clicked.bind(null, 'reject'),
                'caption': _("Error"),
                'style': 'primary',
              },
          ],
        'static_error': static_error,
        'dialog_done': on_dialog_done,
    };
    dialog_pattern.show_modal_dialog(dialog_props, footer_props);
};

document.getElementById('demo-show-dialog').addEventListener("click", on_standard_demo_clicked.bind(null, null), false);
document.getElementById('demo-show-error-dialog').addEventListener("click", on_standard_demo_clicked.bind(null, 'Some static error'), false);

cockpit.user.addEventListener('changed', function (user) {
    var channel = cockpit.channel({
        "payload": "stream",
        "spawn": [cockpit.user.shell || '/bin/bash', "-i"],
        "environ": [
            "TERM=xterm-256color",
            "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
        ],
        "directory": cockpit.user.home || '/',
        "pty": true
    });

    React.render(React.createElement(cockpit_terminal.Terminal, {
        channel: channel,
    }), document.getElementById('demo-react-terminal'));
});


/*-----------------------------------------------------------------------------
  Listing Pattern
  -----------------------------------------------------------------------------
 */
// create the listing
demo_listing.demo(document.getElementById('demo-listing'));


});
