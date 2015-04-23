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
    "base1/mustache"
], function($, cockpit, kubernetes, Mustache) {
    "use strict";

    var _ = cockpit.gettext;

    var appdeployer = {};
    var client = kubernetes.k8client();
    var POD = "Pod";
    var SERVICE = "Service";
    var RC = "ReplicationController";
    var NS = "Namespace";
    var valid_manifest = false;
    var valid_ns = false;
    var namespacetxt = "";


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

            var deploy_btn = $('#deploy-app-start');
            deploy_btn.prop("disabled", true);

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
                        text = _("Unable to read the Kubernetes application manifest file. ");
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
                text = _("Unable to read the Kubernetes application manifest file. ");
                file_note.show().text(text);
                return;
            }

            create_everything(namespace, services, rcs, pods)
                .progress(function(code, response, n, total) {
                    //TODO Progress bar

                })
                .done(function() {
                    /* code gets run when everything is created */
                    disable_deploy_button();
                    hide_progress_message();
                     $('#deploy-app-dialog').modal('hide');

                })
                .fail(function(ex, response) {
                    /* ex containst the failure */
                    enable_deploy_button();
                    var jdata = JSON.parse(response);
                    var err_msg = jdata.message;
                    if(jdata.code === 409){
                        err_msg = "Please create another namespace for "+ jdata.details.kind + "\""+ jdata.details.id +"\"";
                    }
                    console.warn(err_msg);
                    hide_progress_message();
                    $("#deploy-app-general-error-msg").text(err_msg).parent().show();
                    
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
                    var jdata = JSON.parse(response);
                    //skip for namespace
                    if (ex.status == 409 && jdata.details.kind === "namespaces") {
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
        jsondata = appdeployer.jsondata;
        var ns = get_ns_field_val();

        if (jsondata === '') {
            $('#deploy-app-manifest-file-empty').addClass('has-error').show();
            valid_manifest = false;
            display_deploy_button();
            return;
        }
        if (ns.trim() === '' || ns.trim() === 'Custom Namespace' || !/^[a-z0-9]+$/i.test(ns.trim())) {
            $('#deploy-app-namespace-field-note').addClass('has-error').show();
            valid_ns = false;
            display_deploy_button();
            return;
        }
        
        appdeployer.manager.deploy(ns, jsondata);
        
    }

    function display_deploy_button() {
        var btn1 = $('#deploy-app-start');
        if(valid_ns && valid_manifest) {
            enable_deploy_button();
        } else {
            disable_deploy_button();
        }
    }

    function deploy_dialog_remove_file_errors() {
        $('.deploy-dialog-file-aids').hide();
        $('#deploy-app-manifest-file-button').parent().removeClass('has-error');
    }

    function deploy_dialog_remove_ns_errors() {
        $('.deploy-dialog-namespace-aids').hide();
        $('#deploy-app-namespace-field').parent().removeClass('has-error');
    }

    function remove_notifications() {
        $('#deploy-app-general-error').hide();
    }

    function enable_deploy_button(){
        var btn1 = $('#deploy-app-start');
        btn1.prop("disabled", false);
        btn1.addClass('btn-primary');
        btn1.removeClass('btn-default');
    }

    function disable_deploy_button(){
        var btn1 = $('#deploy-app-start');
        btn1.prop("disabled", true);
        btn1.removeClass('btn-primary');
        btn1.addClass('btn-default');
    }

    function get_ns_field_val() {
        var ns_selector = $('#deploy-app-namespace-field');
        var ns_selector_text = $('#namespace_value input[type=text]');

        if(ns_selector.val() === '') {
            return ns_selector_text.val();
        } else {
            return ns_selector_text.val();
        }
    }

    function pre_init() {

        var firstTime = true;
        var dlg = $('#deploy-app-dialog');
        var deploy_btn = $('#deploy-app-start');
        var manifest_file = $('#deploy-app-manifest-file');
        var manifest_file_btn = $('#deploy-app-manifest-file-button');
        var manifest_file_note = $('#deploy-app-manifest-file-note');
        var manifest_file_details = $("#deploy-app-manifest-file-note-details");
        var ns_selector = $('#deploy-app-namespace-field');
        appdeployer.jsondata = "";
        appdeployer.namespacetxt = "";
        var text = "";

        deploy_btn.on('click', function() {
            deploy_dialog_remove_file_errors();
            deploy_dialog_remove_ns_errors();
            remove_notifications();
            deploy_app();
        });

        manifest_file_btn.on('click', function(){
            $('#namespace_value input[type=text]').val(appdeployer.namespacetxt);
            deploy_dialog_remove_file_errors();
            manifest_file.val('');
            manifest_file.trigger('click');

        });

        $('#namespace_value').on('input', function() { 
            deploy_dialog_remove_ns_errors();
            appdeployer.namespacetxt = $('#namespace_value input[type=text]').val();
            window.setTimeout(check_ns, 2000);

            function check_ns() {
                if (appdeployer.namespacetxt.trim() === '' || appdeployer.namespacetxt.trim() === 'Custom Namespace' ||
                    !/^[a-z0-9]+$/i.test(appdeployer.namespacetxt.trim())) {
                    $('#deploy-app-namespace-field-note').addClass('has-error').show();
                    valid_ns = false;
                    display_deploy_button();
                    return;
                } else {
                    valid_ns = true;
                    display_deploy_button();
                }
            }
        });

        dlg.on('show.bs.modal', function() {
            appdeployer.namespacetxt = "";
            valid_ns = false;
            valid_manifest = false;
            $('#namespace_value input[type=text]').val('');
            disable_deploy_button();
            deploy_dialog_remove_file_errors();
            deploy_dialog_remove_ns_errors();
            remove_notifications();
            //avoid recreating the options
            if (firstTime) {
                var template = $('#deploy-app-ns-template').html();
                Mustache.parse(template);
                var text = Mustache.render(template, $.extend({
                    "namespaces": client.namespaces
                }));
                ns_selector.html(text);
                ns_selector.combobox();
                firstTime = false;
            }
            manifest_file_btn.text(_("Select Manifest File...")).addClass('manifest_file_default');
            ns_selector.combobox();
            appdeployer.jsondata = "";
        });


        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
                deploy_btn.trigger('click');
        });

        //focus out also calls change
        ns_selector.on('change', function() {
            remove_notifications();
            deploy_dialog_remove_ns_errors();
            $('#namespace_value input[type=text]').val(appdeployer.namespacetxt);
            if(ns_selector.val() === '') {
                if (appdeployer.namespacetxt.trim() === '' || appdeployer.namespacetxt.trim() === 'Custom Namespace' || 
                        !/^[a-z0-9]+$/i.test(appdeployer.namespacetxt.trim())) {
                    $('#deploy-app-namespace-field-note').addClass('has-error').show();
                    valid_ns = false;
                    display_deploy_button();
                    return;
                } else {
                    valid_ns = true;
                    display_deploy_button();
                }
            } else {
                var nsv = ns_selector.val();
                if (nsv.trim() === '' || nsv.trim() === 'Custom Namespace' || !/^[a-z0-9]+$/i.test(nsv.trim())) {
                    $('#deploy-app-namespace-field-note').addClass('has-error').show();
                    valid_ns = false;
                    display_deploy_button();
                    return;
                } else {
                    valid_ns = true;
                    display_deploy_button();
                }
                appdeployer.namespacetxt = ns_selector.val();
                $('#namespace_value input[type=text]').val(appdeployer.namespacetxt);
            }
        });

        manifest_file.on('change', function() {
            deploy_dialog_remove_file_errors();
            remove_notifications();
            $('#namespace_value input[type=text]').val(appdeployer.namespacetxt);


            var files, file, reader;
            files = manifest_file[0].files;
            if (files.length != 1) {
                text = _("No metadata file was selected. Please select a Kubernetes metadata file. ");
                disable_deploy_button();
                manifest_file_details.show().text(text);
                manifest_file_note.addClass('has-error').show();
                valid_manifest = false;
                display_deploy_button();

                manifest_file_btn.text(_("Select Manifest File..."));
                return;
            }
            file = files[0];
            if (!file.type.match("json.*")) {
                text = _("The selected file is not a valid Kubernetes application manifest. ");
                disable_deploy_button();
                manifest_file_details.show().text(text);
                manifest_file_note.addClass('has-error').show();

                valid_manifest = false;
                display_deploy_button();
                manifest_file_btn.text(file.name).removeClass('manifest_file_default').addClass('manifest_file');
                return;
            }
            reader = new window.FileReader();
            reader.onerror = function(event) {
                text = _("Unable to read the Kubernetes application manifest file.Code " + event.target.error.code + "");
                disable_deploy_button();
                manifest_file_details.show().text(text);
                manifest_file_note.addClass('has-error').show();

                valid_manifest = false;
                display_deploy_button();
                manifest_file_btn.text(file.name).removeClass('manifest_file_default').addClass('manifest_file');
                return;
            };
            reader.onload = function() {
                valid_manifest = true;
                display_deploy_button();
                manifest_file_btn.text(file.name).removeClass('manifest_file_default').addClass('manifest_file');
                appdeployer.jsondata = reader.result;
            };
            reader.readAsText(file);

        });

    }

    pre_init();

    appdeployer.init = function() {
        var note = $('#deploy-app-namespace-note');
        var manifest_file_btn = $('#deploy-app-manifest-file-button');

        manifest_file_btn.addClass('manifest_file_default');
        $('#deploy-app').on('click', function() {
            $('#deploy-app-dialog').modal('show');
        });

        appdeployer.manager = deploy_manager();
    };

    return appdeployer;
});

