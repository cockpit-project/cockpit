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

    var kubernetes_helper = { };
    var client = kubernetes.k8client();

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes-helper")
            console.debug.apply(console, arguments);
    }

    function failure(ex) {
        console.warn(ex);
    }

    function IsJsonString(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }

    function get_kentities(entity_key){
        var elist = [];
        if(client[entity_key]){
            var el = client[entity_key];
            for(var i = 0; i < el.length; i++){
                elist.push(el[i].metadata.name);
            }
        }
        return elist;
    }

    function deploy_manager(){


        var is_updating = $('#deploy-updating');


        function deploy_app(namespace , jsonData){
            if (action_in_progress()) {
                console.log(_('Unable to register at this time because a call to subscription manager ' +
                  'is already in progress. Please try again.'));
                return;
            }

            var services = [];
            var rcs = [];
            var pods = [];
            var namespaces = [];

            var deploying_app = $('#deploy-app-deploying');
            deploying_app.show();
            if(IsJsonString(jsonData)){
                if(jsonData.items){
                    for (var i=0 ;i<jsonData.items.length;i++){
                        var ent_json = jsonData.items[i];
                        if (ent_json.kind === "Service"){
                            services.push(ent_json);
                        } else if (ent_json.kind === "Pod"){
                            pods.push(ent_json);
                        } else if (ent_json.kind === "ReplicationController"){
                            rcs.push(ent_json);
                        } else if (ent_json.kind === "Namespace"){
                            namespaces.push(ent_json);
                        } 
                    }
                }
            }

        }

        /*
         * Display information about an action in progress
         * Make sure we only have one subscription-manager instance at a time
         */
        function show_progress_message(message) {
            is_updating.show();
            $('#deploy-update-message').text(message);
        }

        function hide_progress_message() {
            is_updating.hide();
        }

        /* since we only call subscription_manager, we only need to check the update message visibility */
        function action_in_progress() {
            return (is_updating.is(':visible') || $('#deploy-app-deploying').is(':visible'));
        }

        return {
            'deploy_app': deploy_app
        };
    }

    function deploy_app() {
        //alert("deploy_app")
        var ns = null;
        var jsondata = "";
        deploy_dialog_remove_errors();
        jsondata = kubernetes_helper.jsondata;
        
        var ns = $('#deploy-app-namespace-text').val();
        if ($('#deploy-app-namespace-text').val() === 'Custom Namespace')
          ns = $('#deploy-app-namespace-custom').val().trim();
        
        var has_errors = false;
        if (jsondata === '') {
            $('#deploy-app-manifest-empty').show();
            $('#deploy-app-manifest-file').parent().addClass('has-error');
            has_errors = true;
        }
        if (ns.trim() === '' || ns.trim() === 'Enter Namespace Here') {
            $('#deploy-app-namespace-note').show();
            $('#deploy-app-namespace-custom').parent().addClass('has-error');
            has_errors = true;
        }
        if (!has_errors)
          kubernetes_helper.manager.deploy_app(ns, jsondata);
    }

    function deploy_dialog_remove_errors() {
        $('#deploy-app-namespace-note').hide();
        $('#deploy-app-manifest-empty').hide();
        $('#deploy-app-namespace-empty').hide();
        //$('#deploy-app-manifest-file').parent().removeClass('has-error');
    }

    function pre_init() {
        //alert("pre_init")
        var firstTime = true;
        var dlg = $('#deploy-app-dialog');
        var btn = $('#deploy-app-start');
        var file_note = $('#deploy-app-manifest-empty');
        var manifest_file = $("#deploy-app-manifest-file");
        kubernetes_helper.jsondata = "";
        var text = "";

        btn.on('click', function() {
            deploy_app();
        });

        dlg.on('show.bs.modal', function() {
            alert("show.bs.models");
            if(firstTime){
                var optionls = [];
                var nslist = get_kentities("namespaces");
                var ns_selector = $('#deploy-app-namespace-text');
                for(var i =0 ;i < nslist.length; i++){
                    optionls.push('<option translatable="yes" value="'+nslist[i]+'">'+nslist[i]+'</option>')
                }
                optionls.push('<option translatable="yes" value="Custom Namespace">Custom Namespace</option>');
                var optionlshtml=optionls.join('');
                ns_selector.prepend(optionlshtml);
                ns_selector.selectpicker('refresh');
                firstTime = false;
            }
            $('#deploy-app-manifest-file').val("");
            deploy_dialog_remove_errors();
        });


        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
              btn.trigger('click');
        });

        manifest_file.on('change', function () {
            //alert("manifest_file")
            file_note.hide();
            var files, file, reader;
            files = manifest_file[0].files;
            if (files.length != 1) {
                text = "No json File was selected.Please select a json file. ";
                file_note.show();
                file_note.html(text);
                return;
            }
            file = files[0];
            if (!file.type.match("json.*")) {
                text = "Selected file is Not a Json file.Please select a json file. ";
                file_note.show();
                file_note.html(text);
                return;
            }
            reader = new window.FileReader();
            reader.onerror = function () {
                text =  "Unable to Read the file.Please check the json file. ";
                file_note.show();
                file_note.html(text);
            };
            reader.onload = function () {
                kubernetes_helper.jsondata = reader.result;
            };
            reader.readAsText(file);
        });

    }


    pre_init();

    kubernetes_helper.init = function() {
        //alert("init")
        var custom_ns = $('#deploy-app-namespace-custom');
        var ns_selector = $('#deploy-app-namespace-text');
        var note = $('#deploy-app-namespace-message');

        custom_ns.hide();
        ns_selector.on('change', function() {
            alert("ns_selecto")
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

        kubernetes_helper.manager = deploy_manager();


    }
    return kubernetes_helper;
});