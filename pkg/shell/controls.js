/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
], function($) {
"use strict";

var module = { };

// placement is optional, "top", "left", "bottom", "right"
module.update_privileged_ui = function update_privileged_ui(perm, selector, denied_message, placement) {
    var allowed = (perm.allowed !== false);
    $(selector).each(function() {
        // preserve old title first time to use when allowed
        // activate tooltip
        var allowed_key = 'allowed-title';
        if (typeof $(this).data(allowed_key) === 'undefined' ||
               $(this).data(allowed_key) === false)
            $(this).data(allowed_key, $(this).attr('title') || "");

        var options = { html: true };
        if (placement)
            options['placement'] = placement;

        $(this).tooltip(options);

        if ($(this).hasClass("disabled") === allowed) {
            $(this).toggleClass("disabled", !allowed)
                 .attr('data-original-title', null);

            if (allowed)
                $(this).attr('title', $(this).data(allowed_key));
            else
                $(this).attr('title', denied_message);

            $(this).tooltip('fixTitle');
        }
    });
};

return module;
});
