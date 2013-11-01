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

    $("#disconnected-screen").on('click', function(e) {
        e.stopPropagation();
    });

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
                cockpit_init_connect();
            } else {
                // Log in
                cockpit_login_show();
	    }
        }
    };
    req.send();
}

var cockpit_dbus_clients;
var cockpit_dbus_client;

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
    return ((cockpit_dbus_clients.length != 1 && window.location.hash === "") ||
            window.location.hash == "#dashboard");
}

function cockpit_update_machines ()
{
    var i, j, found;

    var machines = cockpit_settings_get_json ("machines");

    for (i = 0; i < machines.length; i++) {
        found = false;
        for (j = 0; j < cockpit_dbus_clients.length; j++) {
            if (cockpit_dbus_clients[j].target == machines[i]) {
                found = true;
                break;
            }
        }
        if (!found)
            cockpit_dbus_clients.push (new DBusClient(machines[i]));
    }

    for (j = 0; j < cockpit_dbus_clients.length;) {
        found = false;
        for (i = 0; i < machines.length; i++) {
            if (cockpit_dbus_clients[j].target == machines[i]) {
                found = true;
                break;
            }
        }
        if (!found) {
            cockpit_dbus_clients[j].close();
            cockpit_dbus_clients.splice (j, 1);
        } else
            j += 1;
    }

    if (!cockpit_dbus_client && cockpit_dbus_clients.length > 0)
        cockpit_dbus_client = cockpit_dbus_clients[0];

    cockpit_dashboard_update_machines ();
}

function cockpit_add_machine (machine)
{
    var machines = cockpit_settings_get_json ("machines");
    if (!machines)
        machines = [ ];

    for (var i = 0; i < machines.length; i++) {
        if (machines[i] == machine)
            return;
    }

    machines.push (machine);
    cockpit_settings_set_json ("machines", machines);
    cockpit_update_machines ();
}

function cockpit_remove_machine (machine)
{
    var machines = cockpit_settings_get_json ("machines");
    for (var i = 0; i < machines.length; i++) {
        if (machines[i] == machine) {
            machines.splice (i, 1);
            cockpit_settings_set_json ("machines", machines);
            cockpit_update_machines ();
            return;
        }
    }
}

function cockpit_init_connect()
{
    var i;

    var machines = cockpit_settings_get_json ("machines");
    if (!machines)
        machines = [ "localhost" ];
    cockpit_settings_set_json ("machines", machines);

    cockpit_dbus_clients = [ ];
    cockpit_dbus_client = null;
    cockpit_update_machines ();

    if (cockpit_is_multi_server_aware (window.location.hash))
        cockpit_content_show ();

    $(cockpit_dbus_client).on('state-change', function () {
        if (cockpit_dbus_client.state == "closed" && !cockpit_is_multi_server_aware (window.location.hash))
            cockpit_show_disconnected ();
        else if (cockpit_dbus_client.state == "ready") {
            cockpit_hide_disconnected ();
            cockpit_content_show ();
        }
    });
}

function cockpit_reconnect() {
    if (cockpit_dbus_client.state == "closed")
        cockpit_dbus_client.connect();
}

function cockpit_disconnect() {
    var clients = cockpit_dbus_clients;
    cockpit_dbus_clients = [];
    for (var i = 0; i < clients.length; i++)
        clients[i].close("disconnecting");
}

function cockpit_show_disconnected() {
    $("#disconnected-error").text(cockpit_client_error_description(cockpit_dbus_client.error));
    $('[data-role="popup"]').popup('close');
    cockpit_popup(null, "#disconnected");
}

function cockpit_hide_disconnected() {
    $("#disconnected").popup('close');
}

var last_menu;

function cockpit_open_menu(btn, id)
{
    btn = $(btn);

    var header = btn.parents('[data-role=\"header\"]');

    // move the menu into the current page
    var page = $.mobile.activePage;
    page.append($(id + '-popup'));
    page.append($(id + '-screen'));
    var menu = $(id);

    menu.popup({ tolerance: '0,0,0,0' });
    menu.popup('open',
               { x: btn.offset().left + menu.width()/2,
                 y: $(window).scrollTop() + header.height() + menu.height() / 2 });
    last_menu = menu;

    $(window).on('scroll.menu', cockpit_close_menu);
    $(window).on('resize.menu', cockpit_close_menu);
    menu.on('popupafterclose.menu', function () {
        $(window).off('scroll.menu');
        $(window).off('resize.menu');
        menu.off('popupafterclose.menu');
    });
}

function cockpit_close_menu()
{
    if (last_menu)
        last_menu.popup('close');
}

function cockpit_popup(btn, id) {
    cockpit_close_menu();

    // move the popup into the current page
    var page = $.mobile.activePage;
    page.append($(id + '-popup'));
    page.append($(id + '-screen'));
    $(id).popup('open');
}

$(document).on('mobileinit', function () {
    $.mobile.ajaxEnabled = false;
    $.mobile.linkBindingEnabled = false;
    $.mobile.hashListeningEnabled = false;
});
