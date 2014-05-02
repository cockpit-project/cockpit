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

   - $cockpit.connection_config

   An object with information about the current connection to the
   interface server when we are logged in.  It has 'user' and 'name'
   fields describing the user account of the logged in user.

   - $cockpit.language_code
   - $cockpit.language_po

   Information about the selected display language.  'language_code'
   contains the symbol identifying the language, such as "de" or "fi".
   'language_po' is a dictionary with the actual translations.

   - client = $cockpit.dbus(address, [options], [auto_reconnect])
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

   - $cockpit.init()
   - $cockpit.logged_in(config)

   Manage the life-cycle of the application.  'init' should be called
   when index.html has been loaded, and 'logged_in' should be called
   when we have successfully logged in.
*/

/* A connection to the webserver machine.  It is used to manage global
 * configuration, such as the list of machines to show on the
 * dashboard.
 */
var cockpit_dbus_local_client;

/* An array of the machines shown on the dashboard.  Each entry has
 * fields 'address', 'client', and 'dbus_iface'.
 */
var cockpit_machines = [ ];

/* A more or less random single client from the array above.  Used
 * with non-multi-server-aware pages.  This will eventually disappear
 * when all pages are multi-server-aware.
 */
var cockpit_dbus_client;

var cockpit_expecting_disconnect = false;

var $cockpit = $cockpit || { };

(function($, $cockpit) {

$cockpit.init = init;
$cockpit.logged_in = logged_in;

$cockpit.disconnect = disconnect;
$cockpit.hide_disconnected = hide_disconnected;
$cockpit.dbus = dbus;

function init() {
    $cockpit.language_code = "";
    $cockpit.language_po = null;
    cockpit_dbus_client = null;
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
        $cockpit.language_code = lang_code;
        $cockpit.language_po = data[lang_code];
        init_done();
    });
}

function init_done() {
    cockpit_login_init ();
    cockpit_content_init ();
    cockpit_localize_pages();

    cockpit_login_try ();
}

/* There are two classes of pages: Those that are multi-server aware,
   and those that are not.

   Pages that are not yet multi-server aware assume that there is only
   ever one D-Bus client, stored in cockpit_dbus_client, and that it is
   always "ready".

   These pages are protected from having their assumptions violated by
   never switching to them before cockpit_dbus_client is ready, and
   immediately popping up the modal "Disconnected" dialog when
   cockpit_dbus_client is closed.

   Currently, only the "dashboard" page is multi-server aware.
*/

function is_multi_server_aware (hash)
{
    return ((hash === "" && cockpit_machines.length != 1) ||
            hash == "#dashboard");
}

var dbus_clients = { };

function make_dict_key(dict) {
    function stringify_elt(k) { return JSON.stringify(k) + ':' + JSON.stringify(dict[k]); }
    return Object.keys(dict).sort().map(stringify_elt).join(";");
}

function dbus(address, options, auto_reconnect) {
    var key, client;

    options = $.extend({host: address}, options);
    key = make_dict_key(options);
    client = dbus_clients[key];

    if (!client) {
        dbus_debug("Creating dbus client for %s", key);
        client = new DBusClient(options.host, options);
        client._get_dbus_client_leases = 0;
        client._get_dbus_client_key = key;
        dbus_clients[key] = client;
    } else {
        dbus_debug("Getting dbus client for %s", key);
    }

    client._get_dbus_client_leases += 1;
    if (client.state == "closed" && auto_reconnect !== false)
        client.connect();

    function release() {
        dbus_debug("Releasing %s", key);
        // Only really release it after a delay
        setTimeout(function () {
            if (!client._get_dbus_client_leases) {
                console.warn("Releasing unleased client");
            } else {
                client._get_dbus_client_leases -= 1;
                if (client._get_dbus_client_leases === 0) {
                    delete dbus_clients[key];
                    dbus_debug("Closing %s", key);
                    client.close("unused");
                }
            }
        }, 10000);
    }

    client.release = release;
    return client;
}

function update_machines ()
{
    var i, j, found;
    var machines = cockpit_dbus_local_client.getInterfacesFrom ("/com/redhat/Cockpit/Machines",
                                                                "com.redhat.Cockpit.Machine");
    for (i = 0; i < machines.length; i++) {
        if (!cockpit_find_in_array (machines[i].Tags, "dashboard"))
            continue;

        found = false;
        for (j = 0; j < cockpit_machines.length; j++) {
            if (cockpit_machines[j].address == machines[i].Address) {
                found = true;
                break;
            }
        }
        if (!found) {
            cockpit_machines.push({ 'address': machines[i].Address,
                                    'client': new DBusClient(machines[i].Address),
                                    'dbus_iface': machines[i]
                                  });
        }
    }

    for (j = 0; j < cockpit_machines.length;) {
        found = false;
        for (i = 0; i < machines.length; i++) {
            if (cockpit_find_in_array (machines[i].Tags, "dashboard") &&
                cockpit_machines[j].address == machines[i].Address) {
                found = true;
                break;
            }
        }

        if (!found) {
            cockpit_machines[j].client.close();
            cockpit_machines.splice (j, 1);
        } else
            j += 1;
    }

    if (!cockpit_dbus_client)
        cockpit_select_legacy_client ();

    cockpit_dashboard_update_machines ();
}

function logged_in(config) {
    $cockpit.connection_config = config;
    init_connect_local();
}

function init_connect_local() {
    var i;

    cockpit_expecting_disconnect = false;

    cockpit_dbus_local_client = new DBusClient("localhost");
    $(cockpit_dbus_local_client).on('state-change.init', function () {
        if (cockpit_dbus_local_client.state == "ready") {
            $(cockpit_dbus_local_client).off('state-change.init');
            init_connect_machines();
        } else  if (cockpit_dbus_local_client.state == "closed") {
            $(cockpit_dbus_local_client).off('state-change.init');
            cockpit_logout(cockpit_dbus_local_client.error);
        }
    });

    $(cockpit_dbus_local_client).on('state-change', function () {
        if (!cockpit_dbus_local_client)
            return;

        cockpit_dashboard_local_client_state_change ();
    });
}

function init_connect_machines()
{
    cockpit_machines = [ ];
    cockpit_dbus_client = null;

    $(cockpit_dbus_local_client).on('objectAdded objectRemoved', function (event, object) {
        if (object.lookup('com.redhat.Cockpit.Machine'))
            update_machines ();
    });
    $(cockpit_dbus_local_client).on('propertiesChanged', function (event, object, iface) {
        if (iface._iface_name == "com.redhat.Cockpit.Machine")
            update_machines ();
    });
    update_machines ();

    if (is_multi_server_aware (window.location.hash))
        cockpit_content_show ();

    function legacy_client_state_change ()
    {
        if (cockpit_dbus_client.state == "closed" &&
            !is_multi_server_aware (window.location.hash))
            show_disconnected ();
        else if (cockpit_dbus_client.state == "ready") {
            hide_disconnected ();
            cockpit_content_show ();
        }
    }

    $(cockpit_dbus_client).on('state-change', legacy_client_state_change);
    legacy_client_state_change ();
}

function reconnect() {
    if (cockpit_dbus_client.state == "closed")
        cockpit_dbus_client.connect();
}

function disconnect() {
    var local_client = cockpit_dbus_local_client;
    var machines = cockpit_machines;

    cockpit_dbus_local_client = null;
    cockpit_machines = [];

    cockpit_expecting_disconnect = true;
    if (Channel.transport)
        Channel.transport.close('disconnecting');
}

function show_disconnected() {
    if (!cockpit_expecting_disconnect) {
        $("#disconnected-error").text(cockpit_client_error_description(cockpit_dbus_client.error));
        $('[role="dialog"]').modal('hide');
        $('#disconnected').modal('show');
    }
}

function hide_disconnected() {
    $('#disconnected').modal('hide');
}

})(jQuery, $cockpit);
