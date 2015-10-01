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
    "kubernetes/nulecule",
    "base1/mustache",
], function($, cockpit, kubernetes, nulecule, Mustache) {
    "use strict";

    var _ = cockpit.gettext;

    /* The kubernetes client: valid while dialog is open */
    var client;
    /* The Nulecule client: valid while dialog is open */
    var nulecule_client;

    /* A list of namespaces */
    var namespaces;

    var run_stage = false;

    function finish_success() {
        var current_namespace = client.namespace();
        var added_namespace = $("#deploy-app-namespace").val();
        if (current_namespace && current_namespace != added_namespace)
            client.namespace(added_namespace);

        $('#deploy-app-dialog').modal('hide');
    }

    function deploy_app() {
        var promise = validate()
            .fail(function(exs) {
                $("#deploy-app-dialog").dialog("failure", exs);
            })
            .done(function(fields) {
                $("#deploy-app-dialog").dialog("failure", null);
                promise = client.create(fields.manifest, fields.namespace)
                    .done(function() {
                        /* code gets run when everything is created */
                        finish_success();
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
     * Runs the installed Nulecule app Image
     */
    function run_nulecule() {
        var deferred = $.Deferred();
        $("#deploy-app-dialog").dialog("failure", null);
        $("#deploy-app-dialog").dialog("wait", deferred.promise());

        validate_app_fields()
            .fail(function(ex) {
                deferred.reject(ex);
                $("#deploy-app-dialog").dialog("failure", ex);
            })
            .done(function(fields) {
                nulecule_client.run(fields.nulecule_image)
                    .progress(function(msg) {
                        deferred.notify(msg);
                    })
                    .done(function() {
                        deferred.resolve();
                        finish_success();
                    })
                    .fail(function(ex) {
                        deferred.reject(ex);
                        $("#deploy-app-dialog").dialog("failure", ex);
                    });
            });
    }

    /*
     * Installs Nulecule app Image
     */
    function install_nulecule() {
        var deferred = $.Deferred();
        $("#deploy-app-dialog").dialog("failure", null);
        $("#deploy-app-dialog").dialog("wait", deferred.promise());

        validate()
            .fail(function(exs) {
                deferred.reject(exs);
                $("#deploy-app-dialog").dialog("failure", exs);
            })
            .done(function(fields) {
                nulecule_client.install(fields.nulecule_image)
                    .progress(function(msg) {
                        deferred.notify(msg);
                    })
                    .done(function(ans){
                        //Show App Params in the dialog
                        var template = $('#deploy-app-appentity-template').html();
                        Mustache.parse(template);
                        var text = Mustache.render(template, $.extend({
                            "apps": convert_to_KV(ans)
                            }));
                        $('#deploy-app-dialog').find('.cockpit-form-table').append(text);
                        deferred.resolve();
                        $('#deploy-app-dialog').find("#deploy-app-type").prop('disabled',true);
                        $('#deploy-app-dialog').find("#deploy-app-type").selectpicker('refresh');
                        $('#deploy-app-dialog').find("#deploy-app-nulecule-image").prop("disabled", true);

                        run_stage = true;
                    })
                    .fail(function(ex, response) {
                        deferred.reject(ex);
                        /* Display the error appropriately in the dialog */
                        $("#deploy-app-dialog").dialog("failure", ex);
                    });
            });
    }

    function get_fields(applist) {
        var labels = [];
        for(var x in applist) {
            var app = applist[x];
            var prefix = app.app_name;
            var lsuffix = "label";
            var isuffix = "text";

            for(var y in app.app_params) {
                var param = app.app_params[y];
                var label = prefix + "-" + param.param_key + "-" + lsuffix;
                var input = prefix + "-" + param.param_key + "-" + isuffix;
                var tmp = { "label_val" : label, "input_val" : input };
                labels.push(tmp);
            }
        }
        return labels;
    }


    /*
     * Get app_name and KEY from label
     */
    function get_app_from_label(label) {
        var app_name = "";
        var key = label.split("-label")[0].split("-");
        key = key[key.length-1];
        app_name = label.split("-label")[0].split("-" + key)[0];
        return { "app_name" : app_name, "key" : key };
    }

    /*
     * Convert default ini file to Key-Value format
     * to be used in creating the form
     */
    function convert_to_KV(ans) {
        var applist = [];

        for(var key in ans) {
            var app = { "app_name" : "", "app_params" : []};
            // Ignore general
            if (key === "general")
                continue;

            app.app_name = key;
            for(var x in ans[key]) {
                var tmpKV = { "param_key" : "", "param_value": ""};
                tmpKV.param_key = x;

                if(ans[key][x])
                    tmpKV.param_value = ans[key][x];
                else
                    tmpKV.param_value = "";

                app.app_params.push(tmpKV);
            }
            applist.push(app);

        }
        return applist;
    }

    function validate_app_fields() {
        var dfd = $.Deferred();
        var ex, fails = [];
        var answer_data = nulecule_client.answers;
        var label_input = get_fields(convert_to_KV(answer_data));
        var fields = { };


        for(var x in label_input) {
            var li = label_input[x];
            var input_id = "#" + li.input_val;
            var label_id = li.label_val;
            var app_data = get_app_from_label(label_id);
            var input_value = $(input_id).val();

            answer_data[app_data.app_name][app_data.key] = input_value;

            var label_value = $('#deploy-app-dialog').find('label[for="' + label_id + '"]').text().trim();
            if (!input_value)
                ex = new Error(label_value + " cannot be empty.");

            if (ex) {
                ex.target = input_id;
                fails.push(ex);
                ex = null;
            }
        }

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
            answer_data.general.namespace = ns;
        }

        var nulecule_image = $("#deploy-app-nulecule-image");
        fields.nulecule_image = nulecule_image.val().trim();

        if (fails.length) {
            dfd.reject(fails);
        } else {
            dfd.resolve(fields);
        }


        nulecule_client.answers = answer_data;
        return dfd.promise();
    }

    /*
     * Validates the dialog asynchronously and returns a Promise either
     * failing with errors, or returning the clean data.
     */
    function validate() {
        var dfd = $.Deferred();
        var ex, fails = [];
        var fields = { };
        var type_selector = $('#deploy-app-type');

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

        if (type_selector.val().trim() === "manifest") {
            var files = $('#deploy-app-manifest-file')[0].files;

            if (files.length != 1)
                ex = new Error(_("No metadata file was selected. Please select a Kubernetes metadata file."));
            else if (files[0].type && !files[0].type.match("json.*"))
                ex = new Error(_("The selected file is not a valid Kubernetes application manifest."));
            if (ex) {
                ex.target = "#deploy-app-manifest-file-button";
                fails.push(ex);
                ex = null;
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
                    fails.push(ex);
                    ex = null;
                    dfd.reject(fails);
                };
                reader.onload = function() {
                    fields.manifest = reader.result;
                    dfd.resolve(fields);
                };
                reader.readAsText(files[0]);
            }

        } else {
                var nulecule_image = $("#deploy-app-nulecule-image").val();
                if (!nulecule_image)
                    ex = new Error(_("Nulecule field cannot be empty."));
                if (ex) {
                    ex.target = "#deploy-app-nulecule-image";
                    fails.push(ex);
                    ex = null;
                } else {
                    fields.nulecule_image = nulecule_image.trim();
                }

                if (fails.length) {
                    dfd.reject(fails);
                } else {
                    dfd.resolve(fields);
                }
        }

        return dfd.promise();
    }

    function pre_init() {
        var dlg = $('#deploy-app-dialog');
        var deploy_btn = $('#deploy-app-start');
        var manifest_file = $('#deploy-app-manifest-file');
        var manifest_file_btn = $('#deploy-app-manifest-file-button');
        var manifest_type = $("#deploy-app-type-label");
        var nulecule_image = $("#deploy-app-nulecule-image");
        var type_selector = $('#deploy-app-type');


        deploy_btn.on('click', function() {
            if (type_selector.val().trim() === "manifest") {
                deploy_app();
            } else {
                if(run_stage)
                    run_nulecule();
                else
                    install_nulecule();
            }
        });

        manifest_file_btn.on('click', function() {
            manifest_file.val('');
            manifest_file.trigger('click');
            manifest_file_btn.triggerHandler('change');
        });

        type_selector.on('change', function() {
            if (type_selector.val().trim() === "manifest") {
                nulecule_image.hide();
                $('label[for="deploy-app-nulecule"]').hide();
                manifest_file_btn.show();
                $('label[for="deploy-app-manifest"]').show();

            } else {
                nulecule_image.show();
                $('label[for="deploy-app-nulecule"]').show();
                manifest_file_btn.hide();
                $('label[for="deploy-app-manifest"]').hide();
                nulecule_image.prop("disabled", false);
            }
        });
        type_selector.selectpicker('refresh');

        dlg.on('show.bs.modal', function() {
            var label = _("Namespace");
            if ($("#content").data('flavor') == 'openshift')
                label = _("Project");
            $("#deploy-app-namespace-label").text(label);

            manifest_file_btn.text(_("Select Manifest File...")).addClass('manifest_file_default');

            $(".appentity").remove();
            nulecule_image.prop("disabled", false);
            nulecule_image.val('');
            type_selector.prop('disabled',false);
            type_selector.val("manifest");
            type_selector.selectpicker('refresh');

            nulecule_image.hide();
            $('label[for="deploy-app-nulecule"]').hide();
            manifest_file_btn.show();
            $('label[for="deploy-app-manifest"]').show();
            client = kubernetes.k8client();
            nulecule_client = nulecule.nuleculeclient();

            var selected = client.namespace();
            $("#deploy-app-namespace").val(selected);

            namespaces = client.select("Namespace");
            client.track(namespaces);
            $(namespaces).on("changed", namespaces_changed);
            namespaces_changed();
        });

        dlg.on('hide.bs.modal', function() {
            run_stage = false;
            if (namespaces) {
                $(namespaces).off("changed", namespaces_changed);
                client.track(namespaces, false);
                namespaces = null;
            }
            if (client) {
                client.close();
                client = null;
            }
            if (nulecule_client) {
                nulecule_client.close();
                nulecule_client = null;
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
            namespaces.items.forEach(function(namespace) {
                ul.append($("<li>").append($("<a>").text(namespace.metadata.name)));
            });
        }
    }

    pre_init();
});
