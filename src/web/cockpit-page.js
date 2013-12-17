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

function cockpit_content_init ()
{
    $('#content').page();

    var pages = $('#content > [data-role="content"] > div');
    pages.each (function (i, p) {
        $(p).hide();
    });
    cockpit_loc_trail = [ ];

    $("div:jqmData(role=\"popup\")").bind("popupbeforeposition", function() {
	cockpit_page_enter($(this).attr("id"));
    });
    $("div:jqmData(role=\"popup\")").bind("popupafteropen", function() {
    	cockpit_page_show($(this).attr("id"));
    });
    $("div:jqmData(role=\"popup\")").bind("popupafterclose", function() {
    	cockpit_page_leave($(this).attr("id"));
    });

    // Rewrite links to popups to open via cockpit_popup or
    // cockpit_menu_open, as appropriate.
    //
    var popup_open = { };
    var m;
    $('[data-role="popup"]').each(function(i,p) {
        var href = "#" + $(p).attr('id');
        if ($(p).attr('data-menu') == 'true')
            popup_open[href] = 'cockpit_open_menu';
        else
            popup_open[href] = 'cockpit_popup';
    });
    $('a[href]').each(function(i,a) {
        a=$(a);
        m=popup_open[a.attr('href')];
        if (m) {
            a.attr('onclick', m + "(this, '" + a.attr('href') + "')");
            a.removeAttr('href');
        }
    });

    $(window).on('hashchange', function () {
         if (window.location.hash != cockpit_current_hash)
            cockpit_go_hash (window.location.hash);
    });

    cockpit_search_init ($('#content-search'));

    cockpit_content_refresh ();

    $('#content').on('pageshow', function () {
        cockpit_content_is_shown = true;
        if (cockpit_loc_trail.length > 0)
            cockpit_page_show (cockpit_loc_trail[cockpit_loc_trail.length-1].page);
    });

    $('#content').on('pagehide', function () {
        cockpit_content_is_shown = false;
    });
}

function cockpit_content_show ()
{
    $('#settings-button').text(cockpit_connection_config.name || cockpit_connection_config.user || "???").button('refresh');
    if (!$.mobile.activePage || $.mobile.activePage.attr('id') != "content") {
        $.mobile.changePage($('#content'), { changeHash: false });
        cockpit_go_hash (window.location.hash);
    }
}

function cockpit_content_refresh ()
{
    $('#content-search').attr('placeholder', _("Search"));
    if (cockpit_loc_trail.length > 0)
        cockpit_go (cockpit_loc_trail);
}

function cockpit_content_header_changed ()
{
    $('#content > [data-role="header"]').fixedtoolbar('updatePagePadding');
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
        var button = $('<button data-inline="true" data-theme="c">').html(title);
        box.append(button);
        button.on('click', go(cockpit_loc_trail.slice(0, i+1)));
    }
    box.trigger('create');

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

    cockpit_close_menu ();

    if ($('#' + new_loc.page).length === 0) {
        cockpit_go (trail.slice(0, trail.length-1));
        return;
    } else if (cockpit_loc_trail.length === 0) {
        cockpit_loc_trail = trail;
        $('#content-header-extra').empty();
        $('#content-search').val("");
        cockpit_page_enter (new_loc.page);
    } else {
        var cur_loc = cockpit_loc_trail[cockpit_loc_trail.length-1];
        cockpit_page_leave (cur_loc.page);
        cockpit_loc_trail = trail;
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

    var hash;
    if (trail.length == 1 && trail[0].page == "dashboard")
        hash = encode(trail[0]);
    else {
        hash = '';
        for (var i = 1; i < trail.length; i++) {
            hash += encode(trail[i]);
            if (i < trail.length-1)
                hash += '&';
        }
    }

    return '#' + hash;
}

function cockpit_decode_trail (hash)
{
    var locs, params, vals, trail, p, i, j;

    if (hash === "")
        hash = cockpit_machines.length == 1? "#server" : "#dashboard";
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
    if (trail[0].page != "dashboard")
        trail = [ { page: 'dashboard' } ].concat(trail);

    return trail;
}

function cockpit_show_hash ()
{
    cockpit_current_hash = cockpit_encode_trail (cockpit_loc_trail);
    $.mobile.navigate (cockpit_current_hash, { }, true);
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
        page.enter(first_visit);
    }
    cockpit_visited_pages[id] = true;
}

function cockpit_page_leave (id)
{
    var page = cockpit_page_from_id(id);
    if (page) {
        // cockpit_debug("leave() for page with id " + id);
        page.leave();
    }
}

function cockpit_page_show(id)
{
    var page = cockpit_page_from_id(id);
    if (page) {
        // cockpit_debug("show() for page with id " + id);
        if (cockpit_content_is_shown)
            page.show();
    }
}

function cockpit_get_page_title(id)
{
    var page = cockpit_page_from_id(id);
    return page? page.getTitle() : _("Unknown Page");
}

function cockpit_get_page_param(key)
{
    if (cockpit_loc_trail.length > 0)
        return cockpit_loc_trail[cockpit_loc_trail.length-1][key];
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
    $("#error-popup-title").text(title);
    $("#error-popup-message").text(message);
    cockpit_popup (null, "#error-popup");
}

function cockpit_show_unexpected_error(error)
{
    cockpit_show_error_dialog(_("Unexpected error"), error.message || error);
}
