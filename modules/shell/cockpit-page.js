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

var cockpit_pages = [];
var cockpit_visited_pages = {};

var cockpit_loc_trail;

var cockpit_current_hash;
var cockpit_content_is_shown = false;

/* TODO: This should be a private variable */
var cockpit_page_navigation_count = 0;

function cockpit_content_init ()
{
    var pages = $('#content > div');
    pages.each (function (i, p) {
        $(p).hide();
    });
    cockpit_loc_trail = [ ];

    $('div[role="dialog"]').on('show.bs.modal', function() {
	cockpit_page_enter($(this).attr("id"));
    });
    $('div[role="dialog"]').on('shown.bs.modal', function() {
	cockpit_page_show($(this).attr("id"));
    });
    $('div[role="dialog"]').on('hidden.bs.modal', function() {
	cockpit_page_leave($(this).attr("id"));
    });

    $(window).on('hashchange', function () {
        if (window.location.hash != cockpit_current_hash)
            cockpit_go_hash (window.location.hash);
    });

    $(window).on('resize', function () {
        cockpit_content_header_changed ();
    });

    cockpit_search_init ($('#content-search'));

    cockpit_content_refresh ();
}

function cockpit_content_show ()
{
    $('#content-user-name').text(cockpit.connection_config.name || cockpit.connection_config.user || "???");

    $('.page').hide();
    $('#content').show();
    cockpit_content_is_shown = true;
    cockpit_go_hash (window.location.hash);
    phantom_checkpoint();
}

function cockpit_content_leave ()
{
    for (var i = 0; i < cockpit_loc_trail.length; i++)
        cockpit_page_leave_breadcrumb(cockpit_loc_trail[i].page);
    if (cockpit_loc_trail.length > 0)
        cockpit_page_leave (cockpit_loc_trail[cockpit_loc_trail.length-1].page);
    cockpit_loc_trail = [ ];
    cockpit_content_is_shown = false;
}

function cockpit_content_refresh ()
{
    $('#content-search').attr('placeholder', _("Search"));
    if (cockpit_loc_trail.length > 0)
        cockpit_go (cockpit_loc_trail);
}

function cockpit_content_header_changed ()
{
    $('body').css('padding-top', $('#content nav').height());
}

function cockpit_content_update_loc_trail ()
{
    function go(t) {
        return function () {
            cockpit_go (t);
        };
    }

    var i;
    var box = $('#content-loc-trail');
    box.empty();
    for (i = 0; i < cockpit_loc_trail.length; i++) {
        var p = cockpit_page_from_id (cockpit_loc_trail[i].page);
        var title = p? (p.getTitleHtml? p.getTitleHtml() : cockpit_esc(p.getTitle())) : "??";
        var btn = $('<button>', { 'class': 'btn btn-default' }).html(title);
        box.append(btn);
        btn.on('click', go(cockpit_loc_trail.slice(0, i+1)));
    }

    var doc_title = "";
    if (cockpit_loc_trail.length == 1)
        doc_title = cockpit_get_page_title (cockpit_loc_trail[0].page);
    else if (cockpit_loc_trail.length > 1) {
        doc_title = cockpit_get_page_title (cockpit_loc_trail[1].page);
        if (cockpit_loc_trail.length > 2)
            doc_title = doc_title + " — " + cockpit_get_page_title (cockpit_loc_trail[cockpit_loc_trail.length-1].page);
    }
    document.title = doc_title;
}

function cockpit_go (trail)
{
    var new_loc = trail[trail.length-1];

    function leave_breadcrumb(trail) {
        for (var i = 0; i < trail.length; i++)
            cockpit_page_leave_breadcrumb(trail[i].page);
    }

    function enter_breadcrumb(trail) {
        for (var i = 0; i < trail.length; i++)
            cockpit_page_enter_breadcrumb(trail[i].page);
    }

    cockpit_page_navigation_count += 1;

    if ($('#' + new_loc.page).length === 0) {
        cockpit_go (trail.slice(0, trail.length-1));
        return;
    } else if (cockpit_loc_trail.length === 0) {
        leave_breadcrumb(cockpit_loc_trail);
        cockpit_loc_trail = trail;
        enter_breadcrumb(cockpit_loc_trail);
        $('#content-header-extra').empty();
        $('#content-search').val("");
        cockpit_page_enter (new_loc.page);
    } else {
        var cur_loc = cockpit_loc_trail[cockpit_loc_trail.length-1];
        cockpit_page_leave (cur_loc.page);
        leave_breadcrumb(cockpit_loc_trail);
        cockpit_loc_trail = trail;
        enter_breadcrumb(cockpit_loc_trail);
        $('#content-header-extra').empty();
        $('#content-search').val("");
        cockpit_page_enter (new_loc.page);
        $('#' + cur_loc.page).hide();
    }

    $('#' + new_loc.page).show();
    cockpit_show_hash ();
    cockpit_content_update_loc_trail ();
    cockpit_content_header_changed ();
    cockpit_page_show (new_loc.page);
}

function cockpit_go_down (loc)
{
    if (loc.substr)
        loc = { page: loc };
    cockpit_go (cockpit_loc_trail.concat([ loc ]));
}

function cockpit_go_sibling (loc)
{
    if (loc.substr)
        loc = { page: loc };
    cockpit_go (cockpit_loc_trail.slice(0, cockpit_loc_trail.length-1).concat([ loc ]));
}

function cockpit_go_top (page, params)
{
    var loc = $.extend({ page: page }, params);
    cockpit_go ([ cockpit_loc_trail[0], loc ]);
}

function cockpit_go_down_cmd (page, params)
{
    var loc = $.extend({ page: page }, params);
    return "cockpit_go_down(" + JSON.stringify(loc) + ");";
}

function cockpit_go_up ()
{
    if (cockpit_loc_trail.length > 1)
        cockpit_go (cockpit_loc_trail.slice(0, cockpit_loc_trail.length-1));
}

function cockpit_go_server (machine, extra)
{
    var loc = [ { page: "server",
                  machine: machine
                }
              ];

    if (extra)
        loc = loc.concat(extra);

    if (cockpit_loc_trail.length > 1 && cockpit_loc_trail[0].page == "dashboard")
        loc =[ { page: "dashboard" } ].concat(loc);

    cockpit_go(loc);
}


function cockpit_encode_trail (trail)
{
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

function cockpit_decode_trail (hash)
{
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

function cockpit_show_hash ()
{
    cockpit_current_hash = cockpit_encode_trail (cockpit_loc_trail);
    window.location.hash = cockpit_current_hash;
}

function cockpit_go_hash (hash)
{
    cockpit_go (cockpit_decode_trail (hash));
}

function cockpit_page_from_id (id)
{
    var page = null;
    for (var n = 0; n < cockpit_pages.length; n++) {
        if (cockpit_pages[n].id == id) {
            page = cockpit_pages[n];
            break;
        }
    }
    return page;
}

function cockpit_page_enter (id)
{
    var page = cockpit_page_from_id(id);
    var first_visit = true;
    if (cockpit_visited_pages[id])
        first_visit = false;

    if (page) {
        // cockpit_debug("enter() for page with id " + id);
        if (first_visit && page.setup)
            page.setup();
        page.enter();
    }
    cockpit_visited_pages[id] = true;
    phantom_checkpoint ();
}

function cockpit_page_leave (id)
{
    var page = cockpit_page_from_id(id);
    if (page) {
        // cockpit_debug("leave() for page with id " + id);
        page.leave();
    }
    phantom_checkpoint ();
}

function cockpit_page_show(id)
{
    var page = cockpit_page_from_id(id);
    if (page) {
        // cockpit_debug("show() for page with id " + id);
        if (cockpit_content_is_shown) {
            page.show();
        }
    }
    phantom_checkpoint ();
}

function cockpit_page_enter_breadcrumb (id)
{
    var page = cockpit_page_from_id(id);
    if (page && page.enter_breadcrumb)
        page.enter_breadcrumb();
}

function cockpit_page_leave_breadcrumb (id)
{
    var page = cockpit_page_from_id(id);
    if (page && page.leave_breadcrumb)
        page.leave_breadcrumb();
}

function cockpit_get_page_title(id)
{
    var page = cockpit_page_from_id(id);
    return page? page.getTitle() : _("Unknown Page");
}

function cockpit_get_page_param(key, page)
{
    var index = cockpit_loc_trail.length-1;
    if (page) {
        while (index >= 0 && cockpit_loc_trail[index].page != page)
            index--;
    }
    if (index >= 0)
        return cockpit_loc_trail[index][key];
    else
        return undefined;
}

function cockpit_set_page_param(key, val)
{
    if (val)
        cockpit_loc_trail[cockpit_loc_trail.length-1][key] = val;
    else
        delete cockpit_loc_trail[cockpit_loc_trail.length-1][key];

    cockpit_show_hash ();
}

function cockpit_show_error_dialog(title, message)
{
    if (message) {
        $("#error-popup-title").text(title);
        $("#error-popup-message").text(message);
    } else {
        $("#error-popup-title").text(_("Error"));
        $("#error-popup-message").text(title);
    }

    $('.modal[role="dialog"]').modal('hide');
    $('#error-popup').modal('show');
}

function cockpit_show_unexpected_error(error)
{
    cockpit_show_error_dialog(_("Unexpected error"), error.message || error);
}

var cockpit = cockpit || { };

(function($, cockpit) {

/* A Location object can navigate to a different page, but silently
 * does nothing when some navigation has already happened since it was
 * created.
 */

Location.prototype = {
    go_up: function() {
        if (this.can_go())
            cockpit_go_up();
    },

    go: function(trail) {
        if (this.can_go())
            cockpit_go(trail);
    }
};

function Location(can_go) {
    this.can_go = can_go;
}

cockpit.location = function location() {
    var navcount = cockpit_page_navigation_count;
    function can_navigate() {
        return navcount === cockpit_page_navigation_count;
    }
    return new Location(can_navigate);
};

})($, cockpit);
