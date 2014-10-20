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
    lang_code = localStorage.getItem("lang-code");

    // If that didn't work, try inferring from whatever language the
    // browser is using... this is a language code from RFC4646, see
    // http://tools.ietf.org/html/rfc4646
    if (!lang_code) {
        language = window.navigator.userLanguage || window.navigator.language;
        language_normalized = language.toLowerCase().replace("_", "-");
        /* TODO: Get the list of languages from packages */
        for (code in { }) {
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
    var jqxhr = $.getJSON("lang/" + lang_code + ".json");
    jqxhr.error(function() {
        console.warn("Error loading language \"" + lang_code + "\"");
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
                            function () { return cockpit.dbus_client(address, options); });
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

/* cockpit.loc is a dict with the parameters of the current page.  The
 * page itself is stored as the "page" parameter.  For example
 *
 *   { page: "storage-details", type: "block", id: "/dev/vda",
 *     machine: "localhost"
 *   }
 */

cockpit.loc = undefined;

var current_hash;
var content_is_shown = false;

var page_navigation_count = 0;

/* HACK: Mozilla will unescape 'window.location.hash' before returning
 * it, which is broken.
 *
 * https://bugzilla.mozilla.org/show_bug.cgi?id=135309
 */

function get_window_location_hash() {
    return '#' + (window.location.href.split('#')[1] || '');
}

function set_window_location_hash(hash) {
    window.location.hash = hash;
}

function content_init() {
    var current_visible_dialog = null;
    var pages = $('#content > div');
    pages.each (function (i, p) {
        $(p).hide();
    });
    cockpit.loc = null;

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
        var hash = get_window_location_hash();
        if (hash != current_hash) {
            if (current_visible_dialog)
                $('#' + current_visible_dialog).modal('hide');

            go_hash(hash);
        }
    });

    $(window).on('resize', function () {
        content_header_changed();
    });

    cockpit.content_refresh();
    $('.selectpicker').selectpicker();
}

function content_show() {
    function update_name() {
        var str = cockpit.user["name"] || cockpit.user["user"] || "???";
        $('#content-user-name').text(str);
    }
    $(cockpit.info).on("changed", update_name);

    $('.page').hide();
    $('#content').show();
    content_is_shown = true;
    go_hash(get_window_location_hash());
    phantom_checkpoint();
}

function content_leave() {
    if (cockpit.loc) {
        page_leave(cockpit.loc.page);
        leave_global_nav();
    }
    cockpit.loc = null;
    content_is_shown = false;
}

cockpit.content_refresh = function content_refresh() {
    if (cockpit.loc)
        cockpit.go(cockpit.loc);
};

function content_header_changed() {
    $('body').css('padding-top', $('#content nav').height());
}

var nav_cockpitd;
var nav_manager;

function enter_global_nav() {
    if (cockpit.loc.machine) {
        nav_cockpitd = cockpit.dbus(cockpit.get_page_machine());
        nav_manager = nav_cockpitd.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");
        $(nav_manager).on('notify:PrettyHostname.main',
                          update_global_nav);
        $(nav_manager).on('notify:StaticHostname.main',
                          update_global_nav);
    }
}

function leave_global_nav() {
    if (nav_manager) {
        $(nav_manager).off('.main');
        nav_cockpitd.release();
        nav_manager = null;
        nav_cockpitd = null;
    }
}

function update_global_nav() {
    var hostname = null;
    var page_title = null;

    if (nav_manager)
        hostname = cockpit.util.hostname_for_display(nav_manager);

    if (cockpit.loc)
        page_title = get_page_title(cockpit.loc.page);

    var global = $('#content-global-breadcrumb');
    global.empty();
    global.append(
        $('<button>', { 'class': 'btn btn-default' }).
            text(_("Hosts")).
            click(function () {
                cockpit.go({ page: "dashboard" });
            }));

    if (hostname) {
        global.append(
            $('<button>', { 'class': 'btn btn-default' }).
                text(cockpit.util.hostname_for_display(nav_manager)).
                click(function () {
                    cockpit.go({ page: "server",
                                 machine: cockpit.loc.machine });
                }));
    }

    if (page_title) {
        global.append(
            $('<button>', { 'class': 'btn btn-default' }).
                text(page_title).
                click(cockpit.content_refresh));
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
}

// TODO - remove this
cockpit.content_update_loc_trail = update_global_breadcrumb;

cockpit.go = function go(loc) {
    page_navigation_count += 1;

    if ($('#' + loc.page).length === 0) {
        cockpit.go({ page: "dashboard" });
        return;
    }

    var old_loc = cockpit.loc;

    if (old_loc) {
        page_leave(old_loc.page);
        leave_global_nav();
    }

    $('#content-header-extra').empty();
    cockpit.loc = loc;
    show_hash();
    enter_global_nav();
    page_enter(loc.page);

    if (old_loc)
        $('#' + old_loc.page).hide();
    $('#' + loc.page).show();
    update_global_nav();
    content_header_changed();
    page_show(loc.page);
};

cockpit.go_rel = function go_rel(loc) {
    if (loc.substr)
        loc = { page: loc };
    if (cockpit.loc)
        loc.machine = cockpit.loc.machine;
    return cockpit.go(loc);
};

cockpit.go_rel_cmd = function go_cmd(page, params)
{
    var loc = $.extend({ page: page }, params);
    return "cockpit.go_rel(" + JSON.stringify(loc) + ");";
};

function encode_loc(loc) {
    var res = encodeURIComponent(loc.page);
    var param;
    for (param in loc) {
        if (param != "page" && loc.hasOwnProperty(param))
            res += "?" + encodeURIComponent(param) + "=" + encodeURIComponent(loc[param]);
    }
    return "#" + res;
}

function decode_loc(hash) {
    var params, vals, loc, i;

    if (hash === "" || hash === "#") {
        return { page: "dashboard" };
    }

    if (hash[0] == '#')
        hash = hash.substr(1);

    params = hash.split('?');
    loc = { page: decodeURIComponent(params[0]) };
    for (i = 1; i < params.length; i++) {
        vals = params[i].split('=');
        loc[decodeURIComponent(vals[0])] = decodeURIComponent(vals[1]);
    }
    return loc;
}

function show_hash() {
    current_hash = encode_loc(cockpit.loc);
    set_window_location_hash(current_hash);
}

function go_hash(hash) {
    cockpit.go(decode_loc(hash));
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
        // cockpit.debug("enter() for page with id " + id);
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
        page.leave();
    }
    phantom_checkpoint ();
}

function page_show(id) {
    var page = cockpit.page_from_id(id);
    if (page) {
        if (content_is_shown) {
            page.show();
        }
    }
    phantom_checkpoint ();
}

function get_page_title(id) {
    var page = cockpit.page_from_id(id);
    return page? page.getTitle() : _("Unknown Page");
}

cockpit.get_page_param = function get_page_param(key) {
    return cockpit.loc[key];
};

cockpit.get_page_machine = function get_page_machine() {
    return cockpit.get_page_param('machine') || "localhost";
};

cockpit.set_page_param = function set_page_param(key, val) {
    if (val)
        cockpit.loc[key] = val;
    else
        delete cockpit.loc[key];
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
    go_rel: function(loc) {
        if (this.can_go())
            cockpit.go_rel(loc);
    },

    go: function(loc) {
        if (this.can_go())
            cockpit.go(loc);
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

cockpit.go_login_account = function go_login_account() {
    cockpit.go({ page: "account", id: cockpit.user["user"],
                 machine: "localhost" });
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

/*
 * ----------------------------------------------------------------------------
 * TODO: Temporary hack to register pages that live in packages
 * The entireity of page building and componentizing needs reworking here.
 *
 * In particular, note that we have to squeeze in the concept of using
 * multiple frames for different servers.
 */

function PageExternal(id, url, title) {
    var self = this;
    self.id = id;
    self.title = title;
    self.history = [ "" ];
    self.history_pos = 0;

    self.current = null;
    self.frames = { };
    self.body = $("<div>").attr("id", self.id).hide();
    $("#content").append(self.body);

    self.getTitle = function() { return self.title; };

    /* Resize iframes to fill body */
    function resize() {
        if (self.current) {
            self.current.height(function() {
                return $(window).height() - $(this).offset().top;
            });
        }
    }

    $(window).on('resize', resize);

    self.enter = function enter() {
        /* TODO: This is total bullshit */
        var server = cockpit.get_page_machine();
        if (!server)
            server = "localhost";
        var frame = self.frames[server];
        if (!frame) {
            /* TODO: This *still* only loads packages from localhost */
            frame = $(document.createElement("iframe"));
            frame.addClass("container-frame").
                attr("name", id + "-" + server).
                hide().attr("src", url + current_hash);
            self.body.append(frame);
            self.frames[server] = frame;
        }
        if (frame != self.current) {
            if (self.current)
                self.current.hide();
            self.current = frame;
            self.current.show();
        }
        resize();
    };

    self.show = function show() {
        if (self.current)
            self.current.focus();
        resize();
    };

    self.leave = function() { };
}


/* Initialize cockpit when page is loaded */
$(function() {
    /* TODO: for now bring in component package pages */
    var terminal = new PageExternal("terminal", "/cockpit/@@server@@/terminal.html",
            C_("page-title", "Rescue Terminal"));
    cockpit.pages.push(terminal);

    /* Initialize the rest of Cockpit */
    init();
});

})(jQuery, cockpit);
