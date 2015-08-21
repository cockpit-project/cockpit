define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {

    /* SERVICE MANAGEMENT API
     *
     * The "system/service" module lets you monitor and manage a
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

    function with_systemd_manager(done) {
        if (!systemd_manager) {
            systemd_client = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
            systemd_manager = systemd_client.proxy("org.freedesktop.systemd1.Manager",
                                                   "/org/freedesktop/systemd1");
            systemd_manager.wait(function () {
                systemd_manager.Subscribe().
                    fail(function (error) {
                        if (error.name != "org.freedesktop.systemd1.AlreadySubscribed")
                            console.warn("Subscribing to systemd signals failed", error);
                    });
            });
        }
        systemd_manager.wait(done);
    }

    function proxy(name) {
        var self = {
            exists: null,
            state: null,
            enabled: null,

            start: start,
            stop: stop,

            enable: enable,
            disable: disable
        };

        var unit;

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

            $(self).triggerHandler('changed');
        }

        with_systemd_manager(function () {
            systemd_manager.LoadUnit(name).
                done(function (path) {
                    unit = systemd_client.proxy('org.freedesktop.systemd1.Unit', path);
                    $(unit).on('changed', update_from_unit);
                    unit.wait(update_from_unit);
                }).
                fail(function (error) {
                    self.exists = false;
                    $(self).triggerHandler('changed');
                });
        });

        function refresh_unit() {
            if (!unit)
                return;

            systemd_client.call(unit.path,
                                "org.freedesktop.DBus.Properties", "GetAll",
                                [ "org.freedesktop.systemd1.Unit" ]).
                fail(function (error) {
                    console.log(error);
                }).
                done(function (result) {
                    var props = { };
                    for (var p in result[0])
                        props[p] = result[0][p].v;
                    var ifaces = { };
                    ifaces["org.freedesktop.systemd1.Unit"] = props;
                    var data = { };
                    data[unit.path] = ifaces;
                    systemd_client.notify(data);
                });
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

            $(systemd_manager).on("UnitNew", function (event, unit_id, path) {
                if (unit_id == name)
                    refresh_unit();
            });
        } else {
            // This is what we have to do.

            $(systemd_manager).on("Reloading", function (event, reloading) {
                if (!reloading)
                    refresh_unit();
            });

            $(systemd_manager).on("JobNew JobRemoved", function (event, number, path, unit_id, result) {
                if (unit_id == name)
                    refresh_unit();
            });
        }

        /* Actions
         *
         * We don't call methods on the D-Bus proxies here since they
         * might not be ready when these functions are called.
         */

        var pending_jobs = { };

        $(systemd_manager).on("JobRemoved", function (event, number, path, unit_id, result) {
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
            var dfd = $.Deferred();
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

        function enable() {
            return call_manager_with_reload("EnableUnitFiles", [ [ name ], false, false ]);
        }

        function disable() {
            return call_manager_with_reload("DisableUnitFiles", [ [ name ], false ]);
        }

        return self;
    }

    return {
        proxy: proxy
    };
});
