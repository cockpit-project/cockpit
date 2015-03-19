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

   - client = shell.dbus(address, [options])
   - client.release()

   Manage the active D-Bus clients.  The 'dbus' function returns a
   client for the given 'address' with the given 'options'.  Use
   'client.release' to release it.  Typically, clients are gotten in
   the 'enter' method of a page and released again in 'leave'.

   A client returned by 'dbus' can be in any state; it isn't
   necessarily "ready".

   Clients stay around a while after they have been released by its
   last user.
*/

/* global jQuery   */
/* global cockpit  */

/* global phantom_checkpoint */

var shell = shell || { };
var modules = modules ||  { };

(function($, cockpit, shell, modules) {

shell.pages = [];
shell.dialogs = [];

var visited_dialogs = {};

shell.dbus = dbus;

/* Initialize cockpit when page is loaded and modules available */
var loaded = false;
modules.loaded = false;

function maybe_init() {
    if (loaded && modules.loaded)
        init();
}

/* HACK: Until all of the shell is loaded via AMD */
require([
    "system/server",
    "manifests"
], function(server, manifests) {
    modules.server = server;
    if (manifests["docker"]) {
        require([ "docker/docker" ], function (docker) {
            modules.docker = docker;
            modules.loaded = true;
            maybe_init();
        });
    } else {
        modules.loaded = true;
        maybe_init();
    }
});

function init() {
    $('.dropdown-toggle').dropdown();
    content_init();
    content_show();
}

require(["translated!base1/po"], function(po) {
    cockpit.locale(po);
});

var dbus_clients = shell.util.make_resource_cache();

function make_dict_key(dict) {
    function stringify_elt(k) { return JSON.stringify(k) + ':' + JSON.stringify(dict[k]); }
    return Object.keys(dict).sort().map(stringify_elt).join(";");
}

function dbus(address, options) {
    return dbus_clients.get(make_dict_key($.extend({host: address}, options)),
                            function () { return shell.dbus_client(address, options); });
}

/* current_params are the navigation parameters of the current page,
 * for example:
 *
 *   { host: "localhost",
 *     path: [ "storage-details" ],
 *     options: { type: "block", id: "/dev/vda" }
 *   }
 *
 * current_page_element is the HTML element for the current page.  For
 * modern pages, it is a iframe.
 *
 * current_legacy_page is the Page object for the current page if it
 * is a legacy page.  TODO: Remove this once there are no legacy pages
 * anymore.
 */
var current_params;
var current_page_element;
var current_legacy_page;

function content_init() {
    var current_visible_dialog = null;
    var pages = $('#content > div');
    pages.each (function (i, p) {
        $(p).hide();
    });
    current_params = null;

    $('div[role="dialog"]').on('show.bs.modal', function() {
        current_visible_dialog = $(this).attr("id");
        dialog_enter($(this).attr("id"));
    });
    $('div[role="dialog"]').on('shown.bs.modal', function() {
        dialog_show($(this).attr("id"));
    });
    $('div[role="dialog"]').on('hidden.bs.modal', function() {
        current_visible_dialog = null;
        dialog_leave($(this).attr("id"));
    });

    /* For legacy pages
     */
    $('#content-navbar a[data-page-id]').click(function () {
        cockpit.location.go([ cockpit.location.path[0], $(this).attr('data-page-id') ]);
    });

    /* For statically registered components
     */
    $('#content-navbar a[data-task-id]').click(function () {
        cockpit.location.go([ cockpit.location.path[0], $(this).attr('data-task-id') ]);
    });

    $(cockpit).on('locationchanged', function () {
        if (current_visible_dialog)
            $('#' + current_visible_dialog).modal('hide');
        display_location();
    });

    $(window).on('resize', function () {
        recalculate_layout();
    });

    shell.content_refresh();
    $('.selectpicker').selectpicker();

    hosts_init();
}

function content_show() {
    display_location();
    phantom_checkpoint();
}

shell.content_refresh = function content_refresh() {
    if (current_params)
        display_params(current_params);
};

function recalculate_layout() {
    var $extra = $('#shell-header-extra');
    var $body = $('body');

    $body.css('padding-top', $extra.height());

    // This is mostly for the plots.
    $(cockpit).trigger('resize');
}

/* Information for each host, keyed by address.  hosts[addr] is an
 * object with at least these fields:
 *
 * - display_name
 * - avatar
 * - color
 * - state
 * - problem
 * - cockpitd
 * - compare(other_host_object)
 * - set_display_name(name)
 * - set_avatar(avatar)
 * - set_color(color)
 * - reconnect()
 * - show_problem_dialog()
 * - remove()
 *
 * $(shell.hosts).on("added removed changed", function (addr) { });
 */
shell.hosts = { };

shell.host_setup = function host_setup() {
    $('#dashboard_setup_server_dialog').modal('show');
};

shell.host_colors = [
    "#0099d3",
    "#67d300",
    "#d39e00",
    "#d3007c",
    "#00d39f",
    "#00d1d3",
    "#00618a",
    "#4c8a00",
    "#8a6600",
    "#9b005b",
    "#008a55",
    "#008a8a",
    "#00b9ff",
    "#7dff00",
    "#ffbe00",
    "#ff0096",
    "#00ffc0",
    "#00fdff",
    "#023448",
    "#264802",
    "#483602",
    "#590034",
    "#024830",
    "#024848"
];

shell.default_permission = cockpit.permission({ group: "wheel" });

function pick_unused_host_color() {
    function in_use(color) {
        var norm = $.color.parse(color).toString();
        for (var a in shell.hosts) {
            var h = shell.hosts[a];
            if (h.color && $.color.parse(h.color).toString() == norm)
                return true;
        }
        return false;
    }

    for (var i = 0; i < shell.host_colors.length; i++) {
        if (!in_use(shell.host_colors[i]))
            return shell.host_colors[i];
    }
    return "gray";
}

function hosts_init() {

    var host_info = shell.hosts;
    var host_proxies;

    function update() {
        var want = { };
        for (var path in host_proxies) {
            var h = host_proxies[path];
            if (shell.find_in_array(h.Tags, "dashboard")) {
                want[h.Address] = h;
                if (!host_info[h.Address]) {
                    add_host(h.Address, h);
                    $(shell.hosts).trigger('added', [ h.Address ]);
                }
            }
        }
        for (var addr in host_info) {
            if (!want[addr]) {
                host_info[addr]._removed();
                delete host_info[addr];
                $(shell.hosts).trigger('removed', [ addr ]);
            }
        }
    }

    function add_host(addr, proxy) {
        var client = cockpit.dbus("com.redhat.Cockpit", { host: addr, bus: "session", track: true });
        var manager = client.proxy("com.redhat.Cockpit.Manager",
                                   "/com/redhat/Cockpit/Manager");

        var info = { display_name: null,
                     avatar: null,
                     color: null,
                     state: "connecting",
                     cockpitd: client,
                     address: addr,

                     compare: compare,
                     set_display_name: set_display_name,
                     set_avatar: set_avatar,
                     set_color: set_color,
                     reconnect: reconnect,
                     show_problem_dialog: show_problem_dialog,
                     remove: remove,

                     _removed: _removed
                   };

        function compare(other) {
            return info.display_name.localeCompare(other.display_name);
        }

        function remove() {
            proxy.RemoveTag("dashboard").
                fail(function (error) {
                    cockpit.show_unexpected_error(error);
                });
        }

        function update_hostname() {
            var name;
            if (manager.valid)
                name = shell.util.hostname_for_display(manager);
            else if (proxy.Name)
                name = proxy.Name;
            else
                name = addr;
            if (name != info.display_name) {
                info.display_name = name;
                update_global_nav();
            }
        }

        function update_from_proxy() {
            if (proxy.Color)
                info.color = proxy.Color;
            else if (info.color === null) {
                info.color = pick_unused_host_color();
                proxy.SetColor(info.color).
                    fail(function (error) {
                        console.warn(error);
                    });
            }

            info.avatar = proxy.Avatar;
            update_hostname();
        }

        function update_from_manager() {
            var name = shell.util.hostname_for_display(manager);
            if (name != proxy.Name)
                proxy.SetName(name);
            update_hostname();
        }

        function set_display_name(name) {
            if (manager.valid)
                return manager.SetHostname(name, manager.StaticHostname, {});
            else
                return $.Deferred().reject("not connected").promise();
        }

        function set_avatar(data) {
            return proxy.SetAvatar(data);
        }

        function set_color(color) {
            return proxy.SetColor(color);
        }

        function reconnect() {
            _removed();
            delete host_info[addr];
            $(shell.hosts).trigger('removed', [ addr ]);
            add_host(addr, proxy);
            $(shell.hosts).trigger('added', [ addr ]);
        }

        function show_problem_dialog() {
            $('#reconnect-dialog-summary').text(
                cockpit.format(_("Couldn't establish connection to $0."), info.display_name));
            $('#reconnect-dialog-problem').text(cockpit.message(info.problem));
            $('#reconnect-dialog-reconnect').off('click');
            $('#reconnect-dialog-reconnect').on('click', function () {
                $('#reconnect-dialog').modal('hide');
                reconnect();
            });
            $('#reconnect-dialog').modal('show');
        }

        function _removed() {
            $(manager).off('.hosts');
            client.close();
        }

        host_info[addr] = info;

        $(client).on("close", function (event, problem) {
            info.state = "failed";
            info.problem = problem;
            $(shell.hosts).trigger('changed', [ addr ]);
        });

        $(proxy).on('changed', function (event, props) {
            if ("Color" in props || "Avatar" in props || "Name" in props) {
                update_from_proxy();
                $(shell.hosts).trigger('changed', [ addr ]);
            }
        });
        update_from_proxy();

        manager.wait(function () {
            if (manager.valid) {
                info.state = "connected";
                $(manager).on('changed.hosts', function (event, props) {
                    if ("PrettyHostname" in props || "StaticHostname" in props) {
                        update_from_manager();
                        $(shell.hosts).trigger('changed', [ addr ]);
                    }
                });
                update_from_manager();
            }
        });
    }

    var cockpitd = cockpit.dbus("com.redhat.Cockpit", { host: "localhost", bus: "session", track: true });
    host_proxies = cockpitd.proxies("com.redhat.Cockpit.Machine",
                                    "/com/redhat/Cockpit/Machines");
    host_proxies.wait(function () {
        $(host_proxies).on('added removed changed', update);
        update();
    });
}

function update_global_nav() {
    var page_title = null;

    if (current_legacy_page) {
        var section_id = current_legacy_page.section_id || current_legacy_page.id;
        page_title = current_legacy_page.getTitle();
    } else if (current_page_element) {
        // TODO: change notification
        if (current_page_element[0].contentDocument)
            page_title = current_page_element[0].contentDocument.title;
    }

    var doc_title;
    if (page_title)
        doc_title = page_title;
    else
        doc_title = _("Cockpit");
    document.title = doc_title;

    recalculate_layout();
}

/* A map from path prefixes such as [ "tools" "terminal" ] to
 * component description objects.  Such an object has the following
 * fields:
 *
 * - pkg
 * - entry
 *
 * The package to load and the file of that package to use as the
 * entry point.
 */
var components = { };

/* A map from host-plus-path-prefixes to page <iframe> objects.
 */
var page_iframes = { };

/* A map from id to the page object, for legacy pages that
 * have been visited already.
 */
var visited_legacy_pages = { };

function register_component(prefix, package_name, entry) {
    var key = JSON.stringify(prefix);
    components[key] = { pkg: package_name, entry: entry };
}

function register_tool(ident, label) {
    var link = $("<a>").attr("data-task-id", ident).text(label);
    $("<li>").append(link).appendTo("#tools-menu");
}

/* HACK: Mozilla will unescape 'location.hash' before returning
 * it, which is broken.
 *
 * https://bugzilla.mozilla.org/show_bug.cgi?id=135309
 */
function get_location_hash(location) {
    return location.href.split('#')[1] || '';
}

function legacy_page_from_id(id) {
    var n;
    for (n = 0; n < shell.pages.length; n++) {
        if (shell.pages[n].id == id)
            return shell.pages[n];
    }
    return null;
}

/* The display_params function is the main place where we deal with legacy
 * pages.  TODO: Remove that.
 */

function display_params(params) {
    var element = null;
    var legacy_page = null;

    /* Try to find a legacy page for path[0].
     */
    var id = params.path[0];
    legacy_page = visited_legacy_pages[id];
    if (!legacy_page) {
        legacy_page = legacy_page_from_id(id);
        if (legacy_page) {
            if (legacy_page.setup)
                legacy_page.setup();
            visited_legacy_pages[id] = legacy_page;
        }
    }
    if (legacy_page)
        element = $('#' + id);

    if (!element) {
        cockpit.location.go([ "server" ]);
        return;
    }

    var old_element = current_page_element;
    var old_legacy_page = current_legacy_page;

    if (old_legacy_page)
        old_legacy_page.leave();

    $('#shell-header-extra').empty();
    current_params = params;
    current_page_element = element;
    current_legacy_page = legacy_page;
    if (legacy_page)
        legacy_page.enter();

    if (old_element)
        old_element.hide();
    update_global_nav();
    element.show();
    if (legacy_page)
        legacy_page.show();
}

function display_location() {
    var host = null;
    var path = cockpit.location.path.slice(0);
    var options = cockpit.location.options;

    if (path.length < 1)
        path = [ "dashboard" ];

    display_params({ host: host, path: path, options: options });
}

function dialog_from_id(id) {
    var n;
    for (n = 0; n < shell.dialogs.length; n++) {
        if (shell.dialogs[n].id == id)
            return shell.dialogs[n];
    }
    return null;
}

function dialog_enter(id) {
    var dialog = dialog_from_id(id);
    var first_visit = true;
    if (visited_dialogs[id])
        first_visit = false;

    if (dialog) {
        if (first_visit && dialog.setup)
            dialog.setup();
        if (!dialog.entered)
            dialog.enter();
        dialog.entered = true;
    }
    visited_dialogs[id] = true;
    phantom_checkpoint ();
}

function dialog_leave(id) {
    var dialog = dialog_from_id(id);
    if (dialog) {
        if (dialog.entered)
            dialog.leave();
        dialog.entered = false;
    }
    phantom_checkpoint ();
}

function dialog_show(id) {
    var dialog = dialog_from_id(id);
    if (dialog) {
        dialog.show();
    }
    phantom_checkpoint ();
}

shell.get_page_param = function get_page_param(key) {
    return current_params.options[key];
};

shell.set_page_param = function set_page_param(key, val) {
    if (val) {
        if (val == current_params.options[key])
            return;
        current_params.options[key] = val;
    } else {
        if (current_params.options[key] === undefined)
            return;
        delete current_params.options[key];
    }
    cockpit.location.replace(cockpit.location.path, current_params.options);
    current_params.options = cockpit.location.options;
};

shell.show_error_dialog = function show_error_dialog(title, message) {
    if (message) {
        $("#error-popup-title").text(title);
        $("#error-popup-message").text(message);
    } else {
        $("#error-popup-title").text(_("Error"));
        $("#error-popup-message").text(title);
    }

    $('.modal[role="dialog"]').modal('hide');
    $('#error-popup').modal('show');
};

shell.show_unexpected_error = function show_unexpected_error(error) {
    shell.show_error_dialog(_("Unexpected error"), error.message || error);
};

shell.confirm = function confirm(title, body, action_text) {
    var deferred = $.Deferred();

    $('#confirmation-dialog-title').text(title);
    if (typeof body == "string")
        $('#confirmation-dialog-body').text(body);
    else
        $('#confirmation-dialog-body').html(body);
    $('#confirmation-dialog-confirm').text(action_text);

    function close() {
        $('#confirmation-dialog button').off('click');
        $('#confirmation-dialog').modal('hide');
    }

    $('#confirmation-dialog-confirm').click(function () {
        close();
        deferred.resolve();
    });

    $('#confirmation-dialog-cancel').click(function () {
        close();
        deferred.reject();
    });

    $('#confirmation-dialog').modal('show');
    return deferred.promise();
};

/* Run when jQuery thinks page is loaded */
$(function() {
    loaded = true;
    maybe_init();
});

})(jQuery, cockpit, shell, modules);

function N_(str) {
    return str;
}

var _ = cockpit.gettext;
var C_ = cockpit.gettext;
