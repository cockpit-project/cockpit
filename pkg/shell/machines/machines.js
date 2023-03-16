import cockpit from "cockpit";

import ssh_add_key_sh from "./ssh-add-key.sh";

const mod = { };

/*
 * We share the Machines state between multiple frames. Only
 * one frame has the job of loading the state, usually index.js
 * The Loader code below does all the loading.
 *
 * The data is stored in sessionStorage in a JSON object, like this
 * {
 *    content: name → info dict from bridge's /machines Machines property
 *    overlay: extra data to augment and override on top of content
 * }
 *
 * This uses sessionStorage rather than cockpit.sessionStorage
 * because we don't ever want to write unprefixed keys.
 */

const key = cockpit.sessionStorage.prefixedKey("v2-machines.json");
const session_prefix = cockpit.sessionStorage.prefixedKey("v1-session-machine");

function generate_session_key(host) {
    return session_prefix + "/" + host;
}

export function host_superuser_storage_key(host) {
    if (!host)
        host = cockpit.transport.host;

    const local_key = window.localStorage.getItem("superuser-key");
    if (host == "localhost")
        return local_key;
    else if (host.indexOf("@") >= 0)
        return "superuser:" + host;
    else if (local_key)
        return local_key + "@" + host;
    else
        return null;
}

export function get_init_superuser_for_options(options) {
    let value = null;
    const key = host_superuser_storage_key(options.host);
    if (key)
        value = window.localStorage.getItem(key);

    /* When connecting, we can optionally try to start a privileged
     * bridge immediately.  However, it is quite likely that that
     * needs a password and if we don't have one, it will likely fail.
     * That would be okay, but sudo is very noisy about failures and
     * might send nasty emails to your parents.  For that reason we
     * pass "init-superuser": "none" here when there is no password.
     *
     * The downside is that if sudo is configured to not require a
     * password, we could start it successfully immediately as part
     * of the connection process, which would be convenient.  However,
     * if sudo works without password, gaining admin privs is just a
     * single click, and the convenience loss is not that of a big deal,
     * hopefully.
     */

    if (value == "sudo" && !options.password)
        value = "none";

    return value;
}

function Machines() {
    const self = this;

    cockpit.event_target(self);

    let flat = null;
    self.ready = false;

    /* parsed machine data */
    const machines = { };

    /* Data shared between Machines() instances */
    let last = {
        content: null,
        overlay: {
            localhost: {
                visible: true,
                manifests: cockpit.manifests
            }
        }
    };

    function storage(ev) {
        if (ev.key === key && ev.storageArea === window.sessionStorage)
            refresh(JSON.parse(ev.newValue || "null"));
    }

    window.addEventListener("storage", storage);

    window.setTimeout(function() {
        const value = window.sessionStorage.getItem(key);
        if (!self.ready && value)
            refresh(JSON.parse(value));
    });

    let timeout = null;

    function sync(machine, values, overlay) {
        const desired = { ...values, ...overlay };
        for (const prop in desired) {
            if (machine[prop] !== desired[prop])
                machine[prop] = desired[prop];
        }
        for (const prop in machine) {
            if (machine[prop] !== desired[prop])
                delete machine[prop];
        }
        return machine;
    }

    function refresh(shared, push) {
        if (!shared)
            return;

        last = shared;
        flat = null;

        if (push && !timeout) {
            timeout = window.setTimeout(function() {
                timeout = null;
                window.sessionStorage.setItem(key, JSON.stringify(last));
            }, 10);
        }

        const hosts = { };
        const content = shared.content || { };
        const overlay = shared.overlay || { };
        for (const host in content)
            hosts[host] = true;
        for (const host in overlay)
            hosts[host] = true;

        const events = [];

        for (const host in hosts) {
            const old_machine = machines[host] || { };
            const old_conns = old_machine.connection_string;

            /* Invert logic for color, always respect what's on disk */
            if (content[host] && content[host].color && overlay[host])
                delete overlay[host].color;

            const machine = sync(old_machine, content[host], overlay[host]);

            /* Fill in defaults */
            machine.key = host;
            if (!machine.address)
                machine.address = host;

            machine.connection_string = self.generate_connection_string(machine.user,
                                                                        machine.port,
                                                                        machine.address);

            if (!machine.label) {
                if (host == "localhost" || host == "localhost.localdomain") {
                    const application = cockpit.transport.application();
                    if (application.indexOf('cockpit+=') === 0)
                        machine.label = application.replace('cockpit+=', '');
                    else
                        machine.label = window.location.hostname;
                } else {
                    machine.label = host;
                }
            }
            if (!machine.avatar)
                machine.avatar = "../shell/images/server-small.png";

            events.push([host in machines ? "updated" : "added",
                [machine, host, old_conns]]);
            machines[host] = machine;
        }

        /* Remove any lost hosts */
        for (const host in machines) {
            if (!(host in hosts)) {
                const machine = machines[host];
                delete machines[host];
                delete overlay[host];
                events.push(["removed", [machine, host]]);
            }
        }

        /* Fire off all events */
        const len = events.length;
        for (let i = 0; i < len; i++) {
            self.dispatchEvent(events[i][0], ...events[i][1]);
        }
    }

    function update_session_machine(machine, host, values) {
        /* We don't save the whole machine object */
        const skey = generate_session_key(host);
        const data = { ...machine, ...values };
        window.sessionStorage.setItem(skey, JSON.stringify(data));
        self.overlay(host, values);
        return cockpit.when([]);
    }

    function update_saved_machine(host, values) {
        // wrap values in variants for D-Bus call; at least values.port can
        // be int or string, so stringify everything but the "visible" boolean
        const values_variant = {};
        for (const prop in values) {
            if (values[prop] !== null) {
                if (prop == "visible")
                    values_variant[prop] = cockpit.variant('b', values[prop]);
                else
                    values_variant[prop] = cockpit.variant('s', values[prop].toString());
            }
        }

        // FIXME: investigate re-using the proxy from Loader (runs in different frame/scope)
        const bridge = cockpit.dbus(null, { bus: "internal", superuser: "try" });
        const mod =
            bridge.call("/machines", "cockpit.Machines", "Update", ["99-webui.json", host, values_variant])
                    .catch(function(error) {
                        console.error("failed to call cockpit.Machines.Update(): ", error);
                    })
                    .then(() => {
                        self.overlay(host, values);
                    });

        return mod;
    }

    self.set_ready = function ready() {
        if (!self.ready) {
            self.ready = true;
            self.dispatchEvent("ready");
        }
    };

    self.add_key = function(host_key) {
        return cockpit.script(ssh_add_key_sh, [host_key.trim(), "known_hosts"], { err: "message" });
    };

    self.add = function add(connection_string, color) {
        let values = self.split_connection_string(connection_string);
        const host = values.address;

        values = {
            visible: true,
            color: color || self.unused_color(),
            ...values
        };

        const machine = self.lookup(host);
        if (machine)
            machine.on_disk = true;

        return self.change(values.address, values);
    };

    self.unused_color = function unused_color() {
        const len = mod.colors.length;
        for (let i = 0; i < len; i++) {
            if (!color_in_use(mod.colors[i]))
                return mod.colors[i];
        }
        return "gray";
    };

    function color_in_use(color) {
        const norm = mod.colors.parse(color);
        for (const key in machines) {
            const machine = machines[key];
            if (machine.color && mod.colors.parse(machine.color) == norm)
                return true;
        }
        return false;
    }

    function merge(item, values) {
        for (const prop in values) {
            if (values[prop] === null)
                delete item[prop];
            else
                item[prop] = values[prop];
        }
    }

    self.change = function change(host, values) {
        const machine = self.lookup(host);

        if (machine && !machine.on_disk)
            return update_session_machine(machine, host, values);
        else
            return update_saved_machine(host, values);
    };

    self.data = function data(content) {
        const changes = {};

        for (const host in content) {
            changes[host] = { ...last.overlay[host] };
            merge(changes[host], { on_disk: true });
        }

        /* It's a full reload, so data not
         * present is no longer from disk
         */
        for (const host in machines) {
            if (content && !content[host]) {
                changes[host] = { ...last.overlay[host] };
                merge(changes[host], { on_disk: null });
            }
        }

        refresh({
            content,
            overlay: { ...last.overlay, ...changes },
        }, true);
    };

    self.overlay = function overlay(host, values) {
        const address = self.split_connection_string(host).address;
        const changes = { };
        changes[address] = { ...last.overlay[address] };
        merge(changes[address], values);
        refresh({
            content: last.content,
            overlay: { ...last.overlay, ...changes }
        }, true);
    };

    Object.defineProperty(self, "list", {
        enumerable: true,
        get: function get() {
            if (!flat) {
                flat = [];
                for (const key in machines) {
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
        const parts = self.split_connection_string(address);
        return machines[parts.address || "localhost"] || null;
    };

    self.generate_connection_string = function (user, port, addr) {
        let address = addr;
        if (user)
            address = user + "@" + address;

        if (port)
            address = address + ":" + port;

        return address;
    };

    self.split_connection_string = function(conn_to) {
        const parts = {};
        let user_spot = -1;
        let port_spot = -1;

        if (conn_to) {
            user_spot = conn_to.lastIndexOf('@');
            port_spot = conn_to.lastIndexOf(':');
        }

        if (user_spot > 0) {
            parts.user = conn_to.substring(0, user_spot);
            conn_to = conn_to.substring(user_spot + 1);
            port_spot = conn_to.lastIndexOf(':');
        }

        if (port_spot > -1) {
            const port = parseInt(conn_to.substring(port_spot + 1), 10);
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

function Loader(machines, session_only) {
    const self = this;

    /* Have we loaded from cockpit session */
    let session_loaded = false;

    /* echo channels to each machine */
    const channels = { };
    const channels_listeners_message = { };
    const channels_listeners_close = { };

    /* hostnamed proxies to each machine, if hostnamed available */
    const proxies = { };
    const proxies_listeners_changed = { };

    /* clients for the bridge D-Bus API */
    const bridge_dbus = { };

    function process_session_key(key, value) {
        const parts = key.split("/");
        if (parts[0] == session_prefix &&
            parts.length === 2) {
            const host = parts[1];
            if (value) {
                const values = JSON.parse(value);
                const machine = machines.lookup(host);
                if (!machine || !machine.on_disk)
                    machines.overlay(host, values);
                else if (!machine.visible)
                    machines.change(host, { visible: true });
                self.connect(host);
            }
        }
    }

    function load_from_session_storage() {
        session_loaded = true;
        for (let i = 0; i < window.sessionStorage.length; i++) {
            const k = window.sessionStorage.key(i);
            process_session_key(k, window.sessionStorage.getItem(k));
        }
    }

    function process_session_machines(ev) {
        if (ev.storageArea === window.sessionStorage)
            process_session_key(ev.key || "", ev.newValue);
    }
    window.addEventListener("storage", process_session_machines);

    function state(host, value, problem) {
        const values = { state: value, problem };
        if (value == "connected") {
            values.restarting = false;
        } else if (problem) {
            values.manifests = null;
            values.checksum = null;
            if (problem == "authentication-failed" || problem == "authentication-not-supported")
                values.restarting = false;
        }
        machines.overlay(host, values);
    }

    machines.addEventListener("added", updated);
    machines.addEventListener("updated", updated);
    machines.addEventListener("removed", removed);

    function updated(ev, machine, host, old_conns) {
        if (!machine) {
            machine = machines.lookup(host);
            if (!machine)
                return;
        }

        let props = proxies[host];
        if (!props || !props.valid)
            props = { };

        const overlay = { };

        if (!machine.color)
            overlay.color = machines.unused_color();

        const label = props.PrettyHostname || props.StaticHostname || props.Hostname;
        if (label && label !== machine.label)
            overlay.label = label;

        const os = props.OperatingSystemPrettyName;
        if (os && os != machine.os)
            overlay.os = props.OperatingSystemPrettyName;

        if (Object.keys(overlay).length > 0)
            machines.overlay(host, overlay);

        /* Don't automatically reconnect failed machines, and don't
         * automatically connect to new machines.  The navigation will
         * explicitly connect as necessary.
         */
        if (machine.visible) {
            if (old_conns && machine.connection_string != old_conns) {
                cockpit.kill(old_conns);
                self.disconnect(host);
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
        const machine = machines.lookup(host);
        if (!machine)
            return;

        let channel = channels[host];
        if (channel)
            return;

        const options = {
            host: machine.connection_string,
            payload: "echo",
        };

        options["init-superuser"] = get_init_superuser_for_options(options);

        if (!machine.on_disk && machine.host_key) {
            options['temp-session'] = false; /* Compatibility option */
            options.session = 'shared';
            options['host-key'] = machine.host_key;
        }

        channel = cockpit.channel(options);
        channels[host] = channel;

        const local = host === "localhost";

        /* Request is null, and message is true when connected */
        let request = null;
        let open = local;

        let url;
        if (!machine.manifests) {
            if (machine.checksum)
                url = "../../" + machine.checksum + "/manifests.json";
            else
                url = "../../@" + encodeURI(machine.connection_string) + "/manifests.json";
        }

        function whirl() {
            if (!request && open)
                state(host, "connected", null);
            else
                state(host, "connecting", null);
        }

        /* Here we load the machine manifests, and expect them before going to "connected" */
        function request_manifest() {
            request = new XMLHttpRequest();
            request.responseType = "json";
            request.open("GET", url, true);
            request.addEventListener("load", () => {
                const overlay = { manifests: request.response };
                const etag = request.getResponseHeader("ETag");
                if (etag) /* and remove quotes */
                    overlay.checksum = etag.replace(/^"(.+)"$/, '$1');
                machines.overlay(host, overlay);

                request = null;
                whirl();
            });
            request.addEventListener("error", () => {
                console.warn("failed to load manifests from " + machine.connection_string);
                request = null;
                whirl();
            });
            request.send();
        }

        /* Try to get change notifications via the internal
           /packages D-Bus interface of the bridge.  Not all
           bridges support this API, so we still get the first
           version of the manifests via HTTP in request_manifest.
        */

        function watch_manifests() {
            const dbus = cockpit.dbus(null, {
                bus: "internal",
                host: machine.connection_string
            });
            bridge_dbus[host] = dbus;
            dbus.subscribe({
                path: "/packages",
                interface: "org.freedesktop.DBus.Properties",
                member: "PropertiesChanged"
            },
                           function (path, iface, mamber, args) {
                               if (args[0] == "cockpit.Packages") {
                                   if (args[1].Manifests) {
                                       const manifests = JSON.parse(args[1].Manifests.v);
                                       machines.overlay(host, { manifests });
                                   }
                               }
                           });

            /* Tell the bridge to reload the packages, but only if
               it hasn't just started.  Thus, nothing happens on
               the first login, but if you reload the shell, we
               will also reload the packages.
            */
            dbus.call("/packages", "cockpit.Packages", "ReloadHint", []);
        }

        function request_hostname() {
            if (!machine.static_hostname) {
                const proxy = cockpit.dbus("org.freedesktop.hostname1",
                                           { host: machine.connection_string }).proxy();
                proxies[host] = proxy;
                proxy.wait(function() {
                    proxies_listeners_changed[host] = () => updated(null, null, host);
                    proxy.addEventListener("changed", proxies_listeners_changed[host]);
                    updated(null, null, host);
                });
            }
        }

        /* Send a message to the server and get back a message once connected */
        if (!local) {
            channel.send("x");

            channels_listeners_message[host] = () => {
                open = true;
                if (url)
                    request_manifest();
                watch_manifests();
                request_hostname();
                whirl();
            };
            channel.addEventListener("message", channels_listeners_message[host]);

            channels_listeners_close[host] = (ev, options) => {
                const m = machines.lookup(host);
                open = false;
                // reset to clean state when removing machine (orderly disconnect), otherwise mark as failed
                if (!options.problem && m && !m.visible)
                    state(host, null, null);
                else
                    state(host, "failed", options.problem || "disconnected");
                if (m && m.restarting) {
                    window.setTimeout(function() {
                        self.connect(host);
                    }, 10000);
                }
                self.disconnect(host);
            };
            channel.addEventListener("close", channels_listeners_close[host]);
        } else {
            if (url)
                request_manifest();
            watch_manifests();
            request_hostname();
        }

        /* In case already ready, for example when local */
        whirl();
    };

    self.disconnect = function disconnect(host) {
        if (host === "localhost")
            return;

        const channel = channels[host];
        delete channels[host];
        if (channel) {
            channel.close();
            channel.removeEventListener("message", channels_listeners_message[host]);
            channel.removeEventListener("close", channels_listeners_close[host]);
        }

        const proxy = proxies[host];
        delete proxies[host];
        if (proxy) {
            proxy.client.close();
            proxy.removeEventListener("changed", proxies_listeners_changed[host]);
        }

        const dbus = bridge_dbus[host];
        delete bridge_dbus[host];
        if (dbus) {
            dbus.close();
        }
    };

    self.expect_restart = function expect_restart(host) {
        const parts = machines.split_connection_string(host);
        machines.overlay(parts.address, {
            restarting: true,
            problem: null
        });
    };

    self.close = function close() {
        machines.removeEventListener("added", updated);
        machines.removeEventListener("changed", updated);
        machines.removeEventListener("removed", removed);
        machines = null;

        window.removeEventListener("storage", process_session_machines);
        const hosts = Object.keys(channels);
        hosts.forEach(self.disconnect);
    };

    if (!session_only) {
        const proxy = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Machines", "/machines");
        proxy.addEventListener("changed", data => {
            // unwrap variants from D-Bus call
            const wrapped = proxy.Machines;
            const data_unwrap = {};
            for (const host in wrapped) {
                const host_props = {};
                for (const prop in wrapped[host])
                    host_props[prop] = wrapped[host][prop].v;
                data_unwrap[host] = host_props;
            }

            machines.data(data_unwrap);
            if (!session_loaded)
                load_from_session_storage();
            machines.set_ready();
        });
    } else {
        load_from_session_storage();
        machines.data({});
        machines.set_ready();
    }
}

mod.instance = function instance(loader) {
    return new Machines();
};

mod.loader = function loader(machines, session_only) {
    return new Loader(machines, session_only);
};

mod.colors = [
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

mod.colors.parse = function parse_color(input) {
    const div = document.createElement('div');
    div.style.color = input;
    const style = window.getComputedStyle(div, null);
    return style.getPropertyValue("color") || div.style.color;
};

export const machines = mod;
