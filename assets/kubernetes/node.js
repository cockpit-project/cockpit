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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "kubernetes/client",
    "base1/patterns"
], function(jQuery, cockpit, Mustache, kubernetes) {
    "use strict";

    var _ = cockpit.gettext;
    var $ = jQuery.scoped("#node-dialog");

    var kube = null;

    var regex = /^[a-z0-9.-]+$/i;
    var dialog = $("#node-dialog", document);

    dialog
        .on("show.bs.modal", function(ev) {
            kube = kubernetes.k8client();

            /* We don't support configuration for now */
            $(".configure-option input")
                .attr("disabled", "disabled");

            $("#node-name").val('');
            $("#node-address").val('');
        })
        .on("shown.bs.modal", function() {
            $("#node-address").focus();
        })
        .on("hide.bs.modal", function(ev) {
            kube.close();
            kube = null;
        });

    function gather() {
        var failures = [];
        var items = [];

        var name = $("#node-name").val().trim();
        var address = $("#node-address").val().trim();

        var ex;
        if (!address)
            ex = new Error(_("Please type an address"));
        else if (!regex.test(address))
            ex = new Error(_("The address contains invalid characters"));
        if (ex) {
            ex.target = "#node-address";
            failures.push(ex);
        }

        if (name && !regex.test(name)) {
            ex = new Error(_("The name contains invalid charaters"));
            ex.target = "#node-name";
            failures.push(ex);
        }

        if (failures.length) {
            dialog.dialog("failure", failures);
            return null;
        }

        if (!name)
            name = address;

        var item = {
            "kind": "Node",
            "apiVersion": "v1",
            "metadata": {
                "name": name
            },
            "spec": {
                "externalID": address
            }
        };

        return [ item ];
    }

    var name_dirty = false;

    $("#node-name").on("input", function() {
        name_dirty = true;
    });
    $("#node-address").on("input", function() {
        if (!name_dirty)
            $("#node-name").val($(this).val());
    });

    dialog.on('keypress', function(e) {
        if (e.keyCode === 13)
            $(".btn-primary").trigger('click');
    });

    $(".btn-primary").on("click", function() {
        var items = gather();
        if (!items)
            return;

        var promise = kube.create(items);
        dialog.dialog("promise", promise);
    });
});

