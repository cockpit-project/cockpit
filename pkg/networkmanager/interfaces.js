/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import React from "react";
import cockpit from 'cockpit';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

import { fmt_to_fragments } from 'utils.jsx';
import * as utils from './utils.js';
import { v4 as uuidv4 } from 'uuid';

import "./networking.scss";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function show_error_dialog(title, message) {
    const props = {
        id: "error-popup",
        title,
        body: <p>{message}</p>
    };

    const footer = {
        actions: [],
        cancel_button: { text: _("Close"), variant: "secondary" }
    };

    show_modal_dialog(props, footer);
}

export function show_unexpected_error(error) {
    show_error_dialog(_("Unexpected error"), error.message || error);
}

function show_breaking_change_dialog({ fail_text, anyway_text, action }) {
    const props = {
        titleIconVariant: "warning",
        id: "confirm-breaking-change-popup",
        title: _("Connection will be lost"),
        body: <p>{fail_text}</p>
    };

    const footer = {
        actions: [
            {
                caption: anyway_text,
                clicked: action,
                style: "danger",
            }
        ],
        cancel_button: { text: _("Keep connection"), variant: "secondary" }
    };

    show_modal_dialog(props, footer);
}

export function connection_settings(c) {
    if (c && c.Settings && c.Settings.connection) {
        return c.Settings.connection;
    } else {
        // It is a programming error if we ever access a Connection
        // object that doesn't have it's settings yet, and we expect
        // each Connection object to have "connection" settings.
        console.warn("Incomplete 'Connection' object accessed", c);
        // HACK - phantomjs console.trace() prints nothing
        try { throw new Error() } catch (e) { console.log(e.stack) }
        return { };
    }
}

/* NetworkManagerModel
 *
 * The NetworkManager model maintains a mostly-read-only data
 * structure that represents the state of the NetworkManager service
 * on a given machine.
 *
 * The data structure consists of JavaScript values such as objects,
 * arrays, and strings that point at each other.  It might have
 * cycles.  In general, it follows the NetworkManager D-Bus API but
 * tries to hide annoyances such as endian issues.
 *
 * For example,
 *
 *    const manager = model.get_manager();
 *    manager.Devices[0].ActiveConnection.Ipv4Config.Addresses[0][0]
 *
 * is the first IPv4 address of the first device as a string.
 *
 * The model initializes itself asynchronously and emits the 'changed'
 * event whenever anything changes.  If you only access the data
 * structure from within the 'changed' event handler, you should
 * always see it in a complete state.
 *
 * In other words, any change in the data structure from one 'changed'
 * event to the next represents a real change in the state of
 * NetworkManager.
 *
 * When a new model is created, its main 'manager' object starts out
 * as 'null'.  The first 'changed' event signals that initialization
 * is complete and that the whole data structure is now stable and
 * reachable from the 'manager' object.
 *
 * Methods are invoked directly on the objects in the data structure.
 * For example,
 *
 *    manager.Devices[0].disconnect();
 *    manager.Devices[0].ActiveConnection.deactivate();
 *
 * TODO - document the details of the data structure.
 */

/* HACK
 *
 * NetworkManager doesn't implement the standard o.fd.DBus.Properties
 * interface.
 *
 * 1) NM does not emit the PropertiesChanged signal on the
 *    o.fd.DBus.Properties interface but rather on its own interfaces
 *    like o.fd.NetworkManager.Device.Wired.
 *
 * 2) NM does not always emit the PropertiesChanged signal on the
 *    interface whose properties have changed.  For example, when a
 *    property on o.fd.NM.Device changes, this might be notified by a
 *    PropertiesChanged signal on the o.fd.NM.Device.Wired interface
 *    for the same object path.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=729826
 *
 * We cope with this here by merging all properties of all interfaces
 * for a given object path.  This is appropriate and nice for
 * NetworkManager, and we should probably keep it that way even if
 * NetworkManager would use a standard o.fd.DBus.Properties API.
 */

export function NetworkManagerModel() {
    /*
     * The NetworkManager model doesn't need proxies in its DBus client.
     * It uses the 'raw' dbus events and methods and constructs its own data
     * structure.  This has the advantage of avoiding wasting
     * resources for maintaining the unused proxies, avoids some code
     * complexity, and allows to do the right thing with the
     * peculiarities of the NetworkManager API.
     */

    const self = this;
    cockpit.event_target(self);

    const client = cockpit.dbus("org.freedesktop.NetworkManager", { superuser: "try" });
    self.client = client;

    /* resolved once first stage of initialization is done */
    self.preinit = new Promise((resolve, reject) => {
        client.call("/org/freedesktop/NetworkManager",
                    "org.freedesktop.DBus.Properties", "Get",
                    ["org.freedesktop.NetworkManager", "State"], { flags: "" })
                .then((reply, options) => {
                    if (options.flags) {
                        if (options.flags.indexOf(">") !== -1)
                            utils.set_byteorder("be");
                        else if (options.flags.indexOf("<") !== -1)
                            utils.set_byteorder("le");
                        resolve();
                    }
                })
                .catch(complain);
    });

    /* Mostly generic D-Bus stuff.  */

    const objects = { };

    self.set_curtain = (state) => {
        self.curtain = state;
        self.dispatchEvent("changed");
    };

    /* This is a test helper so that we wait for operations to finish before moving forward with the test */
    self.set_operation_in_progress = (value) => {
        self.operationInProgress = value;
        self.dispatchEvent("changed");
    };

    function complain() {
        self.ready = false;
        console.warn.apply(console, arguments);
    }

    function conv_Object(type) {
        return function (path) {
            return get_object(path, type);
        };
    }

    function conv_Array(conv) {
        return function (elts) {
            return elts.map(conv);
        };
    }

    function priv(obj) {
        return obj[' priv'];
    }

    let outstanding_refreshes = 0;

    function push_refresh() {
        outstanding_refreshes += 1;
    }

    function pop_refresh() {
        outstanding_refreshes -= 1;
        if (outstanding_refreshes === 0)
            export_model();
    }

    function get_object(path, type) {
        if (path == "/")
            return null;
        function Constructor() {
            this[' priv'] = { };
            priv(this).type = type;
            priv(this).path = path;
            for (const p in type.props)
                this[p] = type.props[p].def;
        }
        if (!objects[path]) {
            Constructor.prototype = type.prototype;
            objects[path] = new Constructor();
            if (type.refresh)
                type.refresh(objects[path]);
            if (type.exporters && type.exporters[0])
                type.exporters[0](objects[path]);
        }
        return objects[path];
    }

    function peek_object(path) {
        return objects[path] || null;
    }

    function drop_object(path) {
        const obj = objects[path];
        if (obj) {
            if (priv(obj).type.drop)
                priv(obj).type.drop(obj);
            delete objects[path];
            export_model();
        }
    }

    function set_object_properties(obj, props) {
        const decl = priv(obj).type.props;
        for (const p in decl) {
            let val = props[decl[p].prop || p];
            if (val !== undefined) {
                if (decl[p].conv)
                    val = decl[p].conv(val);
                if (val !== obj[p]) {
                    obj[p] = val;
                    if (decl[p].trigger)
                        decl[p].trigger(obj);
                }
            }
        }
    }

    function remove_signatures(props_with_sigs) {
        const props = { };
        for (const p in props_with_sigs) {
            if (props_with_sigs[p]) {
                props[p] = props_with_sigs[p].v;
            }
        }
        return props;
    }

    function objpath(obj) {
        if (obj && priv(obj).path)
            return priv(obj).path;
        else
            return "/";
    }

    function call_object_method(obj, iface, method) {
        return client.call(objpath(obj), iface, method, Array.prototype.slice.call(arguments, 3));
    }

    const interface_types = { };
    let max_export_phases = 0;
    let export_pending;

    function set_object_types(all_types) {
        all_types.forEach(function (type) {
            if (type.exporters && type.exporters.length > max_export_phases)
                max_export_phases = type.exporters.length;
            type.interfaces.forEach(function (iface) {
                interface_types[iface] = type;
            });
        });
    }

    function signal_emitted(path, iface, signal, args) {
        const obj = peek_object(path);

        if (obj) {
            const type = priv(obj).type;

            if (signal == "PropertiesChanged") {
                push_refresh();
                set_object_properties(obj, remove_signatures(args[0]));
                pop_refresh();
            } else if (type.signals && type.signals[signal])
                type.signals[signal](obj, args);
        }
    }

    function interface_properties(path, iface, props) {
        const type = interface_types[iface];
        if (type)
            set_object_properties(get_object(path, type), props);
    }

    function interface_removed(path, iface) {
        /* For NetworkManager we can make this assumption */
        drop_object(path);
    }

    let export_model_promise = null;
    let export_model_promise_resolve = null;

    function export_model() {
        function doit() {
            for (let phase = 0; phase < max_export_phases; phase++) {
                for (const path in objects) {
                    const obj = objects[path];
                    const exp = priv(obj).type.exporters;
                    if (exp && exp[phase])
                        exp[phase](obj);
                }
            }

            self.ready = true;
            self.dispatchEvent('changed');
            if (export_model_promise) {
                export_model_promise_resolve();
                export_model_promise = null;
                export_model_promise_resolve = null;
            }
        }

        if (!export_pending) {
            export_pending = true;
            window.setTimeout(function () { export_pending = false; doit() }, 300);
        }
    }

    self.synchronize = function synchronize() {
        if (outstanding_refreshes === 0) {
            return Promise.resolve();
        } else {
            if (!export_model_promise)
                export_model_promise = new Promise(resolve => { export_model_promise_resolve = resolve });
            return export_model_promise;
        }
    };

    let subscription;
    let watch;

    function onNotifyEventHandler(event, data) {
        Object.keys(data).forEach(path => {
            const interfaces = data[path];

            Object.keys(interfaces).forEach(iface => {
                const props = interfaces[iface];

                if (props)
                    interface_properties(path, iface, props);
                else
                    interface_removed(path, iface);
            });
        });
    }

    self.preinit.then(() => {
        subscription = client.subscribe({ }, signal_emitted);
        client.addEventListener("notify", onNotifyEventHandler);
        watch = client.watch({ path_namespace: "/org/freedesktop" });
        client.addEventListener("owner", (event, owner) => {
            if (owner) {
                watch.remove();
                watch = client.watch({ path_namespace: "/org/freedesktop" });
            }
        });
    });

    self.close = function close() {
        subscription.remove();
        watch.remove();
        client.removeEventListener("notify", onNotifyEventHandler);
        client.close("unused");
    };

    /* NetworkManager specific data conversions and utility functions.
     */

    function ip4_address_from_nm(addr) {
        return [utils.ip4_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip4_to_text(addr[2], true)
        ];
    }

    function ip4_address_to_nm(addr) {
        return [utils.ip4_from_text(addr[0]),
            utils.ip4_prefix_from_text(addr[1]),
            utils.ip4_from_text(addr[2], true)
        ];
    }

    function ip4_route_from_nm(addr) {
        return [utils.ip4_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip4_to_text(addr[2], true),
            utils.ip_metric_to_text(addr[3])
        ];
    }

    function ip4_route_to_nm(addr) {
        return [utils.ip4_from_text(addr[0]),
            utils.ip4_prefix_from_text(addr[1]),
            utils.ip4_from_text(addr[2], true),
            utils.ip_metric_from_text(addr[3])
        ];
    }
    function ip6_address_from_nm(addr) {
        return [utils.ip6_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip6_to_text(addr[2], true)
        ];
    }

    function ip6_address_to_nm(addr) {
        return [utils.ip6_from_text(addr[0]),
            parseInt(addr[1], 10) || 64,
            utils.ip6_from_text(addr[2], true)
        ];
    }

    function ip6_route_from_nm(addr) {
        return [utils.ip6_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip6_to_text(addr[2], true),
            utils.ip_metric_to_text(addr[3]),
        ];
    }

    function ip6_route_to_nm(addr) {
        return [utils.ip6_from_text(addr[0]),
            utils.ip_prefix_from_text(addr[1]),
            utils.ip6_from_text(addr[2], true),
            utils.ip_metric_from_text(addr[3])
        ];
    }

    function settings_from_nm(settings) {
        function get(first, second, def) {
            if (settings[first] && settings[first][second])
                return settings[first][second].v;
            else
                return def;
        }

        function get_ip(first, addr_from_nm, route_from_nm, ip_to_text) {
            return {
                method: get(first, "method", "auto"),
                ignore_auto_dns: get(first, "ignore-auto-dns", false),
                ignore_auto_routes: get(first, "ignore-auto-routes", false),
                addresses: get(first, "addresses", []).map(addr_from_nm),
                dns: get(first, "dns", []).map(ip_to_text),
                dns_search: get(first, "dns-search", []),
                routes: get(first, "routes", []).map(route_from_nm)
            };
        }

        const result = {
            connection: {
                type: get("connection", "type"),
                uuid: get("connection", "uuid"),
                interface_name: get("connection", "interface-name"),
                timestamp: get("connection", "timestamp", 0),
                id: get("connection", "id", _("Unknown")),
                autoconnect: get("connection", "autoconnect", true),
                autoconnect_members:
                                get("connection", "autoconnect-slaves", -1),
                member_type: get("connection", "slave-type"),
                group: get("connection", "master")
            }
        };

        if (!settings.connection.master) {
            result.ipv4 = get_ip("ipv4", ip4_address_from_nm, ip4_route_from_nm, utils.ip4_to_text);
            result.ipv6 = get_ip("ipv6", ip6_address_from_nm, ip6_route_from_nm, utils.ip6_to_text);
        }

        if (settings["802-3-ethernet"]) {
            result.ethernet = {
                mtu: get("802-3-ethernet", "mtu"),
                assigned_mac_address: get("802-3-ethernet", "assigned-mac-address")
            };
        }

        if (settings.bond) {
            /* Options are documented as part of the Linux bonding driver.
               https://www.kernel.org/doc/Documentation/networking/bonding.txt
            */
            result.bond = {
                options: { ...get("bond", "options", { }) },
                interface_name: get("bond", "interface-name")
            };
        }

        function JSON_parse_carefully(str) {
            try {
                return JSON.parse(str);
            } catch (e) {
                return null;
            }
        }

        if (settings.team) {
            result.team = {
                config: JSON_parse_carefully(get("team", "config", "{}")),
                interface_name: get("team", "interface-name")
            };
        }

        if (settings["team-port"] || result.connection.member_type == "team") {
            result.team_port = { config: JSON_parse_carefully(get("team-port", "config", "{}")), };
        }

        if (settings.bridge) {
            result.bridge = {
                interface_name: get("bridge", "interface-name"),
                stp: get("bridge", "stp", true),
                priority: get("bridge", "priority", 32768),
                forward_delay: get("bridge", "forward-delay", 15),
                hello_time: get("bridge", "hello-time", 2),
                max_age: get("bridge", "max-age", 20),
                ageing_time: get("bridge", "ageing-time", 300)
            };
        }

        if (settings["bridge-port"] || result.connection.member_type == "bridge") {
            result.bridge_port = {
                priority: get("bridge-port", "priority", 32),
                path_cost: get("bridge-port", "path-cost", 100),
                hairpin_mode: get("bridge-port", "hairpin-mode", false)
            };
        }

        if (settings.vlan) {
            result.vlan = {
                parent: get("vlan", "parent"),
                id: get("vlan", "id"),
                interface_name: get("vlan", "interface-name")
            };
        }

        if (settings.wireguard) {
            result.wireguard = {
                listen_port: get("wireguard", "listen-port", 0),
                peers: get("wireguard", "peers", []).map(peer => ({
                    publicKey: peer['public-key'].v,
                    endpoint: peer.endpoint?.v, // enpoint of a peer is optional
                    allowedIps: peer['allowed-ips'].v
                })),
            };
        }

        return result;
    }

    function settings_to_nm(settings, orig) {
        const result = JSON.parse(JSON.stringify(orig || { }));

        function set(first, second, sig, val, def) {
            if (val === undefined)
                val = def;
            if (!result[first])
                result[first] = { };
            if (val !== undefined)
                result[first][second] = cockpit.variant(sig, val);
            else
                delete result[first][second];
        }

        function set_ip(first, addrs_sig, addr_to_nm, routes_sig, route_to_nm, ips_sig, ip_from_text) {
            set(first, "method", 's', settings[first].method);
            set(first, "ignore-auto-dns", 'b', settings[first].ignore_auto_dns);
            set(first, "ignore-auto-routes", 'b', settings[first].ignore_auto_routes);

            const addresses = settings[first].addresses;
            if (addresses)
                set(first, "addresses", addrs_sig, addresses.map(addr_to_nm));

            const dns = settings[first].dns;
            if (dns)
                set(first, "dns", ips_sig, dns.map(ip_from_text));
            set(first, "dns-search", 'as', settings[first].dns_search);

            const routes = settings[first].routes;
            if (routes)
                set(first, "routes", routes_sig, routes.map(route_to_nm));

            // Never pass "address-labels" back to NetworkManager.  It
            // is documented as "internal only", but needs to somehow
            // stay in sync with "addresses".  By not passing it back
            // we don't have to worry about that.
            //
            delete result[first]["address-labels"];
        }

        set("connection", "id", 's', settings.connection.id);
        set("connection", "autoconnect", 'b', settings.connection.autoconnect);
        set("connection", "autoconnect-slaves", 'i', settings.connection.autoconnect_members);
        set("connection", "uuid", 's', settings.connection.uuid);
        set("connection", "interface-name", 's', settings.connection.interface_name);
        set("connection", "type", 's', settings.connection.type);
        set("connection", "slave-type", 's', settings.connection.member_type);
        set("connection", "master", 's', settings.connection.group);

        if (settings.ipv4)
            set_ip("ipv4", 'aau', ip4_address_to_nm, 'aau', ip4_route_to_nm, 'au', utils.ip4_from_text);
        else
            delete result.ipv4;

        if (settings.ipv6)
            set_ip("ipv6", 'a(ayuay)', ip6_address_to_nm, 'a(ayuayu)', ip6_route_to_nm, 'aay', utils.ip6_from_text);
        else
            delete result.ipv6;

        if (settings.bond) {
            set("bond", "options", 'a{ss}', settings.bond.options);
            set("bond", "interface-name", 's', settings.bond.interface_name);
        } else
            delete result.bond;

        if (settings.team) {
            set("team", "config", 's', JSON.stringify(settings.team.config));
            set("team", "interface-name", 's', settings.team.interface_name);
        } else
            delete result.team;

        if (settings.team_port)
            set("team-port", "config", 's', JSON.stringify(settings.team_port.config));
        else
            delete result["team-port"];

        if (settings.bridge) {
            set("bridge", "interface-name", 's', settings.bridge.interface_name);
            set("bridge", "stp", 'b', settings.bridge.stp);
            set("bridge", "priority", 'u', settings.bridge.priority);
            set("bridge", "forward-delay", 'u', settings.bridge.forward_delay);
            set("bridge", "hello-time", 'u', settings.bridge.hello_time);
            set("bridge", "max-age", 'u', settings.bridge.max_age);
            set("bridge", "ageing-time", 'u', settings.bridge.ageing_time);
        } else
            delete result.bridge;

        if (settings.bridge_port) {
            set("bridge-port", "priority", 'u', settings.bridge_port.priority);
            set("bridge-port", "path-cost", 'u', settings.bridge_port.path_cost);
            set("bridge-port", "hairpin-mode", 'b', settings.bridge_port.hairpin_mode);
        } else
            delete result["bridge-port"];

        if (settings.vlan) {
            set("vlan", "parent", 's', settings.vlan.parent);
            set("vlan", "id", 'u', settings.vlan.id);
            set("vlan", "interface-name", 's', settings.vlan.interface_name);
            // '1' is the default, but we need to set it explicitly anyway.
            set("vlan", "flags", 'u', 1);
        } else
            delete result.vlan;

        if (settings.ethernet) {
            set("802-3-ethernet", "mtu", 'u', settings.ethernet.mtu);
            set("802-3-ethernet", "assigned-mac-address", 's', settings.ethernet.assigned_mac_address);
            // Delete cloned-mac-address so that assigned-mac-address gets used.
            delete result["802-3-ethernet"]["cloned-mac-address"];
        } else
            delete result["802-3-ethernet"];

        if (settings.wireguard) {
            set("wireguard", "private-key", "s", settings.wireguard.private_key);
            set("wireguard", "listen-port", "u", settings.wireguard.listen_port);
            set("wireguard", "peers", "aa{sv}", settings.wireguard.peers.map(peer => {
                return {
                    "public-key": {
                        t: "s",
                        v: peer.publicKey
                    },
                    ...peer.endpoint
                        ? {
                            endpoint: {
                                t: "s",
                                v: peer.endpoint
                            }
                        }
                        : {},
                    "allowed-ips": {
                        t: "as",
                        v: peer.allowedIps
                    }
                };
            }));
        } else {
            delete result.wireguard;
        }

        return result;
    }

    function device_type_to_symbol(type) {
        // This returns a string that is suitable for the connection.type field of
        // Connection.Settings, except for "ethernet".
        switch (type) {
        case 0: return 'unknown';
        case 1: return 'ethernet'; // 802-3-ethernet
        case 2: return '802-11-wireless';
        case 3: return 'unused1';
        case 4: return 'unused2';
        case 5: return 'bluetooth';
        case 6: return '802-11-olpc-mesh';
        case 7: return 'wimax';
        case 8: return 'modem';
        case 9: return 'infiniband';
        case 10: return 'bond';
        case 11: return 'vlan';
        case 12: return 'adsl';
        case 13: return 'bridge';
        case 14: return 'generic';
        case 15: return 'team';
        case 16: return 'tun';
        case 17: return 'ip_tunnel';
        case 18: return 'macvlan';
        case 19: return 'vxlan';
        case 20: return 'veth';
        case 21: return 'macsec';
        case 22: return 'dummy';
        case 23: return 'ppp';
        case 24: return 'ovs_interface';
        case 25: return 'ovs_port';
        case 26: return 'ovs_bridge';
        case 27: return 'wpan';
        case 28: return '6lowpan';
        case 29: return 'wireguard';
        case 30: return 'wifi_p2p';
        case 31: return 'vrf';
        case 32: return 'loopback';
        default: return '';
        }
    }

    function device_state_to_text(state) {
        switch (state) {
        // NM_DEVICE_STATE_UNKNOWN
        case 0: return "?";
        // NM_DEVICE_STATE_UNMANAGED
        case 10: return "";
        // NM_DEVICE_STATE_UNAVAILABLE
        case 20: return _("Not available");
        // NM_DEVICE_STATE_DISCONNECTED
        case 30: return _("Inactive");
        // NM_DEVICE_STATE_PREPARE
        case 40: return _("Preparing");
        // NM_DEVICE_STATE_CONFIG
        case 50: return _("Configuring");
        // NM_DEVICE_STATE_NEED_AUTH
        case 60: return _("Authenticating");
        // NM_DEVICE_STATE_IP_CONFIG
        case 70: return _("Configuring IP");
        // NM_DEVICE_STATE_IP_CHECK
        case 80: return _("Checking IP");
        // NM_DEVICE_STATE_SECONDARIES
        case 90: return _("Waiting");
        // NM_DEVICE_STATE_ACTIVATED
        case 100: return _("Active");
        // NM_DEVICE_STATE_DEACTIVATING
        case 110: return _("Deactivating");
        // NM_DEVICE_STATE_FAILED
        case 120: return _("Failed");
        default: return "";
        }
    }

    const connections_by_uuid = { };

    function set_settings(obj, settings) {
        if (obj.Settings && obj.Settings.connection && obj.Settings.connection.uuid)
            delete connections_by_uuid[obj.Settings.connection.uuid];
        obj.Settings = settings;
        if (settings && settings.connection && settings.connection.uuid)
            connections_by_uuid[settings.connection.uuid] = obj;
    }

    function refresh_settings(obj) {
        push_refresh();
        client.call(objpath(obj), "org.freedesktop.NetworkManager.Settings.Connection", "GetSettings")
                .then(function(reply) {
                    const result = reply[0];
                    if (result) {
                        priv(obj).orig = result;
                        set_settings(obj, settings_from_nm(result));
                    }
                })
                .catch(complain)
                .finally(pop_refresh);
    }

    function refresh_udev(obj) {
        if (obj.Udi.indexOf("/sys/") !== 0)
            return;

        push_refresh();
        cockpit.spawn(["udevadm", "info", obj.Udi], { err: 'message' })
                .then(function(res) {
                    const props = { };
                    function snarf_prop(line, env, prop) {
                        const prefix = "E: " + env + "=";
                        if (line.indexOf(prefix) === 0) {
                            props[prop] = line.substr(prefix.length);
                        }
                    }
                    res.split('\n').forEach(function(line) {
                        snarf_prop(line, "ID_MODEL_FROM_DATABASE", "IdModel");
                        snarf_prop(line, "ID_VENDOR_FROM_DATABASE", "IdVendor");
                    });
                    set_object_properties(obj, props);
                })
                .catch(function(ex) {
                /* udevadm info exits with 4 when device doesn't exist */
                    if (ex.exit_status !== 4) {
                        console.warn(ex.message);
                        console.warn(ex);
                    }
                })
                .finally(pop_refresh);
    }

    function handle_updated(obj) {
        refresh_settings(obj);
    }

    /* NetworkManager specific object types, used by the generic D-Bus
     * code and using the data conversion functions.
     */

    const type_Ipv4Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP4Config"
        ],

        props: {
            Addresses: { conv: conv_Array(ip4_address_from_nm), def: [] }
        }
    };

    const type_Ipv6Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP6Config"
        ],

        props: {
            Addresses: { conv: conv_Array(ip6_address_from_nm), def: [] }
        }
    };

    const type_Connection = {
        interfaces: [
            "org.freedesktop.NetworkManager.Settings.Connection"
        ],

        props: {
            Unsaved: { }
        },

        signals: {
            Updated: handle_updated
        },

        refresh: refresh_settings,

        drop: function (obj) {
            set_settings(obj, null);
        },

        prototype: {
            copy_settings: function () {
                return JSON.parse(JSON.stringify(this.Settings));
            },

            apply_settings: function (settings) {
                const self = this;
                try {
                    return call_object_method(self,
                                              "org.freedesktop.NetworkManager.Settings.Connection", "Update",
                                              settings_to_nm(settings, priv(self).orig))
                            .then(() => {
                                set_settings(self, settings);
                            });
                } catch (e) {
                    return Promise.reject(e);
                }
            },

            activate: function (dev, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(this), objpath(dev), objpath(specific_object))
                        .then(([active_connection]) => active_connection);
            },

            delete_: function () {
                return call_object_method(this, "org.freedesktop.NetworkManager.Settings.Connection", "Delete")
                        .then(() => undefined);
            }
        },

        exporters: [
            function (obj) {
                obj.Groups = [];
                obj.Members = [];
                obj.Interfaces = [];
            },

            null,

            null,

            // Needs: type_Interface.Connections
            //
            // Sets:  type_Connection.Members
            //        type_Connection.Groups
            //
            function (obj) {
                // Most of the time, a connection has zero or one groups,
                // but when a connection refers to its group by interface
                // name, we might end up with more than one group
                // connection so we just collect them all.
                //
                // TODO - Nail down how NM really handles this.

                function check_con(con) {
                    const group_settings = connection_settings(con);
                    const my_settings = connection_settings(obj);
                    if (group_settings.type == my_settings.member_type) {
                        obj.Groups.push(con);
                        con.Members.push(obj);
                    }
                }

                const cs = connection_settings(obj);
                if (cs.member_type) {
                    const group = connections_by_uuid[cs.group];
                    if (group) {
                        obj.Groups.push(group);
                        group.Members.push(obj);
                    } else {
                        const iface = peek_interface(cs.group);
                        if (iface) {
                            iface.Connections.forEach(check_con);
                        }
                    }
                }
            }
        ]

    };

    const type_ActiveConnection = {
        interfaces: [
            "org.freedesktop.NetworkManager.Connection.Active"
        ],

        props: {
            Connection: { conv: conv_Object(type_Connection) },
            Ip4Config: { conv: conv_Object(type_Ipv4Config) },
            Ip6Config: { conv: conv_Object(type_Ipv6Config) }
            // See below for "Group"
        },

        prototype: {
            deactivate: function() {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "DeactivateConnection",
                                          objpath(this))
                        .then(() => undefined);
            }
        }
    };

    const type_Device = {
        interfaces: [
            "org.freedesktop.NetworkManager.Device",
            "org.freedesktop.NetworkManager.Device.Wired",
            "org.freedesktop.NetworkManager.Device.Bond",
            "org.freedesktop.NetworkManager.Device.Team",
            "org.freedesktop.NetworkManager.Device.Bridge",
            "org.freedesktop.NetworkManager.Device.Vlan"
        ],

        props: {
            DeviceType: { conv: device_type_to_symbol },
            Interface: { },
            StateText: { prop: "State", conv: device_state_to_text, def: _("Unknown") },
            State: { },
            HwAddress: { },
            AvailableConnections: { conv: conv_Array(conv_Object(type_Connection)), def: [] },
            ActiveConnection: { conv: conv_Object(type_ActiveConnection) },
            Ip4Config: { conv: conv_Object(type_Ipv4Config) },
            Ip6Config: { conv: conv_Object(type_Ipv6Config) },
            Udi: { trigger: refresh_udev },
            IdVendor: { def: "" },
            IdModel: { def: "" },
            Driver: { def: "" },
            Carrier: { def: true },
            Speed: { },
            Managed: { def: false },
            // See below for "Members"
        },

        prototype: {
            activate: function(connection, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(connection), objpath(this), objpath(specific_object))
                        .then(([active_connection]) => active_connection);
            },

            activate_with_settings: function(settings, specific_object) {
                try {
                    return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                              "org.freedesktop.NetworkManager", "AddAndActivateConnection",
                                              settings_to_nm(settings), objpath(this), objpath(specific_object))
                            .then(([path, active_connection]) => active_connection);
                } catch (e) {
                    return Promise.reject(e);
                }
            },

            disconnect: function () {
                return call_object_method(this, 'org.freedesktop.NetworkManager.Device', 'Disconnect')
                        .then(() => undefined);
            }
        }
    };

    // The 'Interface' type does not correspond to any NetworkManager
    // object or interface.  We use it to represent a network device
    // that might or might not actually be known to the kernel, such
    // as the interface of a bond that is currently down.
    //
    // This is a HACK: NetworkManager should export Device nodes for
    // these.

    const type_Interface = {
        interfaces: [],

        exporters: [
            function (obj) {
                obj.Device = null;
                obj._NonDeviceConnections = [];
                obj.Connections = [];
                obj.MainConnection = null;
            },

            null,

            // Needs: type_Interface.Device
            //        type_Interface._NonDeviceConnections
            //
            // Sets:  type_Connection.Interfaces
            //        type_Interface.Connections
            //        type_Interface.MainConnection

            function (obj) {
                if (!obj.Device && obj._NonDeviceConnections.length === 0) {
                    drop_object(priv(obj).path);
                    return;
                }

                function consider_for_main(con) {
                    if (!obj.MainConnection ||
                        connection_settings(obj.MainConnection).timestamp < connection_settings(con).timestamp) {
                        obj.MainConnection = con;
                    }
                }

                obj.Connections = obj._NonDeviceConnections;

                if (obj.Device) {
                    obj.Device.AvailableConnections.forEach(function (con) {
                        if (obj.Connections.indexOf(con) == -1)
                            obj.Connections.push(con);
                    });
                }

                obj.Connections.forEach(function (con) {
                    consider_for_main(con);
                    con.Interfaces.push(obj);
                });

                // Explicitly prefer the active connection.  The
                // active connection should have the most recent
                // timestamp, but only when the activation was
                // successful.  Also, there don't seem to be change
                // notifications when the timestamp changes.

                if (obj.Device && obj.Device.ActiveConnection && obj.Device.ActiveConnection.Connection) {
                    obj.MainConnection = obj.Device.ActiveConnection.Connection;
                }
            }
        ]

    };

    function get_interface(iface) {
        const obj = get_object(":interface:" + iface, type_Interface);
        obj.Name = iface;
        return obj;
    }

    function peek_interface(iface) {
        return peek_object(":interface:" + iface);
    }

    const type_Settings = {
        interfaces: [
            "org.freedesktop.NetworkManager.Settings"
        ],

        props: {
            Connections: { conv: conv_Array(conv_Object(type_Connection)), def: [] }
        },

        prototype: {
            add_connection: function (conf) {
                return call_object_method(this,
                                          'org.freedesktop.NetworkManager.Settings',
                                          'AddConnection',
                                          settings_to_nm(conf, { }))
                        .then(([path]) => get_object(path, type_Connection));
            }
        },

        exporters: [
            null,

            // Sets: type_Interface._NonDeviceConnections
            //
            function (obj) {
                if (obj.Connections) {
                    obj.Connections.forEach(function (con) {
                        function add_to_interface(name) {
                            if (name) {
                                const cons = get_interface(name)._NonDeviceConnections;
                                if (cons.indexOf(con) == -1)
                                    cons.push(con);
                            }
                        }

                        if (con.Settings) {
                            if (con.Settings.connection)
                                add_to_interface(con.Settings.connection.interface_name);
                            if (con.Settings.bond)
                                add_to_interface(con.Settings.bond.interface_name);
                            if (con.Settings.team)
                                add_to_interface(con.Settings.team.interface_name);
                            if (con.Settings.bridge)
                                add_to_interface(con.Settings.bridge.interface_name);
                            if (con.Settings.vlan)
                                add_to_interface(con.Settings.vlan.interface_name);
                        }
                    });
                }
            }
        ]
    };

    const type_Manager = {
        interfaces: [
            "org.freedesktop.NetworkManager"
        ],

        props: {
            Capabilities: { def: [] },
            Version: { },
            Devices: {
                conv: conv_Array(conv_Object(type_Device)),
                def: []
            },
            ActiveConnections: { conv: conv_Array(conv_Object(type_ActiveConnection)), def: [] }
        },

        prototype: {
            checkpoint_create: function (devices, timeout) {
                return call_object_method(this,
                                          'org.freedesktop.NetworkManager',
                                          'CheckpointCreate',
                                          devices.map(objpath),
                                          timeout,
                                          0)
                        .then(([checkpoint]) => checkpoint)
                        .catch(function (error) {
                            if (error.name != "org.freedesktop.DBus.Error.UnknownMethod")
                                console.warn(error.message || error);
                        });
            },

            checkpoint_destroy: function (checkpoint) {
                if (checkpoint) {
                    return call_object_method(this,
                                              'org.freedesktop.NetworkManager',
                                              'CheckpointDestroy',
                                              checkpoint)
                            .then(() => undefined);
                } else
                    return Promise.resolve();
            },

            checkpoint_rollback: function (checkpoint) {
                if (checkpoint) {
                    return call_object_method(this,
                                              'org.freedesktop.NetworkManager',
                                              'CheckpointRollback',
                                              checkpoint)
                            .then(([result]) => result);
                } else
                    return Promise.resolve();
            }
        },

        exporters: [
            null,

            // Sets: type_Interface.Device
            //
            function (obj) {
                obj.Devices.forEach(function (dev) {
                    if (dev.Interface) {
                        const iface = get_interface(dev.Interface);
                        iface.Device = dev;
                    }
                });
            }
        ]
    };

    /* Now create the cyclic declarations.
     */
    type_ActiveConnection.props.Group = { conv: conv_Object(type_Device) };
    type_Device.props.Members = { conv: conv_Array(conv_Object(type_Device)), def: [] };

    /* Accessing the model.
     */

    self.list_interfaces = function list_interfaces() {
        const result = [];
        for (const path in objects) {
            const obj = objects[path];
            if (priv(obj).type === type_Interface)
                result.push(obj);
        }
        return result.sort(function (a, b) { return a.Name.localeCompare(b.Name) });
    };

    self.find_interface = peek_interface;

    self.get_manager = function () {
        return get_object("/org/freedesktop/NetworkManager",
                          type_Manager);
    };

    self.get_settings = function () {
        return get_object("/org/freedesktop/NetworkManager/Settings",
                          type_Settings);
    };

    /* Initialization.
     */

    set_object_types([type_Manager,
        type_Settings,
        type_Device,
        type_Ipv4Config,
        type_Ipv6Config,
        type_Connection,
        type_ActiveConnection
    ]);

    get_object("/org/freedesktop/NetworkManager", type_Manager);
    get_object("/org/freedesktop/NetworkManager/Settings", type_Settings);

    self.ready = undefined;
    self.operationInProgress = undefined;
    self.curtain = undefined;
    return self;
}

export function syn_click(model, fun) {
    return function() {
        const self = this;
        const self_args = arguments;
        return model.synchronize().then(function() {
            fun.apply(self, self_args);
        });
    };
}

export function is_managed(dev) {
    return dev.State != 10;
}

function render_interface_link(iface) {
    return <Button variant='link' tabindex="0"
                   isInline
                   onClick={() => cockpit.location.go([iface])}>{iface}
    </Button>;
}

export function device_state_text(dev) {
    if (!dev)
        return _("Inactive");
    if (dev.State == 100 && dev.Carrier === false)
        return _("No carrier");
    if (!is_managed(dev)) {
        if (!dev.ActiveConnection &&
            (!dev.Ip4Config || dev.Ip4Config.Addresses.length === 0) &&
            (!dev.Ip6Config || dev.Ip6Config.Addresses.length === 0))
            return _("Inactive");
    }
    return dev.StateText;
}

export function array_join(elts, sep) {
    const result = [];
    for (let i = 0; i < elts.length; i++) {
        result.push(elts[i]);
        if (i < elts.length - 1)
            result.push(sep);
    }
    return result;
}

export function render_active_connection(dev, with_link, hide_link_local) {
    const parts = [];

    if (!dev)
        return "";

    const con = dev.ActiveConnection;

    if (con && con.Group) {
        return fmt_to_fragments(_("Part of $0"), with_link ? render_interface_link(con.Group.Interface) : con.Group.Interface);
    }

    const ip4config = con ? con.Ip4Config : dev.Ip4Config;
    if (ip4config) {
        ip4config.Addresses.forEach(function (a) {
            parts.push(a[0] + "/" + a[1]);
        });
    }

    function is_ipv6_link_local(addr) {
        return (addr.indexOf("fe8") === 0 ||
                addr.indexOf("fe9") === 0 ||
                addr.indexOf("fea") === 0 ||
                addr.indexOf("feb") === 0);
    }

    const ip6config = con ? con.Ip6Config : dev.Ip6Config;
    if (ip6config) {
        ip6config.Addresses.forEach(function (a) {
            if (!(hide_link_local && is_ipv6_link_local(a[0])))
                parts.push(a[0] + "/" + a[1]);
        });
    }

    return parts.join(", ");
}

/* Resource usage monitoring
*/

export function complete_settings(settings, device) {
    if (!device) {
        console.warn("No device to complete settings", JSON.stringify(settings));
        return;
    }

    settings.connection.id = device.Interface;
    settings.connection.uuid = uuidv4();

    if (device.DeviceType == 'ethernet') {
        settings.connection.type = '802-3-ethernet';
        settings.ethernet = { };
    } else {
        // The remaining types are identical between Device and Settings, see
        // device_type_to_symbol.
        settings.connection.type = device.DeviceType;
    }
}

export function settings_applier(model, device, connection) {
    /* If we have a connection, we can just update it.
     * Otherwise if the settings has TYPE set, we can add
     * them as a stand-alone object.  Otherwise, we
     * activate the device with the settings which causes
     * NM to fill in the type and other details.
     *
     * HACK - The activation is a hack, we would rather
     * just have NM fill in the details and not activate
     * the connection.  See complete_settings above that
     * can do some of this completion.
     *
     * https://bugzilla.gnome.org/show_bug.cgi?id=775226
     */

    return function (settings) {
        if (connection) {
            return connection.apply_settings(settings);
        } else if (settings.connection.type) {
            return model.get_settings().add_connection(settings);
        } else if (device) {
            return device.activate_with_settings(settings);
        } else {
            cockpit.warn("No way to apply settings", connection, settings);
            return Promise.resolve();
        }
    };
}

export function choice_title(choices, choice, def) {
    for (let i = 0; i < choices.length; i++) {
        if (choices[i].choice == choice)
            return choices[i].title;
    }
    return def;
}

/* Support for automatically rolling back changes that break the
 * connection to the server.
 *
 * The basic idea is to perform the following steps:
 *
 * 1) Create a checkpoint with automatic rollback
 * 2) Make the change
 * 3) Destroy the checkpoint
 *
 * If step 2 breaks the connection, step 3 won't happen and the
 * checkpoint will roll back after some time.  This is supposed to
 * restore connectivity, so steps 2 and 3 will complete at that time,
 * and step 3 will fail because the checkpoint doesn't exist anymore.
 *
 * The failure of step 3 is our indication that the connection was
 * temporarily broken, and we inform the user about that.
 *
 * Usually, step 2 completes successfully also for a change that
 * breaks the connection, and connectivity is only lost after some
 * delay.  Thus, we also delay step 3 by a short amount (settle_time,
 * below).
 *
 * For a change that _doesn't_ break connectivity, this whole process
 * is inherently a race: Steps 2 and 3 need to complete before the
 * checkpoint created in step 1 reaches its timeout.
 *
 * It is better to wait a bit longer for salvation after making a
 * mistake than to have many of your legitimate changes be cancelled
 * by an impatient nanny mechanism.  Thus, we use a rather long
 * checkpoint rollback timeout (rollback_time, below).
 *
 * For a good change, all three steps usually happen quickly, and the
 * time we wait between steps 2 and 3 doesn't need to be very long
 * either, apparently.  Thus, we delay any indication that something
 * might be wrong by a short delay (curtain_time, below), and most
 * changes can thus be made without the "Testing connection" curtain
 * coming up.
 *
 * Some changes will be rolled back although the user really wants to
 * make them.  For example, the user might want to change the IP
 * address of the machine, and although this will disconnect Cockpit,
 * the user can connect again on the new address.
 *
 * In order to give the user the option to avoid this unwanted
 * rollback, we let him/her do the same change without a checkpoint
 * directly from the dialog that explains the problem.
 */

/* To avoid interference, we switch off the global transport health
 * check while a checkpoint exists.  For example, if the rollback
 * takes a really long time, Cockpit would otherwise disconnect itself
 * forcefully and the user would not get to see the dialog with the
 * "Do it anyway" button.  This dialog is the only way to make certain
 * changes, and it is thus important to show it if at all possible.
 */

/* Considerations for choosing the times below
 *
 * curtain_time too short:  Curtain comes up too often for good changes.
 *
 * curtain_time too long:   User is left with a broken UI for a
 *                          significant time in the case of a mistake.
 *
 * settle_time too short:   Some bad changes that take time to have any
 *                          effect will be let through.
 *
 * settle_time too high:    All operations take a long time and the race
 *                          between Cockpit destroying the checkpoint
 *                          and NetworkManager rolling it back (see
 *                          above) gets tighter.  The curtain
 *                          needs to come up to prevent the user from
 *                          interacting with the page.  Thus
 *                          settle_time should be shorter than
 *                          curtain_time.
 *
 * rollback_time too short: Good changes that take a long time to complete
 *                          (on a loaded machine, say) are cancelled spuriously.
 *
 * rollback_time too long:  The user has to wait a long time before
 *                          his/her mistake is corrected and might
 *                          consider Cockpit to be dead already.
 *                          Also, the network connection machinery in
 *                          the kernels and browsers must recover
 *                          after no packages have been flowing for
 *                          this much time.  Windows seems to have
 *                          less patience than Linux in this regard.
 */
const curtain_time = 1.5;
let settle_time = 1.0;
const rollback_time = 7.0;

export function with_checkpoint(model, modify, options) {
    const manager = model.get_manager();

    let curtain_timeout;
    let curtain_title_timeout;

    function show_curtain() {
        cockpit.hint("ignore_transport_health_check", { data: true });
        curtain_timeout = window.setTimeout(function () {
            curtain_timeout = null;
            model.set_curtain('testing');
        }, curtain_time * 1000);
        curtain_title_timeout = window.setTimeout(function () {
            curtain_title_timeout = null;
            model.set_curtain('restoring');
        }, rollback_time * 1000);
    }

    function hide_curtain() {
        if (curtain_timeout)
            window.clearTimeout(curtain_timeout);
        curtain_timeout = null;
        if (curtain_title_timeout)
            window.clearTimeout(curtain_title_timeout);
        cockpit.hint("ignore_transport_health_check", { data: false });

        model.set_curtain(undefined);
    }

    // HACK - Let's not use checkpoints for changes that involve
    // adding or removing connections.
    //
    // https://bugzilla.redhat.com/show_bug.cgi?id=1378393
    // https://bugzilla.redhat.com/show_bug.cgi?id=1398316
    //
    // We also switch off checkpoints for most of the integration
    // tests.

    if (options.hack_does_add_or_remove || window.cockpit_tests_disable_checkpoints) {
        modify();
        return;
    }

    if (window.cockpit_tests_checkpoints_settle_time)
        settle_time = window.cockpit_tests_checkpoints_settle_time;

    manager.checkpoint_create(options.devices || [], rollback_time)
            .then(function (cp) {
                if (!cp) {
                    modify();
                    return;
                }

                show_curtain();
                modify()
                        .then(function () {
                            window.setTimeout(function () {
                                manager.checkpoint_destroy(cp)
                                        .catch(function () {
                                            show_breaking_change_dialog({
                                                ...options,
                                                action: syn_click(model, modify)
                                            });
                                        })
                                        .finally(hide_curtain);
                            }, settle_time * 1000);
                        })
                        .catch(function () {
                            hide_curtain();

                            // HACK
                            //
                            // We want to avoid rollbacks for operations that don't actually change anything when they
                            // fail.  Rollback are always disruptive and always seem to reconnect all the included
                            // devices, even if nothing has actually changed.  Thus, if you give invalid input to
                            // NetworkManager and receive an error in a settings dialog, rolling back the checkpoint
                            // would cause a temporary disconnection on the interface.
                            //
                            // https://bugzilla.redhat.com/show_bug.cgi?id=1427187

                            if (options.rollback_on_failure)
                                manager.checkpoint_rollback(cp);
                            else
                                manager.checkpoint_destroy(cp);
                        });
            });
}

export function with_settings_checkpoint(model, modify, options) {
    with_checkpoint(model, modify,
                    {
                        ...options,
                        fail_text: _("Changing the settings will break the connection to the server, and will make the administration UI unavailable."),
                        anyway_text: _("Change the settings"),
                    });
}

export function connection_devices(con) {
    const devices = [];

    if (con)
        con.Interfaces.forEach(function (iface) { if (iface.Device) devices.push(iface.Device); });

    return devices;
}

export function is_interface_connection(iface, connection) {
    return connection && connection.Interfaces.indexOf(iface) != -1;
}

export function is_interesting_interface(iface) {
    return !iface.Device || (is_managed(iface.Device) && iface.Device.DeviceType != "loopback");
}

export function member_connection_for_interface(group, iface) {
    return group?.Members.find(s => is_interface_connection(iface, s));
}

export function member_interface_choices(model, group) {
    return model.list_interfaces().filter(function (iface) {
        return !is_interface_connection(iface, group) && is_interesting_interface(iface);
    });
}

export function free_member_connection(con) {
    const cs = connection_settings(con);
    if (cs.member_type) {
        delete cs.member_type;
        delete cs.group;
        delete con.Settings.team_port;
        delete con.Settings.bridge_port;
        return con.apply_settings(con.Settings).then(() => { con.activate(null, null) });
    }
}

export function set_member(model, group_connection, group_settings, member_type,
    iface_name, val) {
    const iface = model.find_interface(iface_name);
    if (!iface)
        return false;

    const main_connection = iface.MainConnection;

    if (val) {
        /* Turn the main_connection into a member for group.
         */

        const group_iface = group_connection
            ? group_connection.Interfaces[0].Name
            : group_settings.connection.interface_name;

        if (!group_iface)
            return false;

        let member_settings;
        if (main_connection) {
            member_settings = main_connection.Settings;

            if (member_settings.connection.group == group_settings.connection.uuid ||
                member_settings.connection.group == group_settings.connection.id ||
                member_settings.connection.group == group_iface)
                return Promise.resolve();

            member_settings.connection.member_type = member_type;
            member_settings.connection.group = group_iface;
            member_settings.connection.autoconnect = true;
            delete member_settings.ipv4;
            delete member_settings.ipv6;
            delete member_settings.team_port;
            delete member_settings.bridge_port;
        } else {
            member_settings = {
                connection:
                               {
                                   autoconnect: true,
                                   interface_name: iface.Name,
                                   member_type,
                                   group: group_iface
                               }
            };
            complete_settings(member_settings, iface.Device);
        }

        return settings_applier(model, iface.Device, main_connection)(member_settings).then(function () {
            // If the group already exists, activate or deactivate the member immediately so that
            // the settings actually apply and the interface becomes a member.  Otherwise we
            // activate it later when the group is created.
            if (group_connection) {
                const group_dev = group_connection.Interfaces[0].Device;
                if (group_dev && group_dev.ActiveConnection)
                    return main_connection.activate(iface.Device);
                else if (iface.Device.ActiveConnection)
                    return iface.Device.ActiveConnection.deactivate();
            }
        });
    } else {
        /* Free the main_connection from being a member if it is our member.  If there is
         * no main_connection, we don't need to do anything.
         */
        if (main_connection && main_connection.Groups.indexOf(group_connection) != -1) {
            free_member_connection(main_connection);
        }
    }

    return true;
}

export function apply_group_member(choices, model, apply_group, group_connection, group_settings, member_type) {
    const active_settings = [];

    if (!group_connection) {
        if (group_settings.bond &&
            group_settings.bond.options &&
            group_settings.bond.options.primary) {
            const iface = model.find_interface(group_settings.bond.options.primary);
            if (iface && iface.MainConnection)
                active_settings.push(iface.MainConnection.Settings);
        } else {
            Object.keys(choices)
                    .filter(choice => choices[choice])
                    .forEach(choice => {
                        const iface = model.find_interface(choice);
                        if (iface && iface.Device && iface.Device.ActiveConnection && iface.Device.ActiveConnection.Connection) {
                            active_settings.push(iface.Device.ActiveConnection.Connection.Settings);
                        }
                    });
        }

        if (active_settings.length == 1) {
            group_settings.ipv4 = JSON.parse(JSON.stringify(active_settings[0].ipv4));
            group_settings.ipv6 = JSON.parse(JSON.stringify(active_settings[0].ipv6));
        }

        group_settings.connection.autoconnect_members = 1;
    }

    /* For bonds, the order in which members are added to their group matters since the first members gets to
     * set the MAC address of the bond, which matters for DHCP.  We leave it to NetworkManager to determine
     * the order in which members are added so that the order is consistent with what happens when the bond is
     * activated the next time, such as after a reboot.
     */

    function set_all_members() {
        const deferreds = Object.keys(choices).map(iface => {
            return model.synchronize().then(function () {
                return set_member(model, group_connection, group_settings, member_type,
                                  iface, choices[iface]);
            });
        });
        return Promise.all(deferreds);
    }

    return set_all_members().then(function () {
        return apply_group(group_settings);
    });
}

export function init() {
    cockpit.translate();
}
