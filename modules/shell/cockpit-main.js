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

(function($, cockpit) {

var visited_pages = {};

cockpit.dbus = dbus;
cockpit.set_watched_client = set_watched_client;

function init() {
    cockpit.language_code = "";
    cockpit.language_po = null;

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
    content_init();
    cockpit.localize_pages();
    content_show();
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

cockpit.pages = [];

cockpit.loc_trail = undefined;

var current_hash;
var content_is_shown = false;

var page_navigation_count = 0;

function content_init() {
    var current_visible_dialog = null;
    var pages = $('#content > div');
    pages.each (function (i, p) {
        $(p).hide();
    });
    cockpit.loc_trail = [ ];

    $('div[role="dialog"]').on('show.bs.modal', function() {
        current_visible_dialog = $(this).attr("id");
        page_enter($(this).attr("id"));
    });
    $('div[role="dialog"]').on('shown.bs.modal', function() {
        page_show($(this).attr("id"));
    });
    $('div[role="dialog"]').on('hidden.bs.modal', function() {
        current_visible_dialog = null;
        page_leave($(this).attr("id"));
    });

    $(window).on('hashchange', function () {
        if (window.location.hash != current_hash) {
            if (current_visible_dialog)
                $('#' + current_visible_dialog).modal('hide');

            go_hash(window.location.hash);
        }
    });

    $(window).on('resize', function () {
        content_header_changed();
    });

    cockpit.content_refresh();
    $('.selectpicker').selectpicker();
}

function content_show() {
    $('#content-user-name').text(cockpit.connection_config.name || cockpit.connection_config.user || "???");

    $('.page').hide();
    $('#content').show();
    content_is_shown = true;
    go_hash(window.location.hash);
    phantom_checkpoint();
}

function content_leave() {
    for (var i = 0; i < cockpit.loc_trail.length; i++)
        page_leave_breadcrumb(cockpit.loc_trail[i].page);
    if (cockpit.loc_trail.length > 0)
        page_leave(cockpit.loc_trail[cockpit.loc_trail.length - 1].page);
    cockpit.loc_trail = [ ];
    content_is_shown = false;
}

cockpit.content_refresh = function content_refresh() {
    if (cockpit.loc_trail.length > 0)
        cockpit.go(cockpit.loc_trail);
};

function content_header_changed() {
    $('body').css('padding-top', $('#content nav').height());
}

cockpit.content_update_loc_trail = function content_update_loc_trail() {
    function go(t) {
        return function () {
            cockpit.go(t);
        };
    }

    var i;
    var box = $('#content-loc-trail');
    box.empty();
    for (i = 0; i < cockpit.loc_trail.length; i++) {
        var p = cockpit.page_from_id(cockpit.loc_trail[i].page);
        var title = p? (p.getTitleHtml? p.getTitleHtml() : cockpit_esc(p.getTitle())) : "??";
        var btn = $('<button>', { 'class': 'btn btn-default' }).html(title);
        box.append(btn);
        btn.on('click', go(cockpit.loc_trail.slice(0, i+1)));
    }

    var doc_title = "";
    if (cockpit.loc_trail.length == 1)
        doc_title = get_page_title(cockpit.loc_trail[0].page);
    else if (cockpit.loc_trail.length > 1) {
        doc_title = get_page_title(cockpit.loc_trail[1].page);
        if (cockpit.loc_trail.length > 2)
            doc_title = doc_title + " — " + get_page_title(cockpit.loc_trail[cockpit.loc_trail.length - 1].page);
    }
    document.title = doc_title;
};

cockpit.go = function go(trail) {
    var new_loc = trail[trail.length-1];

    function leave_breadcrumb(trail) {
        for (var i = 0; i < trail.length; i++)
            page_leave_breadcrumb(trail[i].page);
    }

    function enter_breadcrumb(trail) {
        for (var i = 0; i < trail.length; i++)
            page_enter_breadcrumb(trail[i].page);
    }

    page_navigation_count += 1;

    if ($('#' + new_loc.page).length === 0) {
        cockpit.go(trail.slice(0, trail.length-1));
        return;
    } else if (cockpit.loc_trail.length === 0) {
        leave_breadcrumb(cockpit.loc_trail);
        cockpit.loc_trail = trail;
        enter_breadcrumb(cockpit.loc_trail);
        $('#content-header-extra').empty();
        page_enter(new_loc.page);
    } else {
        var cur_loc = cockpit.loc_trail[cockpit.loc_trail.length - 1];
        page_leave(cur_loc.page);
        leave_breadcrumb(cockpit.loc_trail);
        cockpit.loc_trail = trail;
        enter_breadcrumb(cockpit.loc_trail);
        $('#content-header-extra').empty();
        page_enter(new_loc.page);
        $('#' + cur_loc.page).hide();
    }

    $('#' + new_loc.page).show();
    show_hash();
    cockpit.content_update_loc_trail();
    content_header_changed();
    page_show(new_loc.page);
};

cockpit.go_down = function go_down(loc) {
    if (loc.substr)
        loc = { page: loc };
    cockpit.go(cockpit.loc_trail.concat([ loc ]));
};

cockpit.go_sibling = function go_sibling(loc) {
    if (loc.substr)
        loc = { page: loc };
    cockpit.go(cockpit.loc_trail.slice(0, cockpit.loc_trail.length - 1).concat([ loc ]));
};

cockpit.go_top = function go_top(page, params) {
    var loc = $.extend({ page: page }, params);
    cockpit.go([ cockpit.loc_trail[0], loc ]);
};

cockpit.go_down_cmd = function go_down_cmd(page, params)
{
    var loc = $.extend({ page: page }, params);
    return "cockpit.go_down(" + JSON.stringify(loc) + ");";
};

cockpit.go_up = function go_up() {
    if (cockpit.loc_trail.length > 1)
        cockpit.go(cockpit.loc_trail.slice(0, cockpit.loc_trail.length - 1));
};

cockpit.go_server = function go_server(machine, extra) {
    var loc = [ { page: "server",
                  machine: machine
                }
              ];

    if (extra)
        loc = loc.concat(extra);

    if (cockpit.loc_trail.length > 1 && cockpit.loc_trail[0].page == "dashboard")
        loc =[ { page: "dashboard" } ].concat(loc);

    cockpit.go(loc);
};


function encode_trail(trail) {
    function encode (p)
    {
        var res = encodeURIComponent(p.page);
        var param;
        for (param in p) {
            if (param != "page" && p.hasOwnProperty(param))
                res += "?" + encodeURIComponent(param) + "=" + encodeURIComponent(p[param]);
        }
        return res;
    }

    var hash = '';
    for (var i = 0; i < trail.length; i++) {
        hash += encode(trail[i]);
        if (i < trail.length-1)
            hash += '&';
    }

    return '#' + hash;
}

function decode_trail(hash) {
    var locs, params, vals, trail, p, i, j;

    if (hash === "") {
        return [ { page: "dashboard" } ];
    }

    if (hash[0] == '#')
        hash = hash.substr(1);

    locs = hash.split('&');
    trail = [ ];

    for (i = 0; i < locs.length; i++) {
        params = locs[i].split('?');
        p = { page: decodeURIComponent(params[0]) };
        for (j = 1; j < params.length; j++) {
            vals = params[j].split('=');
            p[decodeURIComponent(vals[0])] = decodeURIComponent(vals[1]);
        }
        trail.push(p);
    }

    return trail;
}

function show_hash() {
    current_hash = encode_trail(cockpit.loc_trail);
    window.location.hash = current_hash;
}

function go_hash(hash) {
    cockpit.go(decode_trail(hash));
}

cockpit.page_from_id = function page_from_id(id) {
    var page = null;
    for (var n = 0; n < cockpit.pages.length; n++) {
        if (cockpit.pages[n].id == id) {
            page = cockpit.pages[n];
            break;
        }
    }
    return page;
};

function page_enter(id) {
    var page = cockpit.page_from_id(id);
    var first_visit = true;
    if (visited_pages[id])
        first_visit = false;

    if (page) {
        // cockpit_debug("enter() for page with id " + id);
        if (first_visit && page.setup)
            page.setup();
        page.enter();
    }
    visited_pages[id] = true;
    phantom_checkpoint ();
}

function page_leave(id) {
    var page = cockpit.page_from_id(id);
    if (page) {
        // cockpit_debug("leave() for page with id " + id);
        page.leave();
    }
    phantom_checkpoint ();
}

function page_show(id) {
    var page = cockpit.page_from_id(id);
    if (page) {
        // cockpit_debug("show() for page with id " + id);
        if (content_is_shown) {
            page.show();
        }
    }
    phantom_checkpoint ();
}

function page_enter_breadcrumb(id) {
    var page = cockpit.page_from_id(id);
    if (page && page.enter_breadcrumb)
        page.enter_breadcrumb();
}

function page_leave_breadcrumb(id) {
    var page = cockpit.page_from_id(id);
    if (page && page.leave_breadcrumb)
        page.leave_breadcrumb();
}

function get_page_title(id) {
    var page = cockpit.page_from_id(id);
    return page? page.getTitle() : _("Unknown Page");
}

cockpit.get_page_param = function get_page_param(key, page) {
    var index = cockpit.loc_trail.length-1;
    if (page) {
        while (index >= 0 && cockpit.loc_trail[index].page != page)
            index--;
    }
    if (index >= 0)
        return cockpit.loc_trail[index][key];
    else
        return undefined;
};

cockpit.set_page_param = function set_page_param(key, val) {
    if (val)
        cockpit.loc_trail[cockpit.loc_trail.length-1][key] = val;
    else
        delete cockpit.loc_trail[cockpit.loc_trail.length-1][key];
    show_hash ();
};

cockpit.show_error_dialog = function show_error_dialog(title, message) {
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

cockpit.show_unexpected_error = function show_unexpected_error(error) {
    cockpit.show_error_dialog(_("Unexpected error"), error.message || error);
};

/* A Location object can navigate to a different page, but silently
 * does nothing when some navigation has already happened since it was
 * created.
 */

Location.prototype = {
    go_up: function() {
        if (this.can_go())
            cockpit.go_up();
    },

    go: function(trail) {
        if (this.can_go())
            cockpit.go(trail);
    }
};

function Location(can_go) {
    this.can_go = can_go;
}

cockpit.location = function location() {
    var navcount = page_navigation_count;
    function can_navigate() {
        return navcount === page_navigation_count;
    }
    return new Location(can_navigate);
};

cockpit.confirm = function confirm(title, body, action_text) {
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

$(function() {
    $(".cockpit-deauthorize-item a").on("click", function(ev) {
        /* Ensure Channel.transport is not null */
        var channel = new Channel({ "payload": "null" });
        Channel.transport.logout(false);
        channel.close();
        $(".cockpit-deauthorize-item").addClass("disabled");
        $(".cockpit-deauthorize-item a").off("click");

        /* TODO: We need a better indicator for deauthorized state */
        $(".cockpit-deauthorize-status").text("deauthorized");
        ev.preventDefault();
    });

    var is_root = cockpit.connection_config.user == "root";
    $('#cockpit-go-account').toggle(!is_root);
    $('#cockpit-change-passwd').toggle(is_root);
});

cockpit.logout = function logout(reason) {
    var channel = new Channel({ "payload": "null" });
    $(channel).on("close", function() {
        window.location.reload(true);
    });
    cockpit.set_watched_client(null);
    Channel.transport.logout(true);
};

cockpit.go_login_account = function go_login_account() {
    cockpit.go_server("localhost",
                       [ { page: "accounts" },
                         { page: "account", id: cockpit.connection_config.user }
                       ]);
};

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
        cockpit.logout();
    }
};

function PageDisconnected() {
    this._init();
}

cockpit.pages.push(new PageDisconnected());

$(init);

})(jQuery, cockpit);
