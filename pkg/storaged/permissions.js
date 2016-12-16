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

    var _ = cockpit.gettext;

    /* PERMISSIONS
     */

    function update_privileged_ui(perm, selector, denied_message) {
        var allowed = (perm.allowed !== false);
        $(selector).each(function() {
            // preserve old title first time to use when allowed
            // activate tooltip
            var allowed_key = 'allowed-title';
            if (typeof $(this).data(allowed_key) === 'undefined' ||
                $(this).data(allowed_key) === false)
                $(this).data(allowed_key, $(this).attr('title') || "");
            $(this).tooltip({ html: true });

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
    }

    var permission = cockpit.permission({ admin: true });

    function update_storage_privileged() {
        update_privileged_ui(permission, ".storage-privileged",
                             cockpit.format(
                                 _("The user <b>$0</b> is not permitted to manage storage"),
                                 permission.user ? permission.user.name : ''));
    }

    $(permission).on("changed", update_storage_privileged);

    module.exports = {
        permission: permission,
        update: update_storage_privileged
    };

}());
