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

/* MAIN

   - cockpit.connection_config

   An object with information about the current connection to the
   interface server when we are logged in.  It has 'user' and 'name'
   fields describing the user account of the logged in user.

   - cockpit.language_code
   - cockpit.language_po

   Information about the selected display language.  'language_code'
   contains the symbol identifying the language, such as "de" or "fi".
   'language_po' is a dictionary with the actual translations.

   - client = cockpit.dbus(address, [options], [auto_reconnect])
   - client.release()

   Manage the active D-Bus clients.  The 'dbus' function returns a
   client for the given 'address' with the given 'options'.  Use
   'client.release' to release it.  Typically, clients are gotten in
   the 'enter' method of a page and released again in 'leave'.

   A client returned by 'dbus' can be in any state; it isn't
   necessarily "ready". However, if it is closed and auto_reconnect is
   not false, a reconnection attempt will be started.  (The
   auto_reconnect parameter defaults to 'true'.)

   Clients stay around a while after they have been released by its
   last user.
*/

var cockpit = cockpit || { };

(function($, cockpit) {

cockpit.dbus = dbus;

$(init);

function init() {
    cockpit.language_code = "";
    cockpit.language_po = null;
    cockpit_visited_pages = {};

    var lang_code = null;
    var language, language_normalized, code, code_normalized;

    // First load translations, if any... first, check browser storage
    lang_code = cockpit_settings_get("lang-code");

    // If that didn't work, try inferring from whatever language the
    // browser is using... this is a language code from RFC4646, see
    // http://tools.ietf.org/html/rfc4646
    if (!lang_code) {
        language = window.navigator.userLanguage || window.navigator.language;
        language_normalized = language.toLowerCase().replace("_", "-");
        for (code in cockpitdyn_supported_languages) {
            if (code.length > 0) {
                code_normalized = code.toLowerCase().replace("_", "-");
                if (language_normalized.indexOf(code_normalized) === 0) {
                    lang_code = code;
                }
            }
        }
    }

    if (lang_code) {
        init_load_lang(lang_code);
    } else {
        init_done();
    }
}

function init_load_lang(lang_code) {
    //cockpit_debug("Loading language `" + lang_code + "'");
    var jqxhr = $.getJSON("lang/" + lang_code + ".json");
    jqxhr.error(function() {
        cockpit_debug("Error loading language \"" + lang_code + "\"");
        init_done();
    });
    jqxhr.success(function(data) {
        cockpit.language_code = lang_code;
        cockpit.language_po = data[lang_code];
        init_done();
    });
}

function init_done() {
    cockpit_login_init ();
    cockpit_content_init ();
    cockpit_localize_pages();

    cockpit_login_try ();
}

var dbus_clients = { };

function make_dict_key(dict) {
    function stringify_elt(k) { return JSON.stringify(k) + ':' + JSON.stringify(dict[k]); }
    return Object.keys(dict).sort().map(stringify_elt).join(";");
}

function dbus(address, options, auto_reconnect) {
    var key, handle;
    var client;

    options = $.extend({host: address}, options);
    key = make_dict_key(options);
    handle = dbus_clients[key];

    if (!handle) {
        dbus_debug("Creating dbus client for %s", key);
        handle = { refcount: 1, client: new DBusClient(options.host, options) };
        dbus_clients[key] = handle;

        handle.client.release = function() {
            dbus_debug("Releasing %s", key);
            // Only really release it after a delay
            setTimeout(function () {
                if (!handle.refcount) {
                    console.warn("Releasing unreffed client");
                } else {
                    handle.refcount -= 1;
                    if (handle.refcount === 0) {
                        delete dbus_clients[key];
                        dbus_debug("Closing %s", key);
                        handle.client.close("unused");
                    }
                }
            }, 10000);
        };
    } else {
        dbus_debug("Getting dbus client for %s", key);
        handle.refcount += 1;
    }

    if (handle.client.state == "closed" && auto_reconnect !== false)
        handle.client.connect();

    return handle.client;
}

})(jQuery, cockpit);
