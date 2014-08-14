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

(function(cockpit, $) {

cockpit.i18n = function i18n(string, context) {
    var lookup_key = string;
    if (context)
        lookup_key = context + "\u0004" + string;

    var ret = string;
    if (cockpit.language_po) {
        var translated = cockpit.language_po[lookup_key];
        if (translated && translated.length >= 1 && translated[1].length > 0) {
            ret = translated[1];
        }
    }

    //cockpit_debug("`" + string + "' -> `" + ret + "' (ctx=" + context + ")");

    return ret;
};

cockpit.localize_pages = function localize_pages() {
    //if (cockpit_language_po != null)
    //    cockpit_debug("Localizing strings in DOM into " + (cockpit_language_po[""])["Language"]);
    $("[translatable=\"yes\"]").each(
        function(i, e) {
            // Save original string
            if (!e._orig)
                e._orig = $(e).text();

            var translated = cockpit.i18n(e._orig, e.getAttribute("context"));
            $(e).text(translated);
        });
    cockpit_content_refresh ();
};

})(cockpit, jQuery);

function F(format, args) {
    return format.replace(/%\{([^}]+)\}/g, function(_, key) { return args[key] || ""; });
}

function N_(str) {
    return str;
}
function _(string) {
    return cockpit.i18n(string);
}

function C_(context, string) {
    return cockpit.i18n(string, context);
}


