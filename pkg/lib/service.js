(function() {
    "use strict";

    var cockpit = require("cockpit");

    /* SERVICE MANAGEMENT API
     *
     * The "service" module lets you monitor and manage a
     * system service on localhost in a simple way.
     *
     * It mainly exists because talking to the systemd D-Bus API is
     * not trivial enough to do it directly.
     *
     * - proxy = service.proxy(name)
     *
     * Create a proxy that represents the service named NAME.
     *
     * The proxy has properties and methods (described below) that
     * allow you to monitor the state of the service, and perform
     * simple actions on it.
     *
     * Initially, any of the properties can be "null" until their
     * actual values have been retrieved in the background.
     *
     * - $(proxy).on('changed', function (event) { ... })
     *
     * The 'changed' event is emitted whenever one of the properties
     * of the proxy changes.
     *
     * - proxy.exists
     *
     * A boolean that tells whether the service is known or not.  A
     * proxy with 'exists == false' will have 'state == undefined' and
     * 'enabled == undefined'.
     *
     * - proxy.state
     *
     * Either 'undefined' when the state can't be retrieved, or a
     * string that has one of the values "starting", "running",
     * "stopping", "stopped", or "failed".
     *
     * - proxy.enabled
     *
     * Either 'undefined' when the value can't be retrieved, or a
     * boolean that tells whether the service is started 'enabled'.
     * What it means exactly for a service to be enabled depends on
     * the service, but a enabled service is usually started on boot,
     * no matter wether other services need it or not.  A disabled
     * service is usually only started when it is needed by some other
     * service.
     *
     * - proxy.unit
     * - proxy.service
     *
     * The raw org.freedesktop.systemd1.Unit and Service D-Bus
     * interface proxies for the service.
     *
     * - promise = proxy.start()
     *
     * Start the service.  The return value is a standard jQuery
     * promise as returned from DBusClient.call.
     *
     * - promise = proxy.stop()
     *
     * Stop the service.
     *
     * - promise = proxy.enable()
     *
     * Enable the service.
     *
     * - promise = proxy.disable()
     *
     * Disable the service.
     */

    var systemd_client;
    var systemd_manager;

    function wait_valid(proxy, callback) {
        proxy.wait(function() {
            if (proxy.valid)
                callback();
        });
    }

    function with_systemd_manager(done) {
        if (!systemd_manager) {
            systemd_client = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
            systemd_manager = systemd_client.proxy("org.freedesktop.systemd1.Manager",
                                                   "/org/freedesktop/systemd1");
            wait_valid(systemd_manager, function() {
                systemd_manager.Subscribe().
                    fail(function (error) {
                        if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                            error.name != "org.freedesktop.DBus.Error.FileExists")
                            console.warn("Subscribing to systemd signals failed", error);
                    });
            });
        }
        wait_valid(systemd_manager, done);
    }

    function proxy(name) {
        var self = {
            exists: null,
            state: null,
            enabled: null,

            wait: wait,

            start: start,
            stop: stop,
            restart: restart,

            enable: enable,
            disable: disable
        };

        cockpit.event_target(self);

        var unit, service;
        var wait_callbacks = cockpit.defer();

        if (name.indexOf(".") == -1)
            name = name + ".service";

        function update_from_unit() {
            self.exists = (unit.LoadState != "not-found" || unit.ActiveState != "inactive");

            if (unit.ActiveState == "activating")
                self.state = "starting";
            else if (unit.ActiveState == "deactivating")
                self.state = "stopping";
            else if (unit.ActiveState == "active" || unit.ActiveState == "reloading")
                self.state = "running";
            else if (unit.ActiveState == "failed")
                self.state = "failed";
            else if (unit.ActiveState == "inactive" && self.exists)
                self.state = "stopped";
            else
                self.state = undefined;

            if (unit.UnitFileState == "enabled" || unit.UnitFileState == "linked")
                self.enabled = true;
            else if (unit.UnitFileState == "disabled" || unit.UnitFileState == "masked")
                self.enabled = false;
            else
                self.enabled = undefined;

            self.unit = unit;

            self.dispatchEvent("changed");
            wait_callbacks.resolve();
        }

        function update_from_service() {
            self.service = service;
            self.dispatchEvent("changed");
        }

        with_systemd_manager(function () {
            systemd_manager.LoadUnit(name).
                done(function (path) {
                    unit = systemd_client.proxy('org.freedesktop.systemd1.Unit', path);
                    unit.addEventListener('changed', update_from_unit);
                    wait_valid(unit, update_from_unit);

                    service = systemd_client.proxy('org.freedesktop.systemd1.Service', path);
                    service.addEventListener('changed', update_from_service);
                    wait_valid(service, update_from_service);
                }).
                fail(function (error) {
                    self.exists = false;
                    self.dispatchEvent('changed');
                });
        });

        function refresh() {
            if (!unit || !service)
                return;

            function refresh_interface(path, iface) {
                systemd_client.call(path,
                                    "org.freedesktop.DBus.Properties", "GetAll", [ iface ]).
                    fail(function (error) {
                        console.log(error);
                    }).
                    done(function (result) {
                        var props = { };
                        for (var p in result[0])
                            props[p] = result[0][p].v;
                        var ifaces = { };
                        ifaces[iface] = props;
                        var data = { };
                        data[unit.path] = ifaces;
                        systemd_client.notify(data);
                    });
            }

            refresh_interface(unit.path, "org.freedesktop.systemd1.Unit");
            refresh_interface(service.path, "org.freedesktop.systemd1.Service");
        }

        function on_job_new_removed_refresh(event, number, path, unit_id, result) {
            if (unit_id == name)
                refresh();
        }

        /* HACK - https://bugs.freedesktop.org/show_bug.cgi?id=69575
         *
         * We need to explicitly get new property values when getting
         * a UnitNew signal since UnitNew doesn't carry them.
         * However, reacting to UnitNew with GetAll could lead to an
         * infinite loop since systemd emits a UnitNew in reaction to
         * GetAll for units that it doesn't want to keep loaded, such
         * as units without unit files.
         *
         * So we ignore UnitNew and instead assume that the unit state
         * only changes in interesting ways when there is a job for it
         * or when the daemon is reloaded (or when we get a property
         * change notification, of course).
         */

        if (false) {
            // This is what we want to do.

            systemd_manager.addEventListener("UnitNew", function (event, unit_id, path) {
                if (unit_id == name)
                    refresh();
            });
        } else {
            // This is what we have to do.

            systemd_manager.addEventListener("Reloading", function (event, reloading) {
                if (!reloading)
                    refresh();
            });

            systemd_manager.addEventListener("JobNew", on_job_new_removed_refresh);
            systemd_manager.addEventListener("JobRemoved", on_job_new_removed_refresh);
        }

        function wait(callback) {
            wait_callbacks.promise.then(callback);
        }

        /* Actions
         *
         * We don't call methods on the D-Bus proxies here since they
         * might not be ready when these functions are called.
         */

        var pending_jobs = { };

        systemd_manager.addEventListener("JobRemoved", function (event, number, path, unit_id, result) {
            if (pending_jobs[path]) {
                if (result == "done")
                    pending_jobs[path].resolve();
                else
                    pending_jobs[path].reject(result);
                delete pending_jobs[path];
            }
        });

        function call_manager(method, args) {
            return systemd_client.call("/org/freedesktop/systemd1",
                                       "org.freedesktop.systemd1.Manager",
                                       method, args);
        }

        function call_manager_with_job(method, args) {
            var dfd = cockpit.defer();
            call_manager(method, args).
                done(function (results) {
                    var path = results[0];
                    pending_jobs[path] = dfd;
                }).
                fail(function (error) {
                    dfd.reject(error);
                });
            return dfd.promise();
        }

        function call_manager_with_reload(method, args) {
            return call_manager(method, args).then(function () {
                return call_manager("Reload", [ ]);
            });
        }

        function start() {
            return call_manager_with_job("StartUnit", [ name, "replace" ]);
        }

        function stop() {
            return call_manager_with_job("StopUnit", [ name, "replace" ]);
        }

        function restart() {
            return call_manager_with_job("RestartUnit", [ name, "replace" ]);
        }

        function enable() {
            return call_manager_with_reload("EnableUnitFiles", [ [ name ], false, false ]);
        }

        function disable() {
            return call_manager_with_reload("DisableUnitFiles", [ [ name ], false ]);
        }

        return self;
    }

    module.exports = {
        proxy: proxy
    };
}());
