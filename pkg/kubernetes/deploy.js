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
    "kubernetes/client",
    "base1/mustache",
    "base1/patterns"
], function(jQuery, cockpit, kubernetes, Mustache, patterns) {
    "use strict";

    var _ = cockpit.gettext;

    /* A jQuery scoped to just the deploy dlg, with the button thrown in */
    var $ = jQuery.scoped("body", patterns);

    /* The kubernetes client: valid while dialog is open */
    var client;

    function deploy_app() {
        var promise = validate()
            .fail(function(exs) {
                $("#deploy-app-dialog").dialog("failure", exs);
            })
            .done(function(fields) {
                promise = client.create(fields.manifest, fields.namespace)
                    .done(function() {
                        /* code gets run when everything is created */
                        $('#deploy-app-dialog').modal('hide');
                    })
                    .fail(function(ex, response) {
                        var target;
                        var msg;

                        /* Interpret this code as a conflict, so suggest user creates a new namespace */
                        if (response) {
                            if (response.code === 409) {
                                msg = cockpit.format(_("Please create another namespace for $0 \"$1\""),
                                                     response.details.kind, response.details.id);
                                target = "#deploy-app-namespace-field";
                            } else if (response.message) {
                                msg = response.message;
                            }
                        }

                        ex = new Error(msg || ex.message);
                        ex.target = target;

                        /* Display the error appropriately in the dialog */
                        $("#deploy-app-dialog").dialog("failure", ex);
                    });

                    /* Display a spinner while this is happening */
                    $("#deploy-app-dialog").dialog("wait", promise);
            });

        /* Display a spinner while this is happening */
        $("#deploy-app-dialog").dialog("wait", promise);
    }

    /*
     * Validates the dialog asynchronously and returns a Promise either
     * failing with errors, or returning the clean data.
     */
    function validate() {
        var dfd = $.Deferred();
        var ex, fails = [];
        var fields = { };

        var ns = $("#deploy-app-namespace").val();
        if (!ns)
            ex = new Error(_("Namespace cannot be empty."));
        else if (!/^[a-z0-9]+$/i.test(ns))
            ex = new Error(_("Please provide a valid namespace."));
        if (ex) {
            ex.target = "#deploy-app-namespace-group";
            fails.push(ex);
            ex = null;
        } else {
            fields.namespace = ns;
        }

        var files = $('#deploy-app-manifest-file')[0].files;

        if (files.length != 1)
            ex = new Error(_("No metadata file was selected. Please select a Kubernetes metadata file."));
        else if (files[0].type && !files[0].type.match("json.*"))
            ex = new Error(_("The selected file is not a valid Kubernetes application manifest."));
        if (ex) {
            ex.target = "#deploy-app-manifest-file-button";
            fails.push(ex);
        }

        var reader;

        if (fails.length) {
            dfd.reject(fails);

        } else {
            reader = new window.FileReader();
            reader.onerror = function(event) {
                ex = new Error(cockpit.format(_("Unable to read the Kubernetes application manifest. Code $0."),
                               event.target.error.code));
                ex.target = "#deploy-app-manifest-file-button";
                dfd.reject(ex);
            };
            reader.onload = function() {
                fields.manifest = reader.result;
                dfd.resolve(fields);
            };
            reader.readAsText(files[0]);
        }

        return dfd.promise();
    }

    function pre_init() {
        var dlg = $('#deploy-app-dialog');
        var deploy_btn = $('#deploy-app-start');
        var manifest_file = $('#deploy-app-manifest-file');
        var manifest_file_btn = $('#deploy-app-manifest-file-button');

        deploy_btn.on('click', function() {
            deploy_app();
        });

        manifest_file_btn.on('click', function() {
            manifest_file.val('');
            manifest_file.trigger('click');
            manifest_file_btn.triggerHandler('change');
        });

        dlg.on('show.bs.modal', function() {
            manifest_file_btn.text(_("Select Manifest File...")).addClass('manifest_file_default');

            $("#deploy-app-namespace").val('');
            client = kubernetes.k8client();
            $(client).on("namespaces", namespaces_changed);
            namespaces_changed();
        });

        dlg.on('hide.bs.modal', function() {
            if (client) {
                client.close();
                $(client).off("namespaces", namespaces_changed);
                client = null;
            }
        });

        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
                deploy_btn.trigger('click');
        });

        manifest_file.on('change', function() {
            var files = manifest_file[0].files || [];
            var file = files[0];
            var name = file ? file.name : _("Select Manifest File...");
            manifest_file_btn
                .text(name)
                .toggleClass('manifest_file_default', !file)
                .toggleClass('manifest_file', !!file)
                .triggerHandler('change');
        });

        var group = $("#deploy-app-namespace-group");
        $("button", group).on("click", function() {
            $("ul", group).outerWidth(group.width());
        });

        group.on("click", "a", function() {
            $("input", group).val($(this).text());
            $("ul", group).parent().removeClass("open");
            return false;
        });

        function namespaces_changed() {
            var ul = $("ul", group).empty();
            client.namespaces.forEach(function(namespace) {
                ul.append($("<li>").append($("<a>").text(namespace.metadata.name)));
            });
        }
    }

    pre_init();
});
