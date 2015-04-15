/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
    "base1/mustache"
], function($, cockpit,kubernetes,Mustache) {
    "use strict";

    var appdeployer = {};
    var client = kubernetes.k8client();

    function debug() {
        if (window.debugging == "all" || window.debugging == "deploy")
            console.debug.apply(console, arguments);
    }

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

    function get_kentities(entity_key) {
        var elist = [];
        if (client[entity_key]) {
            var el = client[entity_key];
            for (var i = 0; i < el.length; i++) {
                elist.push(el[i].metadata.name);
            }
        }
        return elist;
    }

    function deploy_manager() {


        var is_deploying = $('#deploy-app-deploying');
        var deploy_notification_success = $('#deploy-app-notification-success-template').html();
        var deploy_notification_failure = $('#deploy-app-notification-failure-template').html();
        Mustache.parse(deploy_notification_success);
        Mustache.parse(deploy_notification_failure);

        function deploy_app(namespace, jsonData) {
            if (action_in_progress()) {
                console.log('Unable to Deploy app at this time because a call to deploy manager ' +
                    'is already in progress. Please try again.');
                return;
            }

            remove_notifications();

            var services = [];
            var rcs = [];
            var pods = [];
            var namespaces = [];
            var has_errors = false;
            var available_ns = get_kentities("namespaces");
            var available_rc = get_kentities("replicationcontrollers");
            var available_services = get_kentities("services");
            var available_pods = get_kentities("pods");
            var file_note = $('#deploy-app-manifest-file-note');
            var file_note_details = $('#deploy-app-manifest-file-note-details');
            var deploying_app_details = $('#deploy-app-deploying-details');
            show_progress_message("Deploying App");

            var btn = $('#deploy-app-start');
            btn.prop("disabled", true);

            if (isJsonString(jsonData)) {
                var jdata = JSON.parse(jsonData);
                if (jdata.items) {
                    for (var i = 0; i < jdata.items.length; i++) {
                        var ent_json = jdata.items[i];
                        //console.log(ent_json)
                        if (ent_json.kind === client.SERVICE) {
                            services.push(ent_json);
                        } else if (ent_json.kind === client.POD) {
                            pods.push(ent_json);
                        } else if (ent_json.kind === client.RC) {
                            rcs.push(ent_json);
                        } else if (ent_json.kind === client.NS) {
                            namespaces.push(ent_json);
                        }
                    }
                }
            } else {
                var text = "Unable to Read the file.Please check the json file. ";
                file_note.show();
                file_note_details.text(text);
                return;
            }

            create_everything(namespace, services, rcs, pods)
                .progress(function(code, response, n, total) {
                    //console.log(" " + code + "  " + response + "  " + n + " / " + total);
                })
                .done(function() {
                    /* code gets run when everything is created */
                    var btn = $('#deploy-app-stop');
                    btn.removeClass('btn-default');
                    btn.addClass('btn-primary');
                    btn.text("OK");
                    hide_progress_message();
                    is_deploying.parent().prepend($(Mustache.render(deploy_notification_success)));

                })
                .fail(function(ex, response) {
                    /* ex containst the failure */
                    var jdata = JSON.parse(response);
                    hide_progress_message();
                    var context = {};
                    is_deploying.parent().prepend($(Mustache.render(deploy_notification_failure, $.extend(context, jdata))));

                });
        }

        function create_everything(namespace, services, rcs, pods) {
            var ns_json = '{"apiVersion":"v1beta3","kind":"Namespace","metadata":{"name": "' + namespace + '"}}';
            var tasks = [];

            tasks.push(["namespace", [ns_json], client.create_ns]);

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

            function step(qtasks) {
                var e = qtasks.shift();
                if (!e) {
                    deferred.resolve();
                    return;
                }
                var task_name = e[0];
                var args = e[1];
                var task = e[2];

                task.apply(null, args).done(function(response) {
                    deferred.notify("created", response, qtasks.length - total, total);
                    step(qtasks);
                }).fail(function(ex, response) {
                    if (ex.status == 409) {
                        deferred.notify("skipped", response, qtasks.length - total, total);
                        step(qtasks);
                    } else {
                        deferred.reject(ex, response);
                    }
                });
            }

            step(tasks);

            return deferred.promise();
        }

        function show_progress_message(message) {
            is_deploying.show();
            $('#deploy-update-message').text(message);
        }

        function hide_progress_message() {
            is_deploying.hide();
        }

        function remove_notifications() {
            $('div.container-fluid.alert').remove();
            deploy_dialog_remove_errors();
        }


        function action_in_progress() {
            return (is_deploying.is(':visible'));
        }

        return {
            'deploy_app': deploy_app
        };

    }

    function deploy_app() {
        //alert("deploy_app")
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
            appdeployer.manager.deploy_app(ns, jsondata);
    }

    function deploy_dialog_remove_errors() {
        $('#deploy-app-manifest-file-note').hide();
        $('#deploy-app-manifest-file-note-details').hide();
        $('#deploy-app-namespace-field-note').hide();
        $('#deploy-app-namespace-field-note-details').hide();
        $('#deploy-app-general-error').hide();
        $('#deploy-app-manifest-file-empty').hide();
        $('#deploy-app-namespace-field-custom-empty').hide();
        $('#deploy-app-namespace-field-custom').parent().removeClass('has-error');
        $('#deploy-app-manifest-file').parent().removeClass('has-error');

    }

    function pre_init() {
        //alert("pre_init")
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
            //alert("show.bs.models");
            if (firstTime) {
                var optionls = [];
                var nslist = get_kentities("namespaces");
                for (var i = 0; i < nslist.length; i++) {
                    optionls.push('<option translatable="yes" value="' + nslist[i] + '">' + nslist[i] + '</option>');
                }
                optionls.push('<option translatable="yes" value="Custom Namespace">Custom Namespace</option>');
                var optionlshtml = optionls.join('');
                ns_selector.prepend(optionlshtml);
                ns_selector.selectpicker('refresh');
                firstTime = false;
            }
            manifest_file.val("");
            deploy_dialog_remove_errors();
        });


        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
                btn.trigger('click');
        });

        manifest_file.on('change', function() {
            //alert("manifest_file")

            manifest_file_note.hide();
            manifest_file_details.hide();
            manifest_file.parent().removeClass('has-error');

            var files, file, reader;
            files = manifest_file[0].files;
            if (files.length != 1) {
                text = "No json File was selected.Please select a json file. ";
                manifest_file_note.show();
                manifest_file_details.text(text);
                manifest_file_details.show();
                manifest_file.parent().addClass('has-error');
                return;
            }
            file = files[0];
            if (!file.type.match("json.*")) {
                text = "Selected file is Not a Json file.Please select a json file. ";
                manifest_file_note.show();
                manifest_file_details.text(text);
                manifest_file_details.show();
                manifest_file.parent().addClass('has-error');
                return;
            }
            reader = new window.FileReader();
            reader.onerror = function() {
                text = "Unable to Read the file.Please check the json file. ";
                manifest_file_note.show();
                manifest_file_details.text(text);
                manifest_file_details.show();
                manifest_file.parent().addClass('has-error');
                return;
            };
            reader.onload = function() {
                appdeployer.jsondata = reader.result;
            };
            reader.readAsText(file);
            deploy_dialog_remove_errors();
        });

    }


    pre_init();

    appdeployer.init = function() {
        //alert("init")
        var custom_ns = $('#deploy-app-namespace-field-custom');
        var ns_selector = $('#deploy-app-namespace-field');
        var note = $('#deploy-app-namespace-note');

        custom_ns.hide();
        ns_selector.on('change', function() {
            //alert("ns_selecto")
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

