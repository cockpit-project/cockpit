define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {
    var module = { };

    function MachineData(results, old_map) {
        var self = this;

        var ready = false;

        /* echo channels to each machine */
        var channels = { };

        /* hostnamed proxies to each machine, if hostnamed available */
        var proxies = { };

        var defaults = "{ \"localhost\": { \"visible\": true } }";

        /* parsed machine data */
        var machines = { };

        /* populate with previous data if any */
        function fill_machines(old_map) {
            var k;
            for (k in old_map) {
                machines[k] = old_map[k];
                ready = true;
            }
        }

        if (old_map)
            fill_machines(old_map);

        /* machines.json and file content */
        var waits = $.Callbacks("once memory");
        self.file = cockpit.file("/var/lib/cockpit/machines.json", { syntax: JSON });
        self.content = { };
        self.tag = null;

        self.file.watch(function(data, tag, ex) {
            if (ex)
                console.warn("couldn't load machines data: " + ex);

            self.content = data || JSON.parse(defaults);
            self.tag = tag;

            var host;
            for (host in self.content)
                update(host);

            /* Remove any lost hosts */
            for (host in machines) {
                if (!(host in self.content))
                    remove(host);
            }

            ready = true;
            notify();

            waits.fire();
            old_map = null;
        });

        function notify(host) {
            if (!ready)
                return;

            if (host) {
                var machine = machines[host];
                if (machine)
                    machine.version++;
            }

            results({
                machines: machines,     /* map of all machines */
            });
        }

        function state(host, value, problem) {
            var machine = machines[host];
            if (machine) {
                if (value == "connected")
                    machine.restarting = false;

                machine.state = value;
                machine.problem = problem;
                notify(host);
            }
        }

        self.connect = function connect(host, force) {
            var channel = channels[host];
            if (channel && force)
                self.disconnect(host);
            if (channel)
                return;

            channel = cockpit.channel({ host: host, payload: "echo" });
            channels[host] = channel;

            /* So we get back a message once connected */
            channel.send("x");

            $(channel)
                .on("message", function() {
                    state(host, "connected", null);
                })
                .on("close", function(options) {
                    var problem = options.problem || "disconnected";
                    var machine = machines[host];
                    state(host, "failed", problem);
                    if (machine && machine.restarting) {
                        var timer = window.setTimeout(function() {
                            self.connect(host);
                        }, 15000);
                    }

                    self.disconnect(host);
                });

            state(host, "connecting", null);

            var proxy = cockpit.dbus("org.freedesktop.hostname1", { host: host }).proxy();
            proxy.wait(function() {
                proxies[host] = proxy;
                $(proxy).on("changed", function() {
                     update(host);
                });
                update(host);
            });
        };

        self.disconnect = function disconnect(host) {
            var channel = channels[host];
            delete channels[host];
            if (channel) {
                $(channel).off();
                channel.close();
            }

            var proxy = proxies[host];
            delete proxies[host];
            if (proxy) {
                $(proxy).off();
                proxy.client.close();
            }
        };

        function update(host) {
            var machine = machines[host];

            if (!machine) {
                machine = machines[host] = { key: host, version: 0 };
            }

            var item = self.content[host] || { };
            var props = proxies[host] || { };

            machine.address = item.address || host;
            machine.color = item.color;
            machine.avatar = item.avatar || "images/server-small.png";
            machine.visible = item.visible;

            var label = props.PrettyHostname || props.StaticHostname || item.label || machine.address;
            machine.os = props.OperatingSystemPrettyName;

            if (!label || label == "localhost" || label == "localhost.localdomain")
                label = window.location.hostname;

            machine.label = label;
            notify(host);

            /* Don't automatically reconnect failed machines */
            if (machine.visible && (!machine.problem || machine.restarting))
                self.connect(host);
            else
                self.disconnect(host);
        }

        function remove(host) {
            var machine = machines[host];
            if (machine) {
                delete machines[host];
                self.disconnect(host);
                notify(host);
            }
        }

        self.expect_restart = function expect_restart(host) {
            function reconnect () {
                machine.restarting = true;
                var timer = window.setTimeout(function() {
                    self.connect(host);
                }, 1000);
            }

            var machine = machines[host];
            if (machine) {

                var channel = channels[host];
                if (channel)
                    $(channel).on("close", reconnect);
                else
                    reconnect ();
            }
        };

        self.close = function close() {
            if (self.file) {
                self.file.close();
                self.file = null;
            }

            var hosts = Object.keys(channels);
            hosts.forEach(self.disconnect);
        };

        self.modify_when_ready = function modify_when_ready(mutate) {
            var dfd = $.Deferred();
            waits.add(function() {
                if (self.file) {
                    self.file.modify(mutate, self.content, self.tag)
                        .done(function (c, t) {
                            dfd.resolve(c, t);
                        }).
                        fail(function (e) {
                            dfd.reject(e);
                        });
                } else {
                    dfd.reject("file closed");
                }
            });
            return dfd.promise();
        };
    }

    function Machines() {
        var self = this;
        var flat = null;
        var map = { };
        var ready = false;
        var data = null;
        var versions = {};

        /* Invoked by cockpit.cache() to get new data */
        function provider(result) {
            data = new MachineData(result, map);
            return data;
        }

        /* Invoked by cockpit.cache() when data is available, changes */
        function consumer(data, storage_key) {
            flat = null;

            var key;
            if (!ready) {
                map = data.machines;
                ready = true;
                for (key in map)
                    ensure_machine_color(map[key]);
                for (key in map)
                    $(self).triggerHandler("added", map[key]);
                $(self).triggerHandler('ready');
                return;
            }

            var host;
            for (host in data.machines) {
                var machine = data.machines[host];
                var old = versions[host];

                if (!old || machine.version != old) {
                    ensure(host, machine);
                }
            }

            for (host in versions) {
                if (!data.machines[host]) {
                    delete versions[host];
                    $(self).triggerHandler("removed", host);
                }
            }
        }

        var cache = cockpit.cache("v1-machines.json", provider, consumer);

        function ensure(key, item) {
            var created = !versions[key];
            map[key] = item;
            versions[key] = item.version;

            if (ready) {
                ensure_machine_color(item);
                $(self).triggerHandler(created ? "added" : "changed", item);
            }

            return item;
        }

        function color_in_use(color) {
            var key, machine, norm = $.color.parse(color).toString();
            for (key in map) {
                machine = map[key];
                if (machine.color && $.color.parse(machine.color).toString() == norm)
                    return true;
            }
            return false;
        }

        function ensure_machine_color(machine) {
            if (machine.color)
                return;

            var color = "gray";
            var i, length = module.colors.length;
            for (i = 0; i < length; i++) {
                if (!color_in_use(module.colors[i])) {
                    color = module.colors[i];
                    break;
                }
            }

            machine.color = color;
            self.change(machine.key, { color: color })
                .fail(function(ex) {
                    console.warn("couldn't set machine color: " + ex);
                });
        }

        function modify(key, values) {
            function mutate(data) {
                var item = data[key];
                if (!item)
                    item = data[key] = { };
                for (var i in values)
                    item[i] = values[i];
                return data;
            }

            /* Make us authorititative data source */
            cache.claim();
            return data.modify_when_ready(mutate);
        }

        Object.defineProperty(self, "list", {
            enumerable: true,
            get: function get() {
                var key;
                if (!flat) {
                    flat = [];
                    for (key in map) {
                        if (map[key].visible)
                            flat.push(map[key]);
                    }
                    flat.sort(function(m1, m2) {
                        return m2.label.localeCompare(m2.label);
                    });
                }
                return flat;
            }
        });

        Object.defineProperty(self, "addresses", {
            enumerable: true,
            get: function get() {
                return Object.keys(map);
            }
        });

        self.lookup = function lookup(address) {
            return map[address || "localhost"] || null;
        };

        self.add = function add(address, host_key) {
            var dfd = $.Deferred();

            var item = { address: address, visible: true };
            var json = modify(address, item);

            var known_hosts = cockpit.file("/var/lib/cockpit/known_hosts");
            var append = known_hosts.modify(function(data) {
                return data + "\n" + host_key;
            });

            append.always(function() {
                known_hosts.close();
            });

            $.when(json, append)
                .done(function(e, t) {
                    dfd.resolve(address);
                })
                .fail(function(ex) {
                    dfd.reject(ex);
                });

            return dfd.promise();
        };

        self.change = function change(key, values) {
            var mod, hostnamed, call;
            if (values.label) {
                hostnamed = cockpit.dbus("org.freedesktop.hostname1", { host: key });
                call = hostnamed.call("/org/freedesktop/hostname1", "org.freedesktop.hostname1",
                               "SetPrettyHostname", [ values.label, true ])
                    .always(function() {
                        hostnamed.close();
                    })
                    .fail(function(ex) {
                        console.warn("couldn't set pretty host name: " + ex);
                    });
            }
            mod = modify(key, values);
            if (call)
                return $.when(call, mod);
            return mod;
        };

        self.connect = function connect(key) {
            cache.claim();
            data.connect(key);
        };

        self.disconnect = function disconnect(key) {
            cache.claim();
            data.disconnect(key);
        };

        self.close = function close() {
            cache.close();
        };

        self.expect_restart = function (host) {
            cache.claim();
            data.expect_restart(host);
        };
    }

    module.instance = function instance() {
        return new Machines();
    };

    module.colors = [
        "#0099d3",
        "#67d300",
        "#d39e00",
        "#d3007c",
        "#00d39f",
        "#00d1d3",
        "#00618a",
        "#4c8a00",
        "#8a6600",
        "#9b005b",
        "#008a55",
        "#008a8a",
        "#00b9ff",
        "#7dff00",
        "#ffbe00",
        "#ff0096",
        "#00ffc0",
        "#00fdff",
        "#023448",
        "#264802",
        "#483602",
        "#590034",
        "#024830",
        "#024848"
    ];

    return module;
});
