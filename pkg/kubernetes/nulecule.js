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
    "kubernetes/config"
], function($, cockpit, config) {
    "use strict";

    var nulecule = { };
    var _ = cockpit.gettext;

    function debug() {
        if (window.debugging == "all" || window.debugging == "nulecule")
            console.debug.apply(console, arguments);
    }

    function failure(ex) {
        console.warn(ex);
    }

    /**
     * NuleculeClient
     *
     */
    function NuleculeClient() {
        var self = this;
        var http = cockpit.http(5000);
        var version = '0.1.1';
        var status = "";
        var answers = {};
        var install_dir = "";

        self.create_tmp = function create_tmp() {
            var process = cockpit.spawn(['/bin/sh', '-s']).input("mktemp -p /tmp -d APP_ENTITY.XXXX");
            return process;
        };

        self.writeAnswerfile = function writeAnswerfile(install_dir, data) {
            return cockpit.file(install_dir + "/answers.conf").replace(JSON.stringify(data));
        };

        self.get_version = function get_version() {
            return version;
        };

        self.get_answers = function get_answers() {
            return answers;
        };

        self.set_answers = function set_answers(ans) {
            answers = ans;
        };

        self.get_install_dir = function get_install_dir() {
            return install_dir;
        };

        self.loadAnswersfile = function loadAnswersfile(statusl) {
            statusl.forEach(function(item) {
                if (item.status_message.indexOf("answers.conf") > -1)
                    answers = item.status_data;
                    debug("answer file contents : " + String(answers));
            });
            return answers;
        };

        self.get_statuslist = function get_statuslist() {
            var dfd = $.Deferred();
            var response;
            var req = http.get("/atomicapp-run/api/v" + version + "/status")
                    .done(function(data) {
                        req = null;
                        try {
                            response = JSON.parse(data);
                            dfd.resolve(response.items);
                        } catch(ex) {
                            failure(ex);
                            dfd.reject(ex);
                        }
                    })
                    .fail(function(ex) {
                        failure(ex);
                        req = null;
                        dfd.reject(ex);
                    });
            var promise = dfd.promise();
            promise.cancel = function cancel() {
                req.cancel();
            };

            return promise;
        };

        self.kill_atomicapp = function kill_atomicapp() {
            var preq = http.post("/atomicapp-run/api/v" + version + "/quit")
                .done(function(data){
                    preq = null;
                    debug(data);
                })
                .fail(function(ex) {
                    preq = null;
                    debug(ex);
                });
        };

        self.close = function close() {
            self.kill_atomicapp();
            return;
        };

        self.installrun = function installrun(ptype, tmp_dir, image) {
            var deferred = $.Deferred();
            var status = '';
            var promise;
            var buffer = '';
            var process ;
            
            if(ptype === "install") {
                process = cockpit.spawn(["/usr/bin/atomicapp", "-d", "install", "--destination", tmp_dir, image], { err: "out", superuser: "require" });
                debug("installing image: " + image + " in folder " + tmp_dir);
            } else {
                process = cockpit.spawn(['/bin/sh', '-s'],{ err: "out", superuser: "require" }).input("cd " + tmp_dir + " && /usr/bin/atomicapp -d -v run .");
                debug("Running from folder " + tmp_dir);
            }
            
            function check_status(statuss) {
                var error ;
                var errmsg = "";
                if(statuss && statuss.status === "ERROR") {
                    errmsg = statuss.status_message;
                    var msgl = errmsg.split('Exception raised:');
                    if(msgl.length > 1)
                        errmsg = msgl[1];
                    error = new Error(errmsg);
                    deferred.reject(error);
                    window.clearInterval(timer);
                    process.close();                    
                } else if(statuss && statuss.status === "PENDING") {
                    deferred.notify(statuss.status_message);      
                } else if(statuss && statuss.status === "COMPLETED") {
                    deferred.resolve(statuss.status_message);
                    window.clearInterval(timer);
                    process.close();
                } else {
                    error = new Error(_("No Status Message found."));
                    deferred.reject(error);
                    window.clearInterval(timer);
                    process.close();
                }
            }

            var timer = window.setInterval(function() { 
                var req = http.get("/atomicapp-run/api/v" + version + "/status")
                        .done(function(data) {
                            req = null;

                            var response;
                            try {
                                response = JSON.parse(data);
                                status = response.items[response.items.length-1];
                                debug("status response = " + JSON.stringify(status));
                                check_status(status);
                            } catch(ex) {
                                failure(ex);
                                debug("not an api endpoint without JSON data on:");
                            }

                        })
                        .fail(function(ex) {
                            req = null;
                        });

                    }, 500);

            

            process.always(function() {
                    window.clearInterval(timer);
                })
                .stream(function(text) {
                    //buffer += text;                 
                })
                .done(function(output) {
                    deferred.resolve();
                })
                .fail(function(ex) {
                    var message;
                    if (ex.problem === "cancelled") {
                        deferred.reject(ex);
                        return;
                    }

                    if (!message) {
                        message = _("Image failed to " + ptype);
                        console.warn(ex.message);
                    }
                    var error = new Error(message);

                    //Get the last Error status
                    self.get_statuslist()
                        .done(function(data){

                            if(data) {
                                data = data[data.length-1];
                                message = data.status_message;
                                var msgl = message.split('Exception raised:');
                                if(msgl.length > 1)
                                    message = msgl[1];

                            }
                            var err = new Error(message);
                            deferred.reject(err);
                        })
                        .fail(function(data){
                            var msgg = _("Image failed to " + ptype);
                            message = msgg;
                            console.warn(ex.message);
                            deferred.reject(error);
                        });

                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                window.clearInterval(timer);
                process.close("cancelled");
            };

            return promise;
        };
    }

    
    nulecule.nuleculeclient =  function client() {
        return new NuleculeClient();
    };

    return nulecule;
});
