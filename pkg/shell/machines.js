define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {
    var module = { };

    function Machine(key, modify, machines) {
        var self = this;
        var hostnamed = null;
        var channel = null;
        var json_label = null;

        self.key = key;
        self.state = null;
        self.problem = null;

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
            var label = json_label || self.address;
            if (hostnamed)
                label = hostnamed.PrettyHostname || hostnamed.StaticHostname || label;
            if (!label || label == "localhost" || label == "localhost.localdomain")
                label = window.location.hostname;
            if (self.label === label)
                return false;
            self.label = label;
            return true;
        }

        self.update = function update(item) {
            self.address = item.address || key;
            json_label = item.label;
            self.color = item.color;
            self.avatar = item.avatar || "images/server-small.png";
            self.visible = item.visible;
            calculate_label();
        };

        self.change = function change(values) {
            if (values.label && hostnamed && hostnamed.valid) {
                hostnamed.SetPrettyHostname(values.label, true)
                    .fail(function(ex) {
                        console.warn("couldn't set pretty host name: " + ex);
                    });
            }
            return modify(key, values);
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

        var content = null;
        var tag = null;

        var defaults = "{ \"localhost\": { \"visible\": true } }";

        var file = cockpit.file("/var/lib/cockpit/machines.json", { syntax: JSON });
        file.watch(function(data, tag, ex) {
            if (ex)
                console.warn("couldn't load machines data: " + ex);
            update(data, tag);
        });

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

        function ensure(key, item) {
            var machine = map[key];
            var created = !machine;
            flat = null;
            if (!machine)
                machine = new Machine(key, modify, self);
            machine.update(item);
            map[key] = machine;

            if (ready) {
                ensure_machine_color(machine);
                $(self).triggerHandler(created ? "added" : "changed", machine);
            }

            return machine;
        }

        function update(data, new_tag) {
            content = data || JSON.parse(defaults);
            tag = new_tag;
            flat = null;

            var key;
            var seen = { };
            for (key in map)
                seen[key] = key;

            for (key in content) {
                ensure(key, content[key]);
                delete seen[key];
            }

            var machine;
            for (key in seen) {
                machine = map[key];
                delete map[key];
                machine.close();
                $(self).triggerHandler("removed", machine);
            }

            if (!ready) {
                ready = true;
                for (key in map)
                    ensure_machine_color(map[key]);
                for (key in map)
                    $(self).triggerHandler("added", map[key]);
                $(self).triggerHandler('ready');
            }
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
            return file.modify(mutate, content, tag);
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
                .done(function() {
                    dfd.resolve(ensure(address, item));
                })
                .fail(function(ex) {
                    dfd.reject(ex);
                });

            return dfd.promise();
        };

        self.close = function close() {
            file.close();
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
