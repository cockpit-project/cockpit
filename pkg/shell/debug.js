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

var shell = shell || { };

(function($, cockpit, shell) {

/*
 * HACK: Don't touch window.onerror in phantomjs, once it's non-null
 * it ignores default handling, even if the default handler returns
 * false.
 */
var oops = null;
function setup_oops() {
    if (oops)
        return true;
    oops = $("#navbar-oops");
    if (!oops)
        return false;
    oops.children("a").on("click", function() {
        $("#error-popup-title").text(_("Unexpected error"));
        var details = _("Cockpit had an unexpected internal error. <br/><br/>") +
                  _("You can try restarting Cockpit by pressing refresh in your browser. ") +
                  _("The console contains more details about this error");
        $("#error-popup-message").html(details);
        $('#error-popup').modal('show');
    });
    return true;
}

if (window.navigator.userAgent.indexOf("PhantomJS") == -1) {

    var old_onerror = window.onerror;
    window.onerror = function cockpit_error_handler(msg, url, line) {
        if (setup_oops())
            oops.show();
        if (old_onerror)
            return old_onerror(msg, url, line);
        return false;
    };
}

})(jQuery, cockpit, shell);
