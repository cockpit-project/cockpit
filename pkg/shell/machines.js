define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {
    var module = { };

    function Machine(machines) {
        var self = this;
        var proxy = null;
        var hostnamed = null;
        var channel = null;

        self.state = null;

        function change_state(value, problem) {
            self.state = value;
            self.problem = problem;
            $(machines).triggerHandler("changed", self);
        }

        function disconnect() {
            $(channel).off();
            channel.close();
            channel = null;

            if (hostnamed) {
                $(hostnamed).off();
                hostnamed.client.close();
                hostnamed = null;
            }
        }

        self.connect = function connect(force) {
            if (channel && force)
                disconnect();
            if (channel)
                return;

            if (!self.address) {
                change_state("failed", "no-host");
                return;
            }

            channel = cockpit.channel({ host: self.address, payload: "echo" });
            $(channel)
                .on("message", function() {
                    change_state("connected", null);
                })
                .on("close", function(options) {
                    var problem = options.problem || "disconnected";
                    change_state("failed", problem);
                    disconnect();
                });

            /* So we get back a message once connected */
            channel.send("x");

            hostnamed = cockpit.dbus("org.freedesktop.hostname1", { host: self.address }).proxy();
            $(hostnamed).on("changed", function() {
                if (calculate_label())
                    $(machines).triggerHandler("changed", self);
            });

            change_state("connecting", null);
        };

        function calculate_label() {
            var label;
            if (proxy)
                label = proxy.Name || proxy.Address;
            if (hostnamed)
                label = hostnamed.PrettyHostname || hostnamed.StaticHostname || label;
            if (!label || label == "localhost" || label == "localhost.localdomain")
                label = window.location.hostname;
            if (self.label === label)
                return false;
            self.label = label;
            return true;
        }

        self.update = function update(prox) {
            proxy = prox;
            self.address = proxy.Address;
            self.color = proxy.Color;
            self.avatar = proxy.Avatar || "images/server-small.png";
            self.visible = proxy.Tags.indexOf("dashboard") !== -1;
            calculate_label();
        };

        self.change = function change(values) {
            var res = [];
            if (values.visible === true)
                res.push(proxy.AddTag("dashboard"));
            else if (values.visible === false)
                res.push(proxy.RemoveTag("dashboard"));
            if (values.avatar)
                res.push(proxy.SetAvatar(values.avatar));
            if (values.color)
                res.push(proxy.SetColor(values.color));
            if (values.label) {
                res.push(proxy.SetName(values.label));
                if (hostnamed && hostnamed.valid) {
                    hostnamed.SetPrettyHostname(values.label, true)
                        .fail(function(ex) {
                            console.warn("couldn't set pretty host name: " + ex);
                        });
                }
            }
            return $.when.apply($, res);
        };

        self.close = function close() {
            if (channel)
                disconnect();
        };
    }

    function Machines() {
        var self = this;
        var flat = null;
        var map = { };
        var ready = false;

        /* TODO: This should be migrated away from cockpitd */

        var client = cockpit.dbus("com.redhat.Cockpit", { bus: "session", track: true });
        var proxies = client.proxies("com.redhat.Cockpit.Machine", "/com/redhat/Cockpit/Machines");

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
            machine.change({ color: color })
                .fail(function(ex) {
                    console.warn("couldn't set machine color: " + ex);
                });
        }

        proxies.wait(function() {
            var key;
            ready = true;
            for (key in map)
                ensure_machine_color(map[key]);
            for (key in map)
                $(self).triggerHandler("added", map[key]);
        });

        $(proxies).on('added changed', function(ev, proxy) {
            var machine = map[proxy.Address];
            if (!machine)
                machine = new Machine(self);
            machine.update(proxy);
            map[proxy.Address] = machine;
            flat = null;
            if (ready) {
                ensure_machine_color(machine);
                $(self).triggerHandler(ev.type, machine);
            }
        });

        $(proxies).on('removed', function(ev, proxy) {
            var machine = map[proxy.Address];
            delete map[proxy.Address];
            flat = null;
            machine.close();
            $(self).triggerHandler('removed', machine);
        });

        proxies.wait(function() {
            flat = null;
            $(self).triggerHandler('ready');
        });

        Object.defineProperty(self, "list", {
            enumerable: true,
            get: function get() {
                if (!flat) {
                    flat = [];
                    for (var key in map) {
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
            client.call("/com/redhat/Cockpit/Machines",
                        "com.redhat.Cockpit.Machines",
                        "Add", [address, host_key])
                .done(function(out) {
                    var path = out[0];
                    var proxy = proxies[path];
                    dfd.resolve(map[proxy.Address]);
                })
                .fail(function(ex) {
                    dfd.reject(ex);
                });
            return dfd.promise();
        };

        self.close = function close() {
            if (proxies)
                $(proxies).off();
            if (client)
                client.close();
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
