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
    "react",
    "performance/dialog-view",
    "playground/react-demo-dialog",
], function(cockpit, React, dialog_pattern, demo_dialog) {

"use strict";

var _ = cockpit.gettext;

var on_dialog_standard_clicked = function() {
    var dfd = cockpit.defer();
    dfd.notify(_("Status message"));
    dfd.resolve();
    // dfd.reject();
    return dfd.promise;
};

var on_dialog_done = function(success) {
    var result = success?"successful":"Canceled";
    document.getElementById("demo-dialog-result").textContent = "Dialog closed: " + result;
};

var on_standard_demo_clicked = function(static_error) {
    var dialog_props = {
        'title': _("Example React Dialog"),
        'body': React.createElement(demo_dialog),
    };
    var footer_props = {
        'primary_clicked': on_dialog_standard_clicked,
        'primary_caption': _("OK"),
        'static_error': static_error,
        'dialog_done': on_dialog_done,
    };
    dialog_pattern.show_modal_dialog(dialog_props, footer_props);
};

document.getElementById('demo-show-dialog').addEventListener("click", on_standard_demo_clicked.bind(null, null), false);
document.getElementById('demo-show-error-dialog').addEventListener("click", on_standard_demo_clicked.bind(null, 'Some static error'), false);

});
