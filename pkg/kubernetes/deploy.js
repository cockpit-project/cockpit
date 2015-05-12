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

            if (!isJsonString(jsonData)) {
                text = _("Unable to read the Kubernetes application manifest file. ");
                file_note.show().text(text);
                return;
            }

            client.create(jsonData, namespace)
                .progress(function(code, response, n, total) {
                    //TODO Progress bar

                })
                .done(function() {
                    /* code gets run when everything is created */
                    disable_deploy_button();
                    hide_progress_message();
                     $('#deploy-app-dialog').modal('hide');

                })
                .fail(function(ex, jdata) {
                    /* ex containst the failure */
                    enable_deploy_button();
                    if (!jdata)
                        jdata = ex;
                    var err_msg = jdata.message;
                    if(jdata.code === 409){
                        err_msg = cockpit.format(_("Please create another namespace for $0 \"$1\""), jdata.details.kind, jdata.details.id);
                    }
                    console.warn(jdata.message);
                    hide_progress_message();
                    $("#deploy-app-general-error-msg").text(err_msg).parent().show();
                });
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

        if(!check_for_valid_ns(ns)) {
            return;
        }

        appdeployer.manager.deploy(ns, jsondata);
    }

    function check_for_valid_ns (nspace) {
        if (nspace.trim() === '' || !/^[a-z0-9]+$/i.test(nspace.trim())) {
            $('#deploy-app-namespace-field-note').addClass('has-error').show();
            valid_ns = false;
            display_deploy_button();
            return false;
        } else {
            valid_ns = true;
            display_deploy_button();
            return true;
        }
        return false;
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
            return ns_selector.val();
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
            window.setTimeout(check_for_valid_ns(appdeployer.namespacetxt), 2000);

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
            ns_selector.val('');
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
                if(!check_for_valid_ns(appdeployer.namespacetxt)) {
                    return;
                }
            } else {
                var nsv = ns_selector.val();
                if(!check_for_valid_ns(nsv)) {
                    return;
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
                text = cockpit.format(_("Unable to read the Kubernetes application manifest file. Code $0 ."), event.target.error.code);
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

