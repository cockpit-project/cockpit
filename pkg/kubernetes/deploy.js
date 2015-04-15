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
    "translated!base1/po",
    "kubernetes/client",
    "base1/mustache"
], function($, cockpit,po,kubernetes,Mustache) {
    "use strict";

    cockpit.locale(po);
    cockpit.translate();
    var _ = cockpit.gettext;

    var appdeployer = {};
    var client = kubernetes.k8client();
    var POD = "Pod";
    var SERVICE = "Service";
    var RC = "ReplicationController";
    var NS = "Namespace";


    function failure(ex) {
        console.warn(ex);
    }

    function isJsonString(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }

    function deploy_manager() {

        var is_deploying = $('#deploy-app-deploying');
        var deploy_notification_success = $('#deploy-app-notification-success-template').html();
        var deploy_notification_failure = $('#deploy-app-notification-failure-template').html();
        Mustache.parse(deploy_notification_success);
        Mustache.parse(deploy_notification_failure);

        function deploy(namespace, jsonData) {

            remove_notifications();

            var services = [];
            var rcs = [];
            var pods = [];
            var namespaces = [];
            var has_errors = false;
            var text = "";
            var file_note = $('#deploy-app-manifest-file-note');
            var file_note_details = $('#deploy-app-manifest-file-note-details');
            var deploying_app_details = $('#deploy-app-deploying-details');
            show_progress_message();

            var btn = $('#deploy-app-start');
            btn.prop("disabled", true);

            if (isJsonString(jsonData)) {
                var jdata = JSON.parse(jsonData);
                if(jdata.kind === "List") {
                    if (jdata.items) {
                        for (var i = 0; i < jdata.items.length; i++) {
                            var ent_json = jdata.items[i];
                            if (ent_json.kind === SERVICE) {
                                services.push(ent_json);
                            } else if (ent_json.kind === POD) {
                                pods.push(ent_json);
                            } else if (ent_json.kind === RC) {
                                rcs.push(ent_json);
                            } else if (ent_json.kind === NS) {
                                namespaces.push(ent_json);
                            }
                        }
                    } else {
                        text = _("Unable to Read the file.Please check the json file. ");
                        file_note.show().text(text);
                        return;
                    }
                } else {
                    if (jdata.kind === SERVICE) {
                        services.push(jdata);
                    } else if (jdata.kind === POD) {
                        pods.push(jdata);
                    } else if (jdata.kind === RC) {
                        rcs.push(jdata);
                    } else if (jdata.kind === NS) {
                        namespaces.push(jdata);
                    } else {
                        text = _("Unsupported Entity. ");
                        file_note.show().text(text);
                        return;
                    }
                }
            } else {
                text = _("Unable to Read the file.Please check the json file. ");
                file_note.show().text(text);
                return;
            }

            create_everything(namespace, services, rcs, pods)
                .progress(function(code, response, n, total) {
                    //TODO Progress bar

                })
                .done(function() {
                    /* code gets run when everything is created */
                    set_deploy_success_buttons();
                    hide_progress_message();
                    is_deploying.parent().prepend($(Mustache.render(deploy_notification_success)));

                })
                .fail(function(ex, response) {
                    /* ex containst the failure */
                    reset_deploy_success_buttons();
                    var jdata = JSON.parse(response);
                    hide_progress_message();
                    var context = {};
                    is_deploying.parent().prepend($(Mustache.render(deploy_notification_failure, $.extend(context, jdata))));

                });
        }

        function create_everything(namespace, services, rcs, pods) {
            var ns_json = {"apiVersion":"v1beta3","kind":"Namespace","metadata":{"name": "" }};
            ns_json.metadata.name = namespace;
            var tasks = [];

            tasks.push([namespace, [JSON.stringify(ns_json)], client.create_ns]);

            for (var serv in services) {
                tasks.push([services[serv].metadata.name, [namespace, JSON.stringify(services[serv])], client.create_service]);
            }

            for (var rc in rcs) {
                tasks.push([rcs[rc].metadata.name, [namespace, JSON.stringify(rcs[rc])], client.create_replicationcontroller]);
            }

            for (var p in pods) {
                tasks.push([pods[p].metadata.name, [namespace, JSON.stringify(pods[p])], client.create_pod]);
            }

            var deferred = $.Deferred();
            var total = tasks.length;

            function step() {
                var e = tasks.shift();
                if (!e) {
                    deferred.resolve();
                    return;
                }
                var task_name = e[0];
                var args = e[1];
                var task = e[2];

                task.apply(null, args).done(function(response) {
                    deferred.notify("created", response, tasks.length - total, total);
                    step();
                }).fail(function(ex, response) {
                    if (ex.status == 409) {
                        deferred.notify("skipped", response, tasks.length - total, total);
                        step();
                    } else {
                        deferred.reject(ex, response);
                    }
                });
            }

            step();

            return deferred.promise();
        }

        function show_progress_message() {
            is_deploying.show();
        }

        function hide_progress_message() {
            is_deploying.hide();
        }

        return {
            'deploy': deploy
        };

    }

    function deploy_app() {

        var jsondata = "";
        deploy_dialog_remove_errors();
        jsondata = appdeployer.jsondata;
 
        var ns = $('#deploy-app-namespace-field').val();
        if ($('#deploy-app-namespace-field').val() === 'Custom Namespace')
            ns = $('#deploy-app-namespace-field-custom').val().trim();

        var has_errors = false;
        if (jsondata === '') {
            $('#deploy-app-manifest-file-empty').show();
            $('#deploy-app-manifest-file').parent().addClass('has-error');
            has_errors = true;
        }
        if (ns.trim() === '' || ns.trim() === 'Enter Namespace Here') {
            $('#deploy-app-namespace-field-note').show();
            $('#deploy-app-namespace-field-custom').parent().addClass('has-error');
            has_errors = true;
        }
        if (!has_errors)
            appdeployer.manager.deploy(ns, jsondata);
    }

    function deploy_dialog_remove_errors() {
        $('.deploy-dialog-aids').hide();
        $('#deploy-app-namespace-field-custom').parent().removeClass('has-error');
        $('#deploy-app-manifest-file').parent().removeClass('has-error');

    }

    function remove_notifications() {
        $('div.container-fluid.alert').remove();
        deploy_dialog_remove_errors();
    }

    function set_deploy_success_buttons(){
        var btn1 = $('#deploy-app-start');
        btn1.prop("disabled", true);
        var btn2 = $('#deploy-app-stop');
        btn2.removeClass('btn-default');
        btn2.addClass('btn-primary');
        btn2.text("OK");
    }

    function reset_deploy_success_buttons(){
        var btn1 = $('#deploy-app-start');
        btn1.prop("disabled", false);
        var btn2 = $('#deploy-app-stop');
        btn2.addClass('btn-default');
        btn2.removeClass('btn-primary');
        btn2.text("Cancel");
    }

    function pre_init() {

        var firstTime = true;
        var dlg = $('#deploy-app-dialog');
        var btn = $('#deploy-app-start');
        var manifest_file = $('#deploy-app-manifest-file');
        var manifest_file_note = $('#deploy-app-manifest-file-note');
        var manifest_file_details = $("#deploy-app-manifest-file-note-details");
        var ns_selector = $('#deploy-app-namespace-field');
        appdeployer.jsondata = "";
        var text = "";

        btn.on('click', function() {
            deploy_app();
        });

        dlg.on('show.bs.modal', function() {
            //avoid recreating the options
            if (firstTime) {
                var template = $('#deploy-app-ns-template').html();
                Mustache.parse(template);
                var text = Mustache.render(template, $.extend({
                    "namespaces": client.namespaces
                }));
                ns_selector.html(text);
                ns_selector.selectpicker('refresh');
                firstTime = false;
            }
            manifest_file.val("");
            ns_selector.selectpicker('refresh');
            appdeployer.jsondata = "";
            deploy_dialog_remove_errors();
            remove_notifications();
            reset_deploy_success_buttons();
        });


        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
                btn.trigger('click');
        });

        manifest_file.on('change', function() {

            remove_notifications();
            reset_deploy_success_buttons();

            var files, file, reader;
            files = manifest_file[0].files;
            if (files.length != 1) {
                text = _("No metadata file was selected. Please select a Kubernetes metadata file. ");
                manifest_file_note.show();
                manifest_file_details.show().text(text);
                manifest_file.parent().addClass('has-error');
                btn.prop("disabled", true);
                return;
            }
            file = files[0];
            if (!file.type.match("json.*")) {
                text = _("The selected file is not a Kubernetes metadata file. Please select a Kubernetes metadata file. ");
                manifest_file_note.show();
                manifest_file_details.show().text(text);
                manifest_file.parent().addClass('has-error');
                btn.prop("disabled", true);
                return;
            }
            reader = new window.FileReader();
            reader.onerror = function(event) {
                text = _("Unable to read the metadata file.Code " + event.target.error.code + "");
                manifest_file_note.show();
                manifest_file_details.show().text(text);
                manifest_file.parent().addClass('has-error');
                btn.prop("disabled", true);
                return;
            };
            reader.onload = function() {
                appdeployer.jsondata = reader.result;
            };
            reader.readAsText(file);

        });

    }


    pre_init();

    appdeployer.init = function() {

        var custom_ns = $('#deploy-app-namespace-field-custom');
        var ns_selector = $('#deploy-app-namespace-field');
        var note = $('#deploy-app-namespace-note');

        custom_ns.hide();
        ns_selector.on('change', function() {
            remove_notifications();
            reset_deploy_success_buttons();
            if (ns_selector.val() === 'Custom Namespace') {
                custom_ns.show();
                custom_ns.focus();
                custom_ns.select();
                if (custom_ns.parent().hasClass('has-error'))
                    note.show();
            } else {
                custom_ns.hide();
                note.hide();
            }
        });
        ns_selector.selectpicker('refresh');

        $('#deploy-app').on('click', function() {
            $('#deploy-app-dialog').modal('show');
        });

        appdeployer.manager = deploy_manager();
    };

    return appdeployer;
});

