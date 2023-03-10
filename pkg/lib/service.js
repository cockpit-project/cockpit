import cockpit from "cockpit";

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
 * - proxy.addEventListener('changed', event => { ... })
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
 * the service, but an enabled service is usually started on boot,
 * no matter whether other services need it or not.  A disabled
 * service is usually only started when it is needed by some other
 * service.
 *
 * - proxy.unit
 * - proxy.details
 *
 * The raw org.freedesktop.systemd1.Unit and type-specific D-Bus
 * interface proxies for the service.
 *
 * - proxy.service
 *
 * The deprecated name for proxy.details
 *
 * - promise = proxy.start()
 *
 * Start the service.  The return value is a standard jQuery
 * promise as returned from DBusClient.call.
 *
 * - promise =  proxy.restart()
 *
 * Restart the service.
 *
 * - promise = proxy.tryRestart()
 *
 * Try to restart the service if it's running or starting
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
 *
 * - journal = proxy.getRunJournal(options)
 *
 * Return the journal of the current (if running) or recent (if failed/stopped) service run,
 * similar to `systemctl status`. `options` is an optional array that gets appended to the `journalctl` call.
 */

let systemd_client;
let systemd_manager;

function wait_valid(proxy, callback) {
    proxy.wait(() => {
        if (proxy.valid)
            callback();
    });
}

function with_systemd_manager(done) {
    if (!systemd_manager) {
        // cached forever, only used for reading/watching; no superuser
        systemd_client = cockpit.dbus("org.freedesktop.systemd1");
        systemd_manager = systemd_client.proxy("org.freedesktop.systemd1.Manager",
                                               "/org/freedesktop/systemd1");
        wait_valid(systemd_manager, () => {
            systemd_manager.Subscribe()
                    .catch(error => {
                        if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                        error.name != "org.freedesktop.DBus.Error.FileExists")
                            console.warn("Subscribing to systemd signals failed", error);
                    });
        });
    }
    wait_valid(systemd_manager, done);
}

export function proxy(name, kind) {
    const self = {
        exists: null,
        state: null,
        enabled: null,

        wait,

        start,
        stop,
        restart,
        tryRestart,

        enable,
        disable,

        getRunJournal,
    };

    cockpit.event_target(self);

    let unit, details;
    let wait_promise_resolve;
    const wait_promise = new Promise(resolve => { wait_promise_resolve = resolve });

    if (name.indexOf(".") == -1)
        name = name + ".service";
    if (kind === undefined)
        kind = "Service";

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
        wait_promise_resolve();
    }

    function update_from_details() {
        self.details = details;
        self.service = details;
        self.dispatchEvent("changed");
    }

    with_systemd_manager(function () {
        systemd_manager.LoadUnit(name)
                .then(path => {
                    unit = systemd_client.proxy('org.freedesktop.systemd1.Unit', path);
                    unit.addEventListener('changed', update_from_unit);
                    wait_valid(unit, update_from_unit);

                    details = systemd_client.proxy('org.freedesktop.systemd1.' + kind, path);
                    details.addEventListener('changed', update_from_details);
                    wait_valid(details, update_from_details);
                })
                .catch(() => {
                    self.exists = false;
                    self.dispatchEvent('changed');
                });
    });

    function refresh() {
        if (!unit || !details)
            return Promise.resolve();

        function refresh_interface(path, iface) {
            return systemd_client.call(path, "org.freedesktop.DBus.Properties", "GetAll", [iface])
                    .then(([result]) => {
                        const props = { };
                        for (const p in result)
                            props[p] = result[p].v;
                        systemd_client.notify({ [unit.path]: { [iface]: props } });
                    })
                    .catch(error => console.log(error));
        }

        return Promise.allSettled([
            refresh_interface(unit.path, "org.freedesktop.systemd1.Unit"),
            refresh_interface(details.path, "org.freedesktop.systemd1." + kind),
        ]);
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

    // This is what we want to do:
    // systemd_manager.addEventListener("UnitNew", function (event, unit_id, path) {
    //     if (unit_id == name)
    //         refresh();
    // });

    // This is what we have to do:
    systemd_manager.addEventListener("Reloading", (event, reloading) => {
        if (!reloading)
            refresh();
    });

    systemd_manager.addEventListener("JobNew", on_job_new_removed_refresh);
    systemd_manager.addEventListener("JobRemoved", on_job_new_removed_refresh);

    function wait(callback) {
        wait_promise.then(callback);
    }

    /* Actions
     *
     * We don't call methods on the persistent systemd_client, as that does not have superuser
     */

    function call_manager(dbus, method, args) {
        return dbus.call("/org/freedesktop/systemd1",
                         "org.freedesktop.systemd1.Manager",
                         method, args);
    }

    function call_manager_with_job(method, args) {
        return new Promise((resolve, reject) => {
            const dbus = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
            let pending_job_path;

            const subscription = dbus.subscribe(
                { interface: "org.freedesktop.systemd1.Manager", member: "JobRemoved" },
                (_path, _iface, _signal, [_number, path, _unit_id, result]) => {
                    if (path == pending_job_path) {
                        subscription.remove();
                        dbus.close();
                        refresh().then(() => {
                            if (result === "done")
                                resolve();
                            else
                                reject(new Error(`systemd job ${method} ${JSON.stringify(args)} failed with result ${result}`));
                        });
                    }
                });

            call_manager(dbus, method, args)
                    .then(([path]) => { pending_job_path = path })
                    .catch(() => {
                        dbus.close();
                        reject();
                    });
        });
    }

    function call_manager_with_reload(method, args) {
        const dbus = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
        return call_manager(dbus, method, args)
                .then(() => call_manager(dbus, "Reload", []))
                .then(refresh)
                .finally(dbus.close);
    }

    function start() {
        return call_manager_with_job("StartUnit", [name, "replace"]);
    }

    function stop() {
        return call_manager_with_job("StopUnit", [name, "replace"]);
    }

    function restart() {
        return call_manager_with_job("RestartUnit", [name, "replace"]);
    }

    function tryRestart() {
        return call_manager_with_job("TryRestartUnit", [name, "replace"]);
    }

    function enable() {
        return call_manager_with_reload("EnableUnitFiles", [[name], false, false]);
    }

    function disable() {
        return call_manager_with_reload("DisableUnitFiles", [[name], false]);
    }

    function getRunJournal(options) {
        if (!details || !details.ExecMainStartTimestamp)
            return Promise.reject(new Error("getRunJournal(): unit is not known"));

        // collect the service journal since start time; property is μs, journal wants s
        const startTime = Math.floor(details.ExecMainStartTimestamp / 1000000);
        return cockpit.spawn(
            ["journalctl", "--unit", name, "--since=@" + startTime.toString()].concat(options || []),
            { superuser: "try", error: "message" });
    }

    return self;
}
