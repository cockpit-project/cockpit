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

   - shell.language_code

   Information about the selected display language.  'language_code'
   contains the symbol identifying the language, such as "de" or "fi".

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

   - shell.set_watched_client(client)

   Start watching the state of the given D-Bus client.  When it is
   closed, a modal dialog will pop up that prevents interaction with
   the current page (which is broken now because of the closed
   client).

   There can be at most one watched client at any given time.  Pass
   'null' to this function to stop watching any client.
*/

var shell = shell || { };

(function($, cockpit, shell) {

shell.language_code = null;
shell.pages = [];
shell.dialogs = [];

var visited_dialogs = {};

shell.dbus = dbus;
shell.set_watched_client = set_watched_client;

/* Initialize cockpit when page is loaded and packages available */
var packages;
var loaded = false;

function maybe_init() {
    if (packages && loaded)
        init();
}

function init() {
    content_init();
    content_show();
}

/*
 * TODO: Translations are disabled in the shell for now.
 * But we still want to know the language code, so load the locale po
 */

var locale = cockpit.locale({ }, false);
require(["cockpit/latest/po"], function(po) {
    shell.language_code = (po[""] ? po[""]["language"] : null);
});
shell.i18n = function i18n(string, context) {
    return string;
};


var dbus_clients = shell.util.make_resource_cache();

function make_dict_key(dict) {
    function stringify_elt(k) { return JSON.stringify(k) + ':' + JSON.stringify(dict[k]); }
    return Object.keys(dict).sort().map(stringify_elt).join(";");
}

function dbus(address, options) {
    return dbus_clients.get(make_dict_key($.extend({host: address}, options)),
                            function () { return shell.dbus_client(address, options); });
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

var page_navigation_count = 0;

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
    function update_name() {
        var str = cockpit.user["name"] || cockpit.user["user"] || "???";
        $('#content-user-name').text(str);
    }
    $(cockpit.info).on("changed", update_name);
    if (cockpit.user["name"])
        update_name();

    display_location();
    phantom_checkpoint();
}

shell.content_refresh = function content_refresh() {
    if (current_params)
        display_params(current_params);
};

function recalculate_layout() {
    var $topnav = $('#topnav');
    var $sidebar = $('#cockpit-sidebar');
    var $extra = $('#content-header-extra');
    var $body = $('body');

    var window_height = $(window).height();
    var topnav_width = $topnav.width();
    var topnav_height = $topnav.height()+2;
    var sidebar_width = $sidebar.is(':visible')? $sidebar.width() : 0;
    var extra_height = $extra.height();

    $sidebar.css('top', topnav_height);
    $sidebar.css('height', window_height - topnav_height);
    $extra.css('top', topnav_height);
    $extra.css('left', sidebar_width);
    $extra.css('width', topnav_width - sidebar_width);

    $body.css('padding-top', topnav_height + extra_height);
    $body.css('padding-left', sidebar_width);

    if (current_page_element && !current_legacy_page)
        current_page_element.height(window_height - topnav_height - extra_height);

    // This is mostly for the plots.
    $(cockpit).trigger('resize');
}

var local_account_proxies;

function check_admin() {
    var acc;

    if (cockpit.user["user"] == "root")
        return true;

    for (var path in local_account_proxies) {
        var a = local_account_proxies[path];
        if (a.UserName == cockpit.user["user"]) {
            acc = a;
            break;
        }
    }

    if (acc && acc.Groups) {
        if (shell.find_in_array(acc.Groups, "wheel"))
            return true;
        shell.show_error_dialog(_("Not authorized"), _("You are not authorized for this operation."));
        return false;
    }

    // When in doubt, just go ahead and let it fail later.
    return true;
}

/* Information for each host, keyed by address.  hosts[addr] is an
 * object with at least these fields:
 *
 * - display_name
 * - avatar
 * - color
 * - state
 * - cockpitd
 * - set_active()
 * - remove()
 *
 * $(shell.hosts).on("added removed changed", function (addr) { });
 */
shell.hosts = { };

shell.host_setup = function host_setup() {
    if (!check_admin())
        return;

    $('#dashboard_setup_server_dialog').modal('show');
};

function hosts_init() {

    var host_info = shell.hosts;
    var host_proxies;

    var host_colors = [
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

    function pick_color() {
        for (var i = 0; i < host_colors.length; i++) {
            var found = false;
            for (var addr in host_info) {
                if (host_info[addr].color == host_colors[i]) {
                    found = true;
                    break;
                }
            }
            if (!found)
                return host_colors[i];
        }
        return "grey";
    }

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

    function remember_last_params() {
        var old_info = host_info[current_params.host];
        if (old_info && current_params.path[0] != "dashboard") {
            old_info.last_path = current_params.path;
            old_info.last_options = current_params.options;
        }
    }

    function add_host(addr, proxy) {
        var client = cockpit.dbus("com.redhat.Cockpit", { host: addr, bus: "session" });
        var manager = client.proxy("com.redhat.Cockpit.Manager",
                                   "/com/redhat/Cockpit/Manager");

        var link, hostname_span, avatar_img;

        var info = { display_name: addr,
                     avatar: "",
                     color: null,
                     state: "connecting",
                     cockpitd: client,
                     set_active: set_active,
                     remove: remove,

                     _removed: _removed
                   };

        function remove() {
            if (proxy.valid) {
                proxy.RemoveTag("dashboard").
                    fail(function (error) {
                        cockpit.show_unexpected_error(error);
                    });
            }
        }

        link = $('<a class="list-group-item">').
            append(
                avatar_img = $('<img width="32" height="32" class="host-avatar">').
                    attr('src', "images/server-small.png"),
                hostname_span = $('<span>').
                    text(addr)).
            click(function () {
                remember_last_params();
                cockpit.location.go([ addr ].concat(info.last_path || [ "server" ]), info.last_options);
            });

        $('#hosts').append(link);

        function update_hostname() {
            info.display_name = shell.util.hostname_for_display(manager);
            hostname_span.text(info.display_name);
            if (manager.Hostcolor)
                info.color = manager.Hostcolor;
            else if (!info.color)
                info.color = pick_color();
            update_global_nav();
            $(shell.hosts).trigger('changed', [ addr ]);
        }

        function update_avatar() {
            manager.GetAvatarDataURL().
                done(function (result) {
                    if (result) {
                        info.avatar = result;
                        avatar_img.attr('src', result);
                        $(shell.hosts).trigger('changed', [ addr ]);
                    }
                });
        }

        function set_active() {
            $('#hosts > a').removeClass("active");
            link.addClass("active");
        }

        function _removed() {
            link.remove();
            $(manager).off('.hosts');
            client.close();
        }

        host_info[addr] = info;

        manager.wait(function () {
            if (manager.valid) {
                info.state = "connected";
                $(manager).on('changed.hosts', function (event, props) {
                    if ("PrettyHostname" in props || "StaticHostname" in props)
                        update_hostname();
                });
                $(manager).on('AvatarChanged.hosts', update_avatar);
                update_hostname();
                update_avatar();
            } else {
                info.state = "failed";
                $(shell.hosts).trigger('changed', [ addr ]);
            }
        });
    }

    $('#hosts').append(
        $('<a class="list-group-item">').
            append(
                $('<button class="btn btn-primary" style="float:right">').
                    text("+").
                    click(function () {
                        shell.host_setup();
                        return false;
                    }),
                $('<span>').
                    text("All Servers")).
            click(function () {
                remember_last_params();
                cockpit.location.go([]);
            }));

    $('#hosts-button').click(function () {
        $('#cockpit-sidebar').toggle();
        recalculate_layout();
    });

    local_account_proxies = null;

    var cockpitd = cockpit.dbus("com.redhat.Cockpit", { host: "localhost", bus: "session" });
    local_account_proxies = cockpitd.proxies("com.redhat.Cockpit.Account",
                                             "/com/redhat/Cockpit/Accounts");
    host_proxies = cockpitd.proxies("com.redhat.Cockpit.Machine",
                                    "/com/redhat/Cockpit/Machines");
    host_proxies.wait(function () {
        $(host_proxies).on('added removed changed', update);
        update();
    });
}

function update_global_nav() {
    var info;
    var hostname = null;
    var page_title = null;

    info = shell.hosts[current_params.host];
    if (info) {
        hostname = info.display_name;
        info.set_active();
    }

    $('#content-navbar-hostname').text(hostname);

    $('#content-navbar > li').removeClass('active');
    if (current_legacy_page) {
        var section_id = current_legacy_page.section_id || current_legacy_page.id;
        page_title = current_legacy_page.getTitle();
        $('#content-navbar > li').has('a[data-page-id="' + section_id + '"]').addClass('active');
    } else if (current_page_element) {
        // TODO: change notification
        if (current_page_element[0].contentDocument)
            page_title = current_page_element[0].contentDocument.title;
        // TODO: hmm...
        var task_id = current_params.path[0];
        $('#content-navbar > li').has('a[data-task-id="' + task_id + '"]').addClass('active');
    }

    var doc_title;
    if (hostname && page_title)
        doc_title = hostname + " — " + page_title;
    else if (page_title)
        doc_title = page_title;
    else if (hostname)
        doc_title = hostname;
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

function get_page_iframe(params) {
    /* Find the component that matches the longest prefix.  This
     * determines the prefix we will use.
     */
    var prefix, key, comp;
    for (var i = params.path.length; i >= 0; i--) {
        prefix = params.path.slice(0,i);
        key = JSON.stringify(prefix);
        if (components[key]) {
            comp = components[key];
            break;
        }
    }

    if (!comp)
        return null;

    /* Now find or create the iframe for it.
     */

    key = params.host + ":" + key;

    var iframe = page_iframes[key];
    if (!iframe) {
        var host = params.host;
        if (host == "localhost")
            host = "local";
        var name = "/" + encodeURIComponent(host) + "/" + prefix.map(encodeURIComponent).join("/");
        iframe = $('<iframe class="container-frame">').
            hide().
            attr('name', name);
        $('#content').append(iframe);
        register_child(iframe[0].contentWindow, params.host);
        page_iframes[key] = iframe;
        iframe.on('load', function () {
            /* Setting the "data-loaded" attribute helps the testsuite
             * to know when it can switch into the frame and inject
             * its own additions.
             */
            iframe.attr('data-loaded', true);
            update_global_nav();

            $(iframe[0].contentWindow).on('hashchange', function () {
                if (current_page_element == iframe) {
                    var options = { };
                    var inner_hash = get_location_hash(iframe[0].contentWindow.location);
                    var inner_path = cockpit.location.decode(inner_hash, options);
                    var outer_path = [ host ].concat(prefix, inner_path);
                    cockpit.location.go(outer_path, options);
                }
            });
        });
    }

    /* We get a package listing so that we can load the entry point
     * via checksums (which enables caching), but most importantly so
     * that cockpit-ws will learn all the checksums and can load other
     * pieces that the entry point refers to via checksums.
     */

    var href = cockpit.location.encode(params.path.slice(prefix.length), params.options);

    var pkg = comp.pkg + "@" + params.host;
    cockpit.packages.lookup(pkg).
        done(function (info) {
            var url = "/cockpit/";
            if (info.checksum)
                url += info.checksum;
            else
                url += pkg;
            iframe.attr('src', url + "/" + comp.entry + '#' + href);
        }).
        fail(function (error) {
            console.log("Error loading package " + pkg, error.toString());
            iframe.attr('src', "/cockpit/" + pkg + "/" + comp.entry + '#' + href);
        });

    return iframe;
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
    page_navigation_count += 1;

    var element = get_page_iframe(params);
    var legacy_page = null;

    /* Try to find a legacy page for path[0].
     */
    if (!element) {
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
    }

    if (!element) {
        cockpit.location.go([ "local", "dashboard" ]);
        return;
    }

    var old_element = current_page_element;
    var old_legacy_page = current_legacy_page;

    if (old_legacy_page)
        old_legacy_page.leave();

    $('#content-header-extra').empty();
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
    var host = cockpit.location.path[0];
    var path = cockpit.location.path.slice(1);
    var options = cockpit.location.options;

    if (!host || host == "local")
        host = "localhost";
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
        dialog.enter();
    }
    visited_dialogs[id] = true;
    phantom_checkpoint ();
}

function dialog_leave(id) {
    var dialog = dialog_from_id(id);
    if (dialog) {
        dialog.leave();
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

shell.get_page_machine = function get_page_machine() {
    return current_params.host;
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

function update_user_menu() {
    var is_root = (cockpit.user["user"] == "root");
    var is_not_root = (cockpit.user["user"] && !is_root);
    $('#cockpit-go-account').toggle(is_not_root);
    $('#cockpit-change-passwd').toggle(is_root);
    $('.cockpit-deauthorize-item').toggle(is_not_root);
}

$(function() {
    $(".cockpit-deauthorize-item a").on("click", function(ev) {
        cockpit.drop_privileges(false);
        $(".cockpit-deauthorize-item").addClass("disabled");
        $(".cockpit-deauthorize-item a").off("click");

        /* TODO: We need a better indicator for deauthorized state */
        $(".cockpit-deauthorize-status").text("deauthorized");
        ev.preventDefault();
    });

    update_user_menu();
    $(cockpit.user).on("changed", update_user_menu);
});

shell.go_login_account = function go_login_account() {
    cockpit.location.go([ "local", "account" ], { id: cockpit.user["user"] });
};

PageDisconnected.prototype = {
    _init: function() {
        this.id = "disconnected-dialog";
    },

    setup: function() {
        $('#disconnected-reconnect').click($.proxy(this, "reconnect"));
        $('#disconnected-logout').click($.proxy(this, "logout"));
    },

    enter: function() {
        $('#disconnected-error').text(shell.client_error_description(watched_client.error));
    },

    show: function() {
    },

    leave: function() {
    },

    reconnect: function() {
        watched_client.connect();
    },

    logout: function() {
        cockpit.logout();
    }
};

function PageDisconnected() {
    this._init();
}

shell.dialogs.push(new PageDisconnected());

var unique_id = 0;
var origin = cockpit.transport.origin;
var frame_peers_by_seed = { };
var frame_peers_by_name = { };

function register_child(child_window, host) {
    if (!child_window.name) {
        console.warn("invalid child window", child_window);
        return;
    }

    unique_id += 1;
    var seed = (cockpit.transport.options["channel-seed"] || "undefined:") + unique_id + "!";
    var peer = {
        window: child_window,
        channel_seed: seed,
        default_host: host,
        initialized: false
    };
    frame_peers_by_seed[seed] = peer;
    frame_peers_by_name[child_window.name] = peer;
}

function parse_init(data) {
    if (data[0] == '\n' && data.indexOf('"init"') !== -1) {
        var control = JSON.parse(data.substring(1));
        if (control.command === "init")
            return control;
    }
    return null;
}

cockpit.transport.filter(function(channel, message) {

    /* Control messages get forwarded to everyone */
    if (!channel) {
        $.each(frame_peers_by_seed, function(seed, peer) {
            if (peer.initialized)
                peer.window.postMessage(message, origin);
        });
        return true;

    /* Forward message to relevant frame */
    } else {
        var pos = channel.indexOf('!');
        if (pos !== -1) {
            var seed = channel.substring(0, pos + 1);
            var peer = frame_peers_by_seed[seed];
            if (peer && peer.initialized) {
                peer.window.postMessage(message, origin);
                return false; /* Stop delivery */
            }
        }
        /* Still deliver the message locally */
        return true;
    }

});

window.addEventListener("message", function(event) {
    if (event.origin !== origin)
        return;

    var data = event.data;
    if (typeof data !== "string")
        return;

    var frame = event.source;
    var peer = frame_peers_by_name[frame.name];
    if (!peer || peer.window != frame)
        return;

    /* Closing the transport */
    if (data.length === 0) {
        peer.initialized = false;
        return;
    }

    /*
     * init messages are a single hop. We know the client is
     * loaded when it sends one. We reply with our own.
     * A bit of optimization here.
     */
    var init = parse_init(data);
    if (init) {
        peer.initialized = true;
        var reply = $.extend({ }, cockpit.transport.options,
            { "default-host": peer.default_host, "channel-seed": peer.channel_seed }
        );
        frame.postMessage("\n" + JSON.stringify(reply), origin);
        return;
    }

    if (!peer.initialized) {
        console.warn("child frame " + frame.name + " sending data without init");
        return;
    }

    /* Everything else gets forwarded */
    cockpit.transport.inject(data);
}, false);

/* This tells child frames we are a parent wants to accept messages */
if (!window.options)
    window.options = { };
$.extend(window.options, { sink: true, protocol: "cockpit1" });

cockpit.packages.all(true).
    done(function(pkgs) {
        packages = pkgs;

        var list = $.map(pkgs, function(pkg) { return pkg; });
        list.sort(function(a, b) {
            return a.name == b.name ? 0 : a.name < b.name ? -1 : 1;
        });

        var seen = { };
        $.each(list, function(i, pkg) {
            var tools = pkg.manifest.tools;
            if (!tools)
                return;
            $.each(tools, function(ident, info) {
                if (seen[ident])
                    return;
                seen[ident] = ident;
                register_component([ ident ], pkg.name, info.path);
                register_tool(ident, info.label);
            });
        });

        maybe_init();
    }).
    fail(function(ex) {
        packages = { };
        maybe_init();

        throw ex; /* should show an oops */
    });

/* Run when jQuery thinks page is loaded */
$(function() {
    register_component([ "playground" ], "playground", "test.html");
    loaded = true;
    maybe_init();
});

})(jQuery, cockpit, shell);

function F(format, args) {
    return format.replace(/%\{([^}]+)\}/g, function(_, key) { return args[key] || ""; });
}

function N_(str) {
    return str;
}
function _(string) {
    return shell.i18n(string);
}

function C_(context, string) {
    return shell.i18n(string, context);
}
