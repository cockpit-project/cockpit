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
    "base1/cockpit"
], function($, cockpit) {
    "use strict";

    var nulecule = { };
    var _ = cockpit.gettext;

    function debug(args) {
        if (window.debugging == "all" || window.debugging == "nulecule")
            console.debug.apply(console, arguments);

    }

    /**
     * NuleculeClient
     *
     */
    function NuleculeClient() {
        var self = this;
        self.answers = {};
        var install_dir = null;

        function create_tmp() {
            var process = cockpit.spawn(['/bin/sh', '-s']).input("mktemp -p /tmp -d APP_ENTITY.XXXX");
            return process;
        }

        function delete_tmp() {
            var msgl = install_dir.split('/tmp/');
            var folder;
            if(msgl.length > 1) {
                folder = msgl[1];
            }
            debug("removing folder " + folder);
            var process = cockpit.spawn(["rm", "-fr", folder],{ err: "out", superuser: true , directory: '/tmp', pty: true });
            install_dir = null;

            return process.fail(function (ex) {
                console.warn("Error cleaning up nulecule temporary files: " + ex.message);
            });
        }

        function write_answer_file(data) {
            var dfd = $.Deferred();
            debug("writing to " + install_dir + "/answers.conf");
            var file = cockpit.file(install_dir + "/answers.conf");
            var req = file.replace(JSON.stringify(data))
                .done(function(){
                    dfd.resolve();
                    file.close();
                })
                .fail(function(ex){
                    console.warn(ex);
                    dfd.reject(ex);
                    file.close();
                });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                req.cancel();
                file.close();
            };

            return promise;
        }

        function installrun(ptype, image) {
            var deferred = $.Deferred();
            var promise;
            var process;

            if (!install_dir) {
                deferred.reject();
                return deferred.promise();
            }

            if(ptype === "install") {
                //atomic install --opt2=--answers-format=json <IMAGE> command
                //internally calls...
                //atomicapp --answers-format=json install <IMAGE>
                process = cockpit.spawn(["/usr/bin/atomic", "install", "--opt2=--answers-format=json", image],{ err: "out", superuser: true , directory: install_dir, pty: true });
                debug("Installing image: " + image + " in folder " + install_dir);
                deferred.notify(_("Installing ..."));
            } else {
                //atomic run --opt2=--answers="/tmp/answers.conf" <IMAGE>
                //internally calls...
                //atomicapp --answers=/tmp/answers.conf run <IMAGE>
                process = cockpit.spawn(["/usr/bin/atomic", "run", "--opt2=--answers=/atomicapp/answers.conf", image],{ err: "out", superuser: true , directory: install_dir , pty: true});
                debug("Running image: " + image + " in folder " + install_dir);
                deferred.notify(_("Running ..."));
            }

            process.always(function() {
                    process.close();
                })
                .stream(function(text) {
                    text = String(text);
                    debug("buffer="+text);
                    var msgl;
                    if(text.indexOf("atomicapp.status.info.message") > -1) {
                        msgl = text.split('atomicapp.status.info.message=');
                        if(msgl.length > 1)
                            deferred.notify(msgl[1]);

                    } else if(text.indexOf("atomicapp.status.error.message") > -1) {
                        msgl = text.split('atomicapp.status.error.message=');
                        if(msgl.length > 1) {
                            var error = new Error(msgl[1]);
                            deferred.reject(error);
                        }
                    }
                })
                .done(function(output) {

                    deferred.resolve();
                })
                .fail(function(ex) {

                    if (ex.problem === "cancelled") {
                        deferred.reject(ex);
                        return;
                    }

                    var message = _("Image failed to " + ptype);
                    console.warn(ex.message);
                    var err = new Error(message);
                    deferred.reject(err);

                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                process.close("cancelled");
            };

            return promise;
        }

        self.close = function close() {
            if (install_dir)
                delete_tmp();
            return;
        };

        self.install = function install(image) {
            var deferred = $.Deferred();
            var promise = null;
            var create;
            var runner;

            if (install_dir)
                delete_tmp();

            create = create_tmp()
                .done(function(dir){
                    install_dir = dir.trim();
                    debug("created directory :"+ install_dir);
                    runner = installrun("install", image)
                        .progress(function(msg) {
                            deferred.notify(msg);
                        })
                        .done(function() {
                            debug("reading " + install_dir + "/answers.conf.sample");
                            var file = cockpit.file(install_dir + "/answers.conf.sample");
                            file.read()
                                .done(function(content){
                                    if(content) {
                                        var jdata = JSON.parse(content);
                                        debug(jdata);
                                        self.answers = jdata;
                                        deferred.resolve(jdata);
                                    } else {
                                        var message = _("Unable to read answer.conf.sample file.");
                                        var err = new Error(message);
                                        deferred.reject(err);
                                    }
                                    file.close();
                                })
                                .fail(function(ex){
                                    console.warn(ex);
                                    deferred.reject(ex);
                                    file.close();
                                });
                        })
                        .fail(function(ex){
                            var message = _("Image failed to install.");
                            console.warn(ex.message);
                            var err = new Error(message);
                            deferred.reject(err);
                        });
                })
                .fail(function(ex){
                    var message = _("Temporary folder was not created");
                    console.warn(ex.message);
                    var err = new Error(message);
                    deferred.reject(err);
                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                if (runner)
                    runner.cancel();
                else
                    create.cancel();
            };

            return promise;
        };

        self.run = function run(image) {
            var deferred = $.Deferred();
            var promise = null;
            var writer;
            var runner;

            writer = write_answer_file(self.answers)
                .progress(function(msg) {
                    deferred.notify (msg);
                })
                .done(function(){
                    runner = installrun("run", image)
                        .progress(function(msg) {
                            deferred.notify (msg);
                        })
                        .done(function(){
                            deferred.resolve();
                        })
                        .fail(function(ex){
                            var message = _("Image failed to run.");
                            console.warn(ex.message);
                            var err = new Error(message);
                            deferred.reject(err);
                        });
                })
                .fail(function(ex) {
                    deferred.reject(ex);
                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                if (runner)
                    runner.cancel();
                else
                    writer.cancel();
            };

            return promise;
        };
    }

    nulecule.nuleculeclient =  function client() {
        return new NuleculeClient();
    };

    return nulecule;
});
