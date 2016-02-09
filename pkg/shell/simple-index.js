/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

var phantom_checkpoint = phantom_checkpoint || function () { };

define([
    "jquery",
    "base1/cockpit",
    "shell/base_index",
    'translated!base1/po',
    "manifests",
], function($, cockpit, base_index, po, manifests) {
    "use strict";

    cockpit.locale(po);
    var _ = cockpit.gettext;

    var default_title = "Cockpit";
    var manifest = manifests["shell"] || { };
    if (manifest.title)
        default_title = manifest.title;

    var shell_embedded = window.location.pathname.indexOf(".html") !== -1;

    var index = base_index.new_index_from_proto({
        navigate: function (state, sidebar) {
            return navigate(state, sidebar);
        },
        brand_sel: "#index-brand",
        logout_sel: "#go-logout",
        oops_sel: "#navbar-oops",
        language_sel: "#display-language",
        about_sel: "#about-version",
        default_title: default_title
    });

    var login_data = window.sessionStorage.getItem('login-data');
    if (login_data) {
        var data = JSON.parse(login_data);
        $("#content-user-name").text(data["displayName"]);
    }

    var compiled = base_index.new_compiled();
    compiled.load(manifests, "dashboard");

    /* Disconnection Dialog */
    var watchdog_problem = null;
    $(index).on("disconnect", function (ev, problem) {
        watchdog_problem = problem;
        show_disconnected();
    });

    /* Reconnect button */
    $("#machine-reconnect").on("click", function(ev) {
        window.sessionStorage.clear();
        window.location.reload(true);
    });

    function show_disconnected() {
        var current_frame = index.current_frame();
        if (current_frame)
            $(current_frame).hide();

        $(".curtains .spinner").toggle(false);
        $("#machine-reconnect").toggle(true);
        $(".curtains i").toggle(true);
        $(".curtains h1").text(_("Disconnected"));
        $(".curtains p").text(cockpit.message(watchdog_problem));
        $(".curtains").show();
        $("#navbar-dropdown").addClass("disabled");
        phantom_checkpoint();
    }

    index.ready();

    /* Handles navigation */
    function navigate(state, reconnect) {
        var dashboards = compiled.ordered("dashboard");

        /* If this is a watchdog problem or we are troubleshooting
         * let the dialog handle it */
        if (watchdog_problem)
            return;

        /* phantomjs has a problem retrieving state, so we allow it to be passed in */
        if (!state)
            state = index.retrieve_state();

        if (!state.component && dashboards.length > 0) {
            state.component = dashboards[0].path;
        }
        update_navbar(state);
        update_frame(state);

        index.recalculate_layout();

        /* Just replace the state, and URL */
        index.jump(state, true);
    }

    function update_navbar(state) {
        $(".dashboard-link").each(function() {
            var el = $(this);
            el.toggleClass("active", el.attr("data-component") === state.component);
        });

        var item = compiled.items[state.component];
        delete state.sidebar;

        $("#machine-link span").text(default_title);
        if ($(".dashboard-link").length < 2)
            $('#content-navbar').toggleClass("hidden", true);
    }

    function update_title(label) {
        if (label)
            label += " - ";
        else
            label = "";
        document.title = label + default_title;
    }

    function update_frame(state) {
        var title;
        var current_frame = index.current_frame();

        var hash = state.hash;
        var component = state.component;

        var frame;
        if (component)
            frame = index.frames.lookup(null, component, hash);
        if (frame != current_frame) {
            $(current_frame).css('display', 'none');
            index.current_frame(frame);
        }

        var label, item;
        $(frame).css('display', 'block');
        item = compiled.items[state.component];
        label = item ? item.label : "";
        update_title(label);

        phantom_checkpoint();
    }

    return index;
});
