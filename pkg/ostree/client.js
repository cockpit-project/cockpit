var cockpit = require('cockpit');
var _ = cockpit.gettext;

var DEST = 'org.projectatomic.rpmostree1';
var PATH = '/org/projectatomic/rpmostree1';

var SYSROOT = 'org.projectatomic.rpmostree1.Sysroot';
var SYSROOT_PATH = '/org/projectatomic/rpmostree1/Sysroot';

var OS = 'org.projectatomic.rpmostree1.OS';
var TRANSACTION = 'org.projectatomic.rpmostree1.Transaction';

/*
 * Breaks down progress messages into
 * a string that can be displayed
 * Similar to the cli output but simplier.
 * We don't display object counts or bytes/s.
 * Percentages are only possible when
 * we actually know what is going to be pulled.
 *
 * progress_arg is a tuple of 6 tuples
 * with the following values:
 *
 * time data (tt): (start time, elapsed seconds)
 * outstanding data counts (uu): (outstanding fetches,
 *                                 outstanding writes)
 * metadata counts (uuu): (scanned, fetched, outstanding)
 * delta data (uuut): (total parts, fetched parts,
 *                     total super blocks, total size)
 * content objects (uu): (fetched objects, requested objects)
 * transfer data (tt): (bytes transfered, bytes/s)
 */

function build_progress_line(progress_arg) {
    if (!progress_arg || progress_arg.length != 6 ||
        progress_arg[0].length != 2 || progress_arg[1].length != 2 ||
        progress_arg[2].length != 3 || progress_arg[3].length != 4 ||
        progress_arg[4].length != 2 || progress_arg[5].length != 2) {
            console.warn("Unknown progress data", progress_arg);
            return;
    }

    var line;
    var outstanding_fetches = progress_arg[1][0];
    var outstanding_writes = progress_arg[1][0];

    var outstanding_metadata_fetches = progress_arg[2][2];

    var total_delta_parts = progress_arg[3][0];

    var fetched = progress_arg[4][0];
    var requested = progress_arg[4][1];

    if (outstanding_fetches) {
        if (total_delta_parts > 0) {
            line = _("Receiving delta parts");
        } else if (outstanding_metadata_fetches) {
            line = _("Receiving metadata objects");
        }  else {
            var percent = (fetched / requested) * 100;
            line = cockpit.format(_("Receiving objects: $0%"), percent.toFixed(2));
        }
    } else if (outstanding_writes) {
        line = _("Writing objects");
    } else {
        line = _("Scanning metadata");
    }
    return line;
}

function process_diff_list(result) {
    var key_names = ["adds", "removes", "up", "down"];
    var list = result[0];
    var diffs = {};
    for (var i = 0; i < list.length; i++) {
        var key = key_names[list[i][1]];

        if (!diffs[key])
            diffs[key] = [];

        var obj = {
            name: list[i][0],
            type: list[i][1],
        };

        if (obj.type === 1) {
            obj.version = list[i][2]["PreviousPackage"]["v"][1];
            obj.arch = list[i][2]["PreviousPackage"]["v"][2];
        } else {
            obj.version = list[i][2]["NewPackage"]["v"][1];
            obj.arch = list[i][2]["NewPackage"]["v"][2];
        }

        diffs[key].push(obj);
    }
    return diffs;
}

function process_rpm_list(result) {
    var data = [];
    result.split("\n").forEach(function(v) {
        if (v) {
            data.push({
                'name': v,
            });
        }
    });
    data.sort(function(a, b) {
        var n1 = a.name ? a.name : "";
        var n2 = b.name ? b.name : "";

        return n1.toLowerCase().localeCompare(n2.toLowerCase());
    });

    if (data.length < 1)
        return;

    var half = Math.floor(data.length / 2);
    if (data.length % 2)
        half = half + 1;

    return {
        rpms1: data.slice(0, half+1),
        rpms2: data.slice(half+1),
    };
}

function Packages(promise, transform) {
    var self = this;
    self.error = null;
    self.ready = false;
    self.empty = false;

    cockpit.event_target(self);

    promise
        .done(function(result) {
            var empty = true;
            if (transform)
                result = transform(result);

            for (var k in result) {
                self[k] = result[k];
                empty = false;
            }

            self.empty = empty;
            self.valid = true;
        })
        .fail(function(ex) {
            self.error = cockpit.message(ex);
        })
        .always(function() {
            self.ready = true;
            self.dispatchEvent("changed");
        });
}

function RPMOSTreeDBusClient() {
    var self = this;

    cockpit.event_target(self);

    self.connection_error = null;
    self.os_list = [];

    var sysroot = null;
    var os_proxies = {};
    var os_proxies_added = null;

    var os_names = {};
    var packages_cache = {};

    var local_running = null;
    var booted_id = null;

    var client = null;
    var waits = null;
    var timer = null;
    var skipped = false;

    Object.defineProperty(this, "running_method", {
        enumerable: false,
        get: function() {
            if (local_running) {
                return local_running;
            } else if (sysroot && sysroot.ActiveTransaction) {
                var active = sysroot.ActiveTransaction[0];
                var proxy = os_proxies[sysroot.ActiveTransaction[2]];

                if (proxy && active)
                    active = active + ":" + proxy.Name;

                return active;
            } else {
                return null;
            }
        }
    });

    function resolve_nested(obj, path) {
        return path.split('.').reduce( function( prev, curr ) {
            if (prev !== undefined)
                return prev[curr];
            else
                return prev;
        }, obj || {} );
    }

    function trigger_changed() {
        if (!timer) {
            self.dispatchEvent("changed");
            timer = window.setTimeout(function() {
                timer = null;
                if (skipped)
                    self.dispatchEvent("changed");
                skipped = false;
            }, 300);
        } else {
            skipped = true;
        }
    }


    function get_client() {
        if (!client) {
            self.connection_error = null;
            self.os_list = [];

            sysroot = null;
            os_proxies = {};
            os_proxies_added = null;

            os_names = {};
            packages_cache = {};

            local_running = null;
            booted_id = null;

            waits = cockpit.defer();
            waits.promise.done(trigger_changed);

            client = cockpit.dbus(DEST, {"superuser" : true,
                                         "capabilities" : ["address"]});

            /* Watch before listening for close because watch fires first */
            client.watch(PATH).fail(tear_down);
            client.addEventListener("close", closing);

            sysroot = client.proxy(SYSROOT, SYSROOT_PATH);
            sysroot.addEventListener("changed", on_sysroot_changed);
            sysroot.wait(function() {
                if (sysroot && sysroot.valid)
                    build_os_list(sysroot.Deployments);

                if (client) {
                    os_proxies = client.proxies(OS, PATH);
                    os_proxies_added = function(event, proxy) {
                        if (proxy.Name)
                            os_names[proxy.Name] = proxy.path;
                        trigger_changed();
                    };
                    os_proxies.addEventListener("changed", trigger_changed);
                    os_proxies.addEventListener("added", os_proxies_added);

                    os_proxies.wait(function() {
                        for (var path in os_proxies) {
                            var proxy = os_proxies[path];
                            os_names[proxy.Name] = path;
                        }
                        waits.resolve();
                    });
                } else {
                    waits.resolve();
                }
            });



       }
       return client;
    }

    function tear_down(ex) {
        client = null;
        self.connection_error = ex;
        if (sysroot) {
            sysroot.removeEventListener("changed", on_sysroot_changed);
            sysroot = null;
        }
        if (os_proxies) {
            if (os_proxies_added)
                os_proxies.removeEventListener("added", os_proxies_added);
            os_proxies_added = null;
            os_proxies = {};
        }
    }

    function closing(event, ex) {
        tear_down(ex);
        self.dispatchEvent("connectionLost", [ ex ]);
    }

    /* The order of deployments indicates
     * the order the OS names should be in.
     */
    function build_os_list(data) {
        var seen = {};
        var os_list = [];
        if (data) {
            for (var i = 0; i < data.length; i++) {
                var deployment = data[i];
                var os = deployment.osname.v;

                if (!seen[os])
                    os_list.push(os);
                seen[os] = true;
            }
        }

        self.os_list = os_list;
        trigger_changed();
    }

    function on_sysroot_changed(ev, data) {
        if (data["Deployments"]) {
            build_os_list(data["Deployments"]);
        } else if ("ActiveTransaction" in data) {
            trigger_changed();
        }
    }

    self.connect = function() {
        var dp = cockpit.defer();
        get_client();
        waits.promise.done(function() {
            if (self.connection_error)
                dp.reject(self.connection_error);
            else
                dp.resolve(client);
        });
        return dp.promise;
    };

    self.known_versions_for = function(os_name) {
        /* The number of deployments should always be a small
         * number. If that turns out to not be the case we
         * can cache this on a local property.
         */
        var deployments = sysroot ? sysroot.Deployments : [];
        var list = [];
        var upgrade_checksum;

        var proxy = self.get_os_proxy(os_name);
        if (proxy)
            upgrade_checksum = resolve_nested(proxy, "CachedUpdate.checksum.v");

        for (var i = 0; i < deployments.length; i++) {
            var deployment = deployments[i];
            var checksum = resolve_nested(deployment, "checksum.v");

            // always show the default deployment,
            // skip showing the upgrade if it is the
            // same as the default.
            if (self.item_matches(deployment, "DefaultDeployment")) {
                if (upgrade_checksum && checksum !== upgrade_checksum)
                    list.push(proxy.CachedUpdate);
                list.push(deployment);

            // skip other deployments if it is the same as the upgrade
            } else if (resolve_nested(deployment, "checksum.v") !== upgrade_checksum) {
                list.push(deployment);
            }
        }

        return list;
    };

    self.get_os_proxy = function(os_name) {
        var path = os_names[os_name];
        var proxy = null;
        if (path)
            proxy = os_proxies[path];
        return proxy;
    };

    /* This is a little fragile because the
     * the dbus varient is simply 'av'.
     * Ostree promises to not remove or change the
     * order of any of these attributes.
     *  https://github.com/ostreedev/ostree/commit/4a2733f9e7e2ca127ff27433c045c977000ca346#diff-c38f32cb7112030f3326b43e305f2accR424
     * Here's the definition this relies on
     * - bool valid
     * - bool is sig expired
     * - bool is key expired
     * - bool is key revoked
     * - bool is key missing
     * - str key fingerprint
     * - int signature timestamp
     * - int signature expiry timestamp
     * - str key algo name
     * - str key hash algo name
     * - str key user name
     * - str key user email
     */
    self.signature_obj = function(signature) {
        if (!signature.v)
            return;

        var by = signature.v[11];
        if (signature.v[10])
            by = by ? cockpit.format("$0 <$1>", signature.v[10], by) : signature.v[10];

        return {
            'fp' : signature.v[5],
            'fp_name' : signature.v[8] ? cockpit.format(_("$0 key ID"), signature.v[8]) : null,
            'expired' : signature.v[1] || signature.v[2],
            'valid' : signature.v[0],
            'timestamp' : signature.v[6],
            'by' : by
        };
    };

    /* Because all our deployment package diffs can only
     * change when the machine is rebooted we
     * fetch and store them once here and
     * never fetch them again.
     * Pending updates are tracked by checksum since those
     * can change.
     */
    self.packages = function(item) {
        var id = resolve_nested(item, "id.v");
        var checksum = resolve_nested(item, "checksum.v");
        var key = id;

        if (!id && checksum)
            key = checksum;

        if (!booted_id) {
            var root_proxy = os_proxies[sysroot.Booted];
            if (root_proxy)
                booted_id = root_proxy.BootedDeployment.id.v;
            else
                return;
        }

        if (key && !packages_cache[key]) {
            var proxy = self.get_os_proxy(item.osname.v);
            var packages;
            var promise;
            if (proxy) {
                if (id === booted_id) {
                    promise = cockpit.spawn(['rpm', '-qa']);
                    packages = new Packages(promise,
                                            process_rpm_list);
                } else if (id) {
                    promise = proxy.call("GetDeploymentsRpmDiff",
                                             [booted_id, id]);
                    packages = new Packages(promise,
                                            process_diff_list);
                } else {
                    promise = proxy.call("GetCachedUpdateRpmDiff", [""]);
                    packages = new Packages(promise,
                                            process_diff_list);
                }
                packages_cache[key] = packages;
            }
        }
        return packages_cache[key];
    };

    self.item_matches = function(item, attr) {
        var os_name = resolve_nested(item, "osname.v");
        var proxy = null;
        var item2 = null;

        if (!os_name)
            return false;

        proxy = self.get_os_proxy(os_name);
        item2 = resolve_nested(proxy, attr);

        return resolve_nested(item, "checksum.v") === resolve_nested(item2, "checksum.v");
    };

    self.run_transaction = function(method, method_args, os) {
        local_running = method + ":" + os;
        var transaction_client = null;
        var subscription = null;
        var dp = cockpit.defer();
        var i;
        var reboot = false;

        if (Array.isArray(method_args)) {
            for (i = 0; i < method_args.length; i++) {
                var val = method_args[i];
                if (val !== null && typeof val === 'object' && "reboot" in val) {
                    reboot = method_args[i].reboot;
                    break;
                }
            }
        }

        function cleanup(ex) {
            local_running = null;
            if (transaction_client) {
                if (subscription)
                    subscription.remove();

                transaction_client.removeEventListener("close", on_close);
                transaction_client.close();
            }
            transaction_client = null;
            subscription = null;
            trigger_changed();
        }

        function fail(ex) {
            dp.reject(ex);
            cleanup();
        }

        function on_close(event, ex) {
            fail(ex);
        }

        self.connect()
            .fail(fail)
            .done(function () {
                var proxy = self.get_os_proxy(os);

                if (!proxy)
                    return fail(cockpit.format(_("OS $0 not found"), os));

                proxy.call(method, method_args)
                    .fail(fail)
                    .done(function(result) {
                        var connect_args = {
                            "superuser" : true,
                            "address": result[0],
                            "bus": "none"
                        };

                        if (reboot)
                            cockpit.hint('restart');

                        transaction_client = cockpit.dbus(null, connect_args);
                        transaction_client.addEventListener("close", on_close);

                        subscription = transaction_client.subscribe({ 'path' : "/", },
                            function(path, iface, signal, args) {
                                if (signal == "DownloadProgress") {
                                    var line = build_progress_line(args);
                                    if (line)
                                        dp.notify(line);
                                } else if (signal == "Message") {
                                    dp.notify(args[0]);
                                } else if (signal == "Finished") {
                                    if (args) {
                                        if (args[0]) {
                                            dp.resolve(args[1]);
                                            cleanup();
                                        } else {
                                            fail(args[1]);
                                        }
                                    } else {
                                        console.warn("Unexpected transaction response", args);
                                        fail({ "problem": "protocol-error" });
                                    }
                                }
                            });
                        transaction_client.call("/", TRANSACTION, "Start");
                    });
            });

        return dp.promise();
    };
}

/* singleton client instance */
module.exports = new RPMOSTreeDBusClient();
