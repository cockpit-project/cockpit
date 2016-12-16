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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var Mustache = require("mustache");
    var service = require("service");

    var client = require("./client");
    var overview = require("./overview");
    var container_details = require("./details");
    var image_details = require("./image");
    var storage = require("./storage.jsx");

    require("page.css");
    require("table.css");
    require("./docker.css");

    var _ = cockpit.gettext;

    /* CURTAIN
     */

    var curtain_tmpl;
    var docker_service = service.proxy("docker");

    function init_curtain(client, navigate) {
        curtain_tmpl = $("#curtain-tmpl").html();
        Mustache.parse(curtain_tmpl);

        $(client).on('failure', function (event, error) {
            show_curtain(error);
        });

        $('#curtain').on('click', '[data-action=docker-start]', function () {
            show_curtain(null);
            docker_service.start().
                done(function () {
                    client.close();
                    client.connect().done(navigate);
                }).
                fail(function (error) {
                    show_curtain(cockpit.format(_("Failed to start Docker: $0"), error));
                });
        });

        $('#curtain').on('click', '[data-action=docker-connect]', function () {
            show_curtain(null);
            client.close();
            client.connect().done(navigate);
        });
    }

    function show_curtain(ex) {
        var info = { };

        if (ex === null) {
            info.connecting = true;
        } else if (typeof ex == "string") {
            info.other = ex;
            console.warn(ex);
        } else if (ex.problem == "not-found") {
            info.notfound = true;
        } else if (ex.problem == "access-denied") {
            info.denied = true;
        } else {
            info.other = ex.toString();
            console.warn(ex);
        }

        $('#curtain').html(Mustache.render(curtain_tmpl, info));
        $('body > div').hide();
        $('#curtain').show();
        $("body").show();
    }

    function hide_curtain() {
        $('#curtain').hide();
    }

    /* INITIALIZATION AND NAVIGATION
     */

    function init() {
        var docker_client;
        var overview_page;
        var container_details_page;
        var image_details_page;
        var storage_page;

        function navigate() {
            var path = cockpit.location.path;

            $("body").show();
            hide_curtain();
            if (path.length === 0) {
                container_details_page.hide();
                image_details_page.hide();
                storage_page.hide();
                overview_page.show();
            } else if (path.length === 1 && path[0] == "storage") {
                overview_page.hide();
                container_details_page.hide();
                image_details_page.hide();
                storage_page.show();
            } else if (path.length === 1) {
                overview_page.hide();
                image_details_page.hide();
                storage_page.hide();
                container_details_page.show(path[0]);
            } else if (path.length === 2 && path[0] == "image") {
                overview_page.hide();
                container_details_page.hide();
                storage_page.hide();
                image_details_page.show(path[1]);
            } else { /* redirect */
                console.warn("not a containers location: " + path);
                cockpit.location = '';
            }
        }

        cockpit.translate();

        docker_client = client.instance();
        init_curtain(docker_client, navigate);
        overview_page = overview.init(docker_client);
        container_details_page = container_details.init(docker_client);
        image_details_page = image_details.init(docker_client);
        storage_page = storage.init(docker_client, docker_service);

        show_curtain(null);
        docker_client.connect().done(navigate);
        $(cockpit).on("locationchanged", navigate);
    }

    $(init);
}());
