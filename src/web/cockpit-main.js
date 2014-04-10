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

var cockpit_connection_config;

var cockpit_language_code;
var cockpit_language_po;

function cockpit_init() {
    cockpit_language_code = "";
    cockpit_language_po = null;
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
        cockpit_init_load_lang(lang_code);
    } else {
        cockpit_init_get_config();
    }
}

function cockpit_init_load_lang(lang_code) {
    //cockpit_debug("Loading language `" + lang_code + "'");
    var jqxhr = $.getJSON("lang/" + lang_code + ".json");
    jqxhr.error(function() {
        cockpit_debug("Error loading language \"" + lang_code + "\"");
        cockpit_init_get_config();
    });
    jqxhr.success(function(data) {
        cockpit_language_code = lang_code;
        cockpit_language_po = data[lang_code];
        cockpit_init_get_config();
    });
}

function cockpit_init_get_config() {
    cockpit_login_init ();
    cockpit_content_init ();
    cockpit_localize_pages();

    var req = new XMLHttpRequest();
    var loc = window.location.protocol + "//" + window.location.host + "/login";
    req.open("GET", loc, true);
    req.onreadystatechange = function (event) {
	if (req.readyState == 4) {
            if (req.status == 200) {
                // Nice, we are logged in.
                cockpit_connection_config = JSON.parse(req.responseText);
                cockpit_init_connect_local();
            } else {
                // Log in
                cockpit_login_show();
	    }
        }
    };
    req.send();
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

function cockpit_is_multi_server_aware (hash)
{
    return ((hash === "" && cockpit_machines.length != 1) ||
            hash == "#dashboard");
}

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

function cockpit_get_dbus_client (address)
{
    for (var i = 0; i < cockpit_machines.length; i++) {
        if (cockpit_machines[i].address == address)
            return cockpit_machines[i].client;
    }
    return null;
}

function cockpit_update_machines ()
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

function cockpit_init_connect_local()
{
    var i;

    cockpit_expecting_disconnect = false;

    cockpit_dbus_local_client = new DBusClient("localhost");
    $(cockpit_dbus_local_client).on('state-change.init', function () {
        if (cockpit_dbus_local_client.state == "ready") {
            $(cockpit_dbus_local_client).off('state-change.init');
            cockpit_init_connect_machines();
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

function cockpit_init_connect_machines()
{
    cockpit_machines = [ ];
    cockpit_dbus_client = null;

    $(cockpit_dbus_local_client).on('objectAdded objectRemoved', function (event, object) {
        if (object.lookup('com.redhat.Cockpit.Machine'))
            cockpit_update_machines ();
    });
    $(cockpit_dbus_local_client).on('propertiesChanged', function (event, object, iface) {
        if (iface._iface_name == "com.redhat.Cockpit.Machine")
            cockpit_update_machines ();
    });
    cockpit_update_machines ();

    if (cockpit_is_multi_server_aware (window.location.hash))
        cockpit_content_show ();

    function legacy_client_state_change ()
    {
        if (cockpit_dbus_client.state == "closed" &&
            !cockpit_is_multi_server_aware (window.location.hash))
            cockpit_show_disconnected ();
        else if (cockpit_dbus_client.state == "ready") {
            cockpit_hide_disconnected ();
            cockpit_content_show ();
        }
    }

    $(cockpit_dbus_client).on('state-change', legacy_client_state_change);
    legacy_client_state_change ();
}

function cockpit_reconnect() {
    if (cockpit_dbus_client.state == "closed")
        cockpit_dbus_client.connect();
}

function cockpit_disconnect() {
    var local_client = cockpit_dbus_local_client;
    var machines = cockpit_machines;

    cockpit_dbus_local_client = null;
    cockpit_machines = [];

    cockpit_expecting_disconnect = true;
    if (Channel.transport)
        Channel.transport.close('disconnecting');
}

var cockpit_expecting_disconnect = false;

function cockpit_show_disconnected() {
    if (!cockpit_expecting_disconnect) {
        $("#disconnected-error").text(cockpit_client_error_description(cockpit_dbus_client.error));
        $('[role="dialog"]').modal('hide');
        $('#disconnected').modal('show');
    }
}

function cockpit_hide_disconnected() {
    $('#disconnected').modal('hide');
}
