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

   - client = cockpit.dbus(address, [options])
   - client.release()

   Manage the active D-Bus clients.  The 'dbus' function returns a
   client for the given 'address' with the given 'options'.  Use
   'client.release' to release it.  Typically, clients are gotten in
   the 'enter' method of a page and released again in 'leave'.

   A client returned by 'dbus' can be in any state; it isn't
   necessarily "ready".

   Clients stay around a while after they have been released by its
   last user.

   - cockpit.set_watched_client(client)

   Start watching the state of the given D-Bus client.  When it is
   closed, a modal dialog will pop up that prevents interaction with
   the current page (which is broken now because of the closed
   client).

   There can be at most one watched client at any given time.  Pass
   'null' to this function to stop watching any client.
*/

var cockpit = cockpit || { };

(function($, cockpit, cockpit_pages) {

cockpit.dbus = dbus;
cockpit.set_watched_client = set_watched_client;

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

var dbus_clients = cockpit.util.make_resource_cache();

function make_dict_key(dict) {
    function stringify_elt(k) { return JSON.stringify(k) + ':' + JSON.stringify(dict[k]); }
    return Object.keys(dict).sort().map(stringify_elt).join(";");
}

function dbus(address, options) {
    return dbus_clients.get(make_dict_key($.extend({host: address}, options)),
                            function () { return new DBusClient(address, options); });
}

var watched_client = null;

function set_watched_client(client) {
    $(watched_client).off('.client-watcher');
    $('#disconnected-dialog').modal('hide');

    function update() {
        if (watched_client && watched_client.state == "closed") {
            $('.modal[role="dialog"]').modal('hide');
            $('#disconnected-dialog').modal('show');
        } else
            $('#disconnected-dialog').modal('hide');
    }

    watched_client = client;
    $(watched_client).on('state-change.client-watcher', update);
    update ();
}

PageDisconnected.prototype = {
    _init: function() {
        this.id = "disconnected-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Disconnected");
    },

    setup: function() {
        $('#disconnected-reconnect').click($.proxy(this, "reconnect"));
        $('#disconnected-logout').click($.proxy(this, "logout"));
    },

    enter: function() {
        $('#disconnected-error').text(cockpit.client_error_description(watched_client.error));
    },

    show: function() {
    },

    leave: function() {
    },

    reconnect: function() {
        watched_client.connect();
    },

    logout: function() {
        cockpit_logout();
    }
};

function PageDisconnected() {
    this._init();
}

cockpit_pages.push(new PageDisconnected());

})(jQuery, cockpit, cockpit_pages);
