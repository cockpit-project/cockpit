define([
    "jquery",
    "base1/cockpit",
    "manifests",
], function($, cockpit, local_manifests) {
    var module = { };

    /* machines.json path */
    var path = "/var/lib/cockpit/machines.json";

    /*
     * We share the Machines state between multiple frames. Only
     * one frame has the job of loading the state, usually index.js
     * The Loader code below does all the loading.
     *
     * The data is stored in sessionStorage in a JSON object, like this
     * {
     *    content: parsed contents of machines.json
     *    tag: the cockpit.file() tag
     *    overlay: extra data to augment and override on top of content
     * }
     *
     * This is the sessionStorage key at which the data is placed.
     */
    var key = "v2-machines.json";

    function Machines() {
        var self = this;

        var flat = null;
        var ready = false;

        /* parsed machine data */
        var machines = { };

        /* Data shared between Machines() instances */
        var last = {
            content: null,
            tag: null,
            overlay: {
                localhost: {
                    visible: true,
                    manifests: local_manifests
                }
            }
        };

        function storage(ev) {
            if (ev.key === key && ev.storageArea === window.sessionStorage)
                refresh(JSON.parse(ev.newValue));
        }

        window.addEventListener("storage", storage);

        window.setTimeout(function() {
            var value = window.sessionStorage.getItem(key);
            if (!ready && value)
                refresh(JSON.parse(value));
        });

        var timeout = null;

        function sync(machine, values, overlay) {
            var desired = $.extend({ }, values || { }, overlay || { });
            var prop, value;
            for (prop in desired) {
                if (machine[prop] !== desired[prop])
                    machine[prop] = desired[prop];
            }
            for (prop in machine) {
                if (machine[prop] !== desired[prop])
                    delete machine[prop];
            }
            return machine;
        }

        function refresh(shared, push) {
            var emit_ready = !ready;

            ready = true;
            last = shared;
            flat = null;

            if (push && !timeout) {
                timeout = window.setTimeout(function() {
                    timeout = null;
                    window.sessionStorage.setItem(key, JSON.stringify(last));
                }, 10);
            }

            var host, hosts = { };
            var content = shared.content || { };
            var overlay = shared.overlay || { };
            for (host in content)
                hosts[host] = true;
            for (host in overlay)
                hosts[host] = true;

            var events = [];

            var machine;
            for (host in hosts) {
                machine = sync(machines[host] || { }, content[host], overlay[host]);

                /* Fill in defaults */
                machine.key = host;
                if (!machine.address)
                    machine.address = host;
                if (!machine.label) {
                    if (host == "localhost" || host == "localhost.localdomain")
                        machine.label = window.location.hostname;
                    else
                        machine.label = host;
                }
                if (!machine.avatar)
                    machine.avatar = "../shell/images/server-small.png";

                events.push([host in machines ? "updated" : "added", [machine, host]]);
                machines[host] = machine;
            }

            /* Remove any lost hosts */
            for (host in machines) {
                if (!(host in hosts)) {
                    machine = machines[host];
                    delete machines[host];
                    events.push(["removed", [machine, host]]);
                }
            }

            /* Fire off all events */
            var i, sel = $(self), len = events.length;
            for (i = 0; i < len; i++)
                sel.triggerHandler(events[i][0], events[i][1]);
            if (emit_ready)
                $(self).triggerHandler("ready");
        }

        self.add = function add(address, host_key) {
            var dfd = $.Deferred();

            function add_to_machines() {
                var values = {
                    address: address,
                    visible: true,
                    color: self.unused_color()
                };

                self.change(address, values)
                    .done(function() {
                        dfd.resolve(address);
                    })
                    .fail(function(ex) {
                        dfd.reject(ex);
                    });
            }

            if (host_key) {
                var known_hosts = cockpit.file("/var/lib/cockpit/known_hosts");
                known_hosts
                    .modify(function(data) {
                        return data + "\n" + host_key;
                    })
                    .done(add_to_machines)
                    .fail(function(ex) {
                        dfd.reject(ex);
                    })
                    .always(function() {
                        known_hosts.close();
                    });
            } else {
                add_to_machines();
            }

            return dfd.promise();
        };

        self.unused_color = function unused_color() {
            var i, len = module.colors.length;
            for (i = 0; i < len; i++) {
                if (!color_in_use(module.colors[i]))
                    return module.colors[i];
            }
            return "gray";
        };

        function color_in_use(color) {
            var key, machine, norm = $.color.parse(color).toString();
            for (key in machines) {
                machine = machines[key];
                if (machine.color && $.color.parse(machine.color).toString() == norm)
                    return true;
            }
            return false;
        }

        function merge(item, values) {
            for (var prop in values) {
                if (values[prop] === null)
                    delete item[prop];
                else
                    item[prop] = values[prop];
            }
        }

        self.change = function change(host, values) {
            var hostnamed, call;
            if (values.label) {
                hostnamed = cockpit.dbus("org.freedesktop.hostname1", { host: host });
                call = hostnamed.call("/org/freedesktop/hostname1", "org.freedesktop.hostname1",
                                      "SetPrettyHostname", [ values.label, true ])
                    .always(function() {
                        hostnamed.close();
                    })
                    .fail(function(ex) {
                        console.warn("couldn't set pretty host name: " + ex);
                    });
            }

            function mutate(data) {
                if (!data)
                    data = { };
                var item = data[host];
                if (!item)
                    item = data[host] = { };
                merge(item, values);
                return data;
            }

            /* Update the JSON file */
            var local = cockpit.file(path, { syntax: JSON });
            var mod = local.modify(mutate, last.content, last.tag)
                .done(function(data, tag) {
                    var prop, over = { };
                    for (prop in values)
                        over[prop] = null;
                    self.data(data, tag); /* an optimization */
                    self.overlay(host, over);
                })
                .always(function() {
                    local.close();
                });

            if (call)
                return $.when(call, mod);

            return mod;
        };

        self.data = function data(content, tag) {
            refresh({ content: content, tag: tag, overlay: last.overlay }, true);
        };

        self.overlay = function overlay(host, values) {
            var changes = { };
            changes[host] = $.extend({ }, last.overlay[host] || { });
            merge(changes[host], values);
            refresh({
                content: last.content,
                tag: last.tag,
                overlay: $.extend({ }, last.overlay, changes)
            }, true);
        };

        Object.defineProperty(self, "list", {
            enumerable: true,
            get: function get() {
                var key;
                if (!flat) {
                    flat = [];
                    for (key in machines) {
                        if (machines[key].visible)
                            flat.push(machines[key]);
                    }
                    flat.sort(function(m1, m2) {
                        return m1.label.localeCompare(m2.label);
                    });
                }
                return flat;
            }
        });

        Object.defineProperty(self, "addresses", {
            enumerable: true,
            get: function get() {
                return Object.keys(machines);
            }
        });

        self.lookup = function lookup(address) {
            return machines[address || "localhost"] || null;
        };

        self.close = function close() {
            window.removeEventListener("storage", storage);
        };
    }

    function Loader(machines) {
        var self = this;

        /* File we are watching */
        var file;

        /* echo channels to each machine */
        var channels = { };

        /* hostnamed proxies to each machine, if hostnamed available */
        var proxies = { };

        file = cockpit.file(path, { syntax: JSON });
        file.watch(function(data, tag, ex) {
            if (ex)
                console.warn("couldn't load machines data: " + ex);
            machines.data(data, tag);
        });

        function state(host, value, problem) {
            var values = { state: value, problem: problem };
            if (value == "connected")
                values.restarting = false;
            else if (problem)
                values.manifests = null;
            machines.overlay(host, values);
        }

        $(machines).on("added", updated);
        $(machines).on("updated", updated);
        $(machines).on("removed", removed);

        function updated(ev, machine, host) {
            if (!machine) {
                machine = machines.lookup(host);
                if (!machine)
                    return;
            }

            var props = proxies[host];
            if (!props || !props.valid)
                props = { };

            var overlay = { };

            if (!machine.color)
                overlay.color = machines.unused_color();

            var label = props.PrettyHostname || props.StaticHostname;
            if (label && label !== machine.label)
                overlay.label = label;

            var os = props.OperatingSystemPrettyName;
            if (os && os != machine.os)
                overlay.os = props.OperatingSystemPrettyName;

            if (!$.isEmptyObject(overlay))
                machines.overlay(host, overlay);

            /* Don't automatically reconnect failed machines */
            if (machine.visible && (!machine.problem || machine.restarting))
                self.connect(host);
            else if (!machine.visible)
                self.disconnect(host);
        }

        function removed(ev, machine, host) {
            self.disconnect(host);
        }

        self.connect = function connect(host) {
            var machine = machines.lookup(host);
            if (!machine)
                return;

            var channel = channels[host];
            if (channel)
                return;

            channel = cockpit.channel({ host: host, payload: "echo" });
            channels[host] = channel;

            var local = host === "localhost";

            /* Request is null, and message is true when connected */
            var request = null;
            var open = local;

            function whirl() {
                if (!request && open)
                    state(host, "connected", null);
                else
                    state(host, "connecting", null);
            }

            var url;

            /* Here we load the machine manifests, and expect them before going to "connected" */
            if (!machine.manifests) {
                if (machine.checksum)
                    url = "../../" + machine.checksum + "/manifests.json";
                else
                    url = "../../@" + machine.address + "/manifests.json";
                request = $.ajax({ url: url, dataType: "json", cache: true})
                    .done(function(manifests) {
                        var overlay = { manifests: manifests };
                        var etag = request.getResponseHeader("ETag");
                        if (etag) /* and remove quotes */
                            overlay.checksum = etag.replace(/^"(.+)"$/, '$1');
                        machines.overlay(host, overlay);
                    })
                    .fail(function(ex) {
                        console.warn("failed to load manifests from " + machine.address + ": " + ex);
                    })
                    .always(function() {
                        request = null;
                        whirl();
                    });
            }

            /* Send a message to the server and get back a message once connected */
            if (!local) {
                channel.send("x");

                $(channel)
                    .on("message", function() {
                        open = true;
                        whirl();
                    })
                .on("close", function(ev, options) {
                    var problem = options.problem || "disconnected";
                    open = false;
                    state(host, "failed", problem);
                    var machine = machines[host];
                    if (machine && machine.restarting) {
                        window.setTimeout(function() {
                            self.connect(host);
                        }, 10000);
                    }
                    self.disconnect(host);
                });
            }

            var proxy = cockpit.dbus("org.freedesktop.hostname1", { host: host }).proxy();
            proxies[host] = proxy;
            proxy.wait(function() {
                $(proxy).on("changed", function() {
                    updated(null, null, host);
                });
                updated(null, null, host);
            });

            /* In case already ready, for example when local */
            whirl();
        };

        self.disconnect = function disconnect(host) {
            if (host === "localhost")
                return;

            var channel = channels[host];
            delete channels[host];
            if (channel) {
                channel.close();
                $(channel).off();
            }

            var proxy = proxies[host];
            delete proxies[host];
            if (proxy) {
                proxy.client.close();
                $(proxy).off();
            }
        };

        self.expect_restart = function expect_restart(host) {
            machines.overlay(host, { restarting: true });
        };

        self.close = function close() {
            $(machines).off("added", updated);
            $(machines).off("changed", updated);
            $(machines).off("removed", removed);
            machines = null;

            if (file)
                file.close();
            file = null;

            var hosts = Object.keys(channels);
            hosts.forEach(self.disconnect);
        };
    }

    module.instance = function instance(loader) {
        return new Machines();
    };

    module.loader = function loader(machines) {
        return new Loader(machines);
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
