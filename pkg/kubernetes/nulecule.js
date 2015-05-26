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

        self.get_status = function get_status() {
            var req = http.get("/atomicapp-run/api/v1.0/status")
                        .done(function(data) {
                            req = null;

                            var response;
                            try {
                                response = JSON.parse(data);
                                status = response.items[response.items.length-1];
                                console.log("status = " + JSON.stringify(status));
                                return JSON.stringify(status);
                            } catch(ex) {
                                debug("not an api endpoint without JSON data on:");
                                return "ERROR: not an api endpoint without JSON data on";
                            }

                        })
                        .fail(function(ex) {
                            req = null;
                            return "ERROR: request failed";
                        });
        };

        self.create_tmp = function create_tmp() {
            var dfd = $.Deferred();
            var promise;
            var process = cockpit.spawn(['/bin/sh', '-s']).input("mktemp -p $XDG_RUNTIME_DIR -d APP_ENTITY.XXXXXX")
            process.done(function(data){
                    dfd.resolve(data);
                })
                .fail(function(ex){
                    dfd.reject(ex);
                });
            promise = dfd.promise();
            return promise;
        };


        self.install = function install(tmp_dir, image) {
            var deferred = $.Deferred();
            var status = '';
            var promise;
            var buffer = '';
            var cmd = "/usr/bin/atomicapp -d install --destination " + tmp_dir + " " +image;
            console.log(cmd);
            //var process = cockpit.spawn(['/bin/sh', '-s']).input(cmd);
            var process = cockpit.spawn(["/usr/bin/atomicapp", "-d", "install", "--destination", tmp_dir, image]);

            console.log("installing image: " + image + " in folder "+tmp_dir)
            deferred.notify(_("Installing Application..."));

            process.always(function() {
                    console.log("....always.....");
                    //window.clearInterval(timer);
                })
                .stream(function(text) {
                    buffer += text;
                    console.log("buf = "+buffer);
                    deferred.notify(buffer);                   
                })
                .done(function(output) {
                    console.log("....done.....");
                    deferred.resolve();
                })
                .fail(function(ex) {
                    console.log("....fail.....");
                    var message;
                    if (ex.problem === "cancelled") {
                        deferred.reject(ex);
                        return;
                    }

                    if (!message) {
                        message = _("Image failed to Install");
                        console.warn(ex.message);
                    }
                    var error = new Error(message);
                    deferred.reject(error);
                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                console.log("....cancelled.....");
                //window.clearInterval(timer);
                process.close("cancelled");
            };

            return promise;
        };
    }

    
    /*
     * Returns a new instance of Constructor for each
     * key passed into the returned function. Multiple
     * callers for the same key will get the same instance.
     *
     * Overrides .close() on the instances, to close when
     * all callers have closed.
     *
     * Instances must accept zero or one primitive arguments,
     * and must have zero arguments in their .close() method.
     */
     //TODO move it 
    function singleton(Constructor) {
        var cached = { };

        return function(key) {
            var str = key + "";

            var item = cached[str];
            if (item) {
                item.refs += 1;
                return item.obj;
            }

            item = { refs: 1, obj: new Constructor(key) };
            var close = item.obj.close;
            item.obj.close = function close_singleton() {
                item.refs -= 1;
                if (item.refs === 0) {
                    delete cached[str];
                    if (close)
                        close.apply(item.obj);
                }
            };

            cached[str] = item;
            return item.obj;
        };
    }

    nulecule.nuleculeclient = singleton(NuleculeClient);

    return nulecule;
});