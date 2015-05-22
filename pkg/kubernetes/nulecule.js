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

        self.install = function install(image) {
            var deferred = $.Deferred();
            var status = '';
            var timer = window.setInterval(function() { 
                var http = cockpit.http(5000);
                var req = http.get("/atomicapp-run/api/v1.0/status")
                    .done(function(data) {
                        req = null;

                        var response;
                        try {
                            response = JSON.parse(data);
                            status = response.items[response.items.length-1];
                            console.log("status = " + JSON.stringify(status));
                            deferred.notify(JSON.stringify(status));
                        } catch(ex) {
                            debug("not an api endpoint without JSON data on:");
                            return;
                        }

                    })
                    .fail(function(ex) {
                        req = null;
                        
                    });                   

                }, 1000);

            var args = ['atomicapp', '-d', 'install', image];

            deferred.notify(_("Installing Application..."));

            var process = cockpit.spawn(args);

            var promise;
            var buffer = '';
            process.always(function() {
                    console.log("....always.....");
                    window.clearInterval(timer);
                })
                .stream(function(text) {
                    buffer += text;
                    console.log("buf = "+buffer);
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
                window.clearInterval(timer);
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