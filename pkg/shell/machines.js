define([
    "jquery",
    "base1/cockpit",
    "manifests",
], function($, cockpit, local_manifests) {
    var module = { };

    /* machines.json path */
    var path = "/var/lib/cockpit/machines.json";
    var known_hosts_path = "/var/lib/cockpit/known_hosts";
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
                var old_machine = machines[host] || { };
                var old_conns = old_machine.connection_string;

                /* Invert logic for color, always respect what's on disk */
                if (content[host] && content[host].color && overlay[host])
                    delete overlay[host].color;

                machine = sync(old_machine, content[host], overlay[host]);

                /* Fill in defaults */
                machine.key = host;
                if (!machine.address)
                    machine.address = host;

                machine.connection_string = self.generate_connection_string(machine.user,
                                                                            machine.port,
                                                                            machine.address);

                if (!machine.label) {
                    if (host == "localhost" || host == "localhost.localdomain")
                        machine.label = window.location.hostname;
                    else
                        machine.label = host;
                }
                if (!machine.avatar)
                    machine.avatar = "../shell/images/server-small.png";

                events.push([host in machines ? "updated" : "added",
                            [machine, host, old_conns]]);
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


        self.add_key = function(host_key) {
            var known_hosts = cockpit.file(known_hosts_path, { superuser: "try" });
            return known_hosts
                .modify(function(data) {
                    return data + "\n" + host_key;
                })
                .always(function() {
                    known_hosts.close();
                });
        };

        self.add = function add(connection_string, color) {
            var values = self.split_connection_string(connection_string);
            return self.change(values['address'],
                               $.extend({
                                    visible: true,
                                    color: color || self.unused_color(),
                                }, values)
            );
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
            var machine = self.lookup(host);

            if (values.label) {

                var conn_to = host;
                if (machine)
                    conn_to = machine.connection_string;

                if (!machine || machine.label !== values.label) {
                    hostnamed = cockpit.dbus("org.freedesktop.hostname1", { host: conn_to });
                    call = hostnamed.call("/org/freedesktop/hostname1", "org.freedesktop.hostname1",
                                          "SetPrettyHostname", [ values.label, true ])
                        .always(function() {
                            hostnamed.close();
                        })
                        .fail(function(ex) {
                            console.warn("couldn't set pretty host name: " + ex);
                        });
                }
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
            var local = cockpit.file(path, { syntax: JSON, superuser: "try" });
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
            var parts = self.split_connection_string(address);
            return machines[parts.address || "localhost"] || null;
        };

        self.generate_connection_string = function (user, port, addr) {
            var address = addr;
            if (user)
                address = user + "@" + address;

            if (port)
                address = address + ":" + port;

            return address;
        };

        self.split_connection_string = function(conn_to) {
            var parts = {};
            var user_spot = -1;
            var port_spot = -1;

            if (conn_to) {
                user_spot = conn_to.lastIndexOf('@');
                port_spot = conn_to.lastIndexOf(':');
            }

            if (user_spot > 0) {
                parts.user = conn_to.substring(0, user_spot);
                conn_to = conn_to.substring(user_spot+1);
                port_spot = conn_to.lastIndexOf(':');
            }

            if (port_spot > -1) {
                var port = parseInt(conn_to.substring(port_spot+1));
                if (!isNaN(port)) {
                    parts.port = port;
                    conn_to = conn_to.substring(0, port_spot);
                }
            }

            parts.address = conn_to;
            return parts;
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
            if (value == "connected") {
                values.restarting = false;
            } else if (problem) {
                values.manifests = null;
                values.checksum = null;
            }
            machines.overlay(host, values);
        }

        $(machines).on("added", updated);
        $(machines).on("updated", updated);
        $(machines).on("removed", removed);

        function updated(ev, machine, host, old_conns) {
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
            if (machine.visible) {
                if (old_conns && machine.connection_string != old_conns) {
                    cockpit.kill(old_conns);
                    self.disconnect(host);
                    self.connect(host);
                } else if (!machine.problem) {
                    self.connect(host);
                }
            } else {
                self.disconnect(host);
            }
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

            channel = cockpit.channel({ host: machine.connection_string,
                                        payload: "echo" });
            channels[host] = channel;

            var local = host === "localhost";

            /* Request is null, and message is true when connected */
            var request = null;
            var open = local;
            var problem = null;

            function whirl() {
                if (!request && open)
                    state(host, "connected", null);
                else if (!problem)
                    state(host, "connecting", null);
            }

            var url;

            /* Here we load the machine manifests, and expect them before going to "connected" */
            if (!machine.manifests) {
                if (machine.checksum)
                    url = "../../" + machine.checksum + "/manifests.json";
                else
                    url = "../../@" + encodeURI(machine.connection_string) + "/manifests.json";
                request = $.ajax({ url: url, dataType: "json", cache: true})
                    .done(function(manifests) {
                        var overlay = { manifests: manifests };
                        var etag = request.getResponseHeader("ETag");
                        if (etag) /* and remove quotes */
                            overlay.checksum = etag.replace(/^"(.+)"$/, '$1');
                        machines.overlay(host, overlay);
                    })
                    .fail(function(ex) {
                        console.warn("failed to load manifests from " + machine.connection_string + ": " + ex);
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
                    problem = options.problem || "disconnected";
                    open = false;
                    state(host, "failed", problem);
                    var m = machines.lookup(host);
                    if (m && m.restarting) {
                        window.setTimeout(function() {
                            self.connect(host);
                        }, 10000);
                    }
                    self.disconnect(host);
                });
            }

            var proxy = cockpit.dbus("org.freedesktop.hostname1",
                                     { host: machine.connection_string }).proxy();
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
            var parts = machines.split_connection_string(host);
            machines.overlay(parts.address, { restarting: true,
                                              problem: null });
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

    module.known_hosts_path = known_hosts_path;

    cockpit.transport.wait(function() {
        var caps = cockpit.transport.options.capabilities || [];
        module.allow_connection_string = $.inArray("connection-string", caps) != -1;
        module.has_auth_results = $.inArray("auth-method-results", caps) != -1;
    });

    return module;
});
