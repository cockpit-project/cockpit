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
import $ from 'jquery';
import React from "react";
import ReactDOM from "react-dom";
import { Switch } from "@patternfly/react-core";
import cockpit from 'cockpit';

import * as utils from './utils';
import { v4 as uuidv4 } from 'uuid';

import { mustache } from 'mustache';

/* jQuery extensions */
import 'patterns';
import 'bootstrap/dist/js/bootstrap';

import "page.scss";
import "table.css";
import "./networking.scss";
import "form-layout.scss";

const _ = cockpit.gettext;

export function show_unexpected_error(error) {
    var msg = error.message || error || "???";
    console.warn(msg);
    $("#error-popup-message").text(msg);
    $('#error-popup').prop('hidden', false);
    $('#error-popup-cancel').click(() => $('#error-popup').prop('hidden', true));
}

function select_btn(func, spec, klass) {
    var choice = spec[0] ? spec[0].choice : null;

    function option_mapper(opt) {
        return $('<option>', { value: opt.choice, 'data-value': opt.title }).text(opt.title);
    }

    var btn = $('<select class="ct-select">').append(spec.map(option_mapper));
    btn.on('change', function() {
        choice = $(this).val();
        select(choice);
        func(choice);
    });

    function select(a) {
        choice = a;
        $(btn).val(a);
    }

    function selected() {
        return choice;
    }

    select(choice);
    $.data(btn[0], 'cockpit-select-btn-funcs', { select: select, selected: selected });
    if (klass)
        btn.addClass(klass);

    return btn;
}

function select_btn_select(btn, choice) {
    $.data(btn[0], 'cockpit-select-btn-funcs').select(choice);
}

function select_btn_selected(btn) {
    return $.data(btn[0], 'cockpit-select-btn-funcs').selected();
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
 *    var manager = model.get_manager();
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
     *
     * However, we do use a fake object manager since that allows us
     * to avoid a lot of 'GetAll' round trips during initialization
     * and helps with removing obsolete objects.
     */

    var self = this;
    cockpit.event_target(self);

    var client = cockpit.dbus("org.freedesktop.NetworkManager", { superuser: "try" });
    self.client = client;

    /* resolved once first stage of initialization is done */
    self.preinit = new Promise((resolve, reject) => {
        client.call("/org/freedesktop/NetworkManager",
                    "org.freedesktop.DBus.Properties", "Get",
                    ["org.freedesktop.NetworkManager", "State"], { flags: "" })
                .fail(complain)
                .done((reply, options) => {
                    if (options.flags) {
                        if (options.flags.indexOf(">") !== -1)
                            utils.set_byteorder("be");
                        else if (options.flags.indexOf("<") !== -1)
                            utils.set_byteorder("le");
                        resolve();
                    }
                });
    });

    /* Mostly generic D-Bus stuff.  */

    var objects = { };

    function complain() {
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

    var outstanding_refreshes = 0;

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
            for (var p in type.props)
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
        var obj = objects[path];
        if (obj) {
            if (priv(obj).type.drop)
                priv(obj).type.drop(obj);
            delete objects[path];
            export_model();
        }
    }

    function set_object_properties(obj, props) {
        var p, decl, val;
        decl = priv(obj).type.props;
        for (p in decl) {
            val = props[decl[p].prop || p];
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
        var props = { };
        for (var p in props_with_sigs) {
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
        var dfd = new $.Deferred();
        client.call(objpath(obj), iface, method, Array.prototype.slice.call(arguments, 3))
                .fail(function(ex) {
                    dfd.reject(ex);
                })
                .done(function(reply) {
                    dfd.resolve.apply(dfd, reply);
                });
        return dfd.promise();
    }

    var interface_types = { };
    var max_export_phases = 0;
    var export_pending;

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
        var obj = peek_object(path);

        if (obj) {
            var type = priv(obj).type;

            if (signal == "PropertiesChanged") {
                push_refresh();
                set_object_properties(obj, remove_signatures(args[0]));
                pop_refresh();
            } else if (type.signals && type.signals[signal])
                type.signals[signal](obj, args);
        }
    }

    function interface_properties(path, iface, props) {
        var type = interface_types[iface];
        if (type)
            set_object_properties(get_object(path, type), props);
    }

    function interface_removed(path, iface) {
        /* For NetworkManager we can make this assumption */
        drop_object(path);
    }

    var export_model_deferred = null;

    function export_model() {
        function doit() {
            var phase, path, obj, exp;
            for (phase = 0; phase < max_export_phases; phase++) {
                for (path in objects) {
                    obj = objects[path];
                    exp = priv(obj).type.exporters;
                    if (exp && exp[phase])
                        exp[phase](obj);
                }
            }

            self.ready = true;
            self.dispatchEvent('changed');
            if (export_model_deferred) {
                export_model_deferred.resolve();
                export_model_deferred = null;
            }
        }

        if (!export_pending) {
            export_pending = true;
            window.setTimeout(function () { export_pending = false; doit() }, 300);
        }
    }

    self.synchronize = function synchronize() {
        if (outstanding_refreshes === 0) {
            return cockpit.resolve();
        } else {
            if (!export_model_deferred)
                export_model_deferred = cockpit.defer();
            return export_model_deferred.promise();
        }
    };

    var subscription;
    var watch;

    self.preinit.then(() => {
        subscription = client.subscribe({ }, signal_emitted);
        watch = client.watch({ });
        $(client).on("notify", function(event, data) {
            $.each(data, function(path, ifaces) {
                $.each(ifaces, function(iface, props) {
                    if (props)
                        interface_properties(path, iface, props);
                    else
                        interface_removed(path, iface);
                });
            });
        });
    });

    self.close = function close() {
        subscription.remove();
        watch.remove();
        $(client).off("notify");
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
                method:             get(first, "method", "auto"),
                ignore_auto_dns:    get(first, "ignore-auto-dns", false),
                ignore_auto_routes: get(first, "ignore-auto-routes", false),
                addresses:          get(first, "addresses", []).map(addr_from_nm),
                dns:                get(first, "dns", []).map(ip_to_text),
                dns_search:         get(first, "dns-search", []),
                routes:             get(first, "routes", []).map(route_from_nm)
            };
        }

        var result = {
            connection: {
                type:           get("connection", "type"),
                uuid:           get("connection", "uuid"),
                interface_name: get("connection", "interface-name"),
                timestamp:      get("connection", "timestamp", 0),
                id:             get("connection", "id", _("Unknown")),
                autoconnect:    get("connection", "autoconnect", true),
                autoconnect_members:
                                get("connection", "autoconnect-slaves", -1),
                member_type:    get("connection", "slave-type"),
                group:          get("connection", "master")
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
                options:        $.extend({}, get("bond", "options", { })),
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
                config:         JSON_parse_carefully(get("team", "config", "{}")),
                interface_name: get("team", "interface-name")
            };
        }

        if (settings["team-port"] || result.connection.member_type == "team") {
            result.team_port = { config:       JSON_parse_carefully(get("team-port", "config", "{}")), };
        }

        if (settings.bridge) {
            result.bridge = {
                interface_name: get("bridge", "interface-name"),
                stp:            get("bridge", "stp", true),
                priority:       get("bridge", "priority", 32768),
                forward_delay:  get("bridge", "forward-delay", 15),
                hello_time:     get("bridge", "hello-time", 2),
                max_age:        get("bridge", "max-age", 20),
                ageing_time:    get("bridge", "ageing-time", 300)
            };
        }

        if (settings["bridge-port"] || result.connection.member_type == "bridge") {
            result.bridge_port = {
                priority:       get("bridge-port", "priority", 32),
                path_cost:      get("bridge-port", "path-cost", 100),
                hairpin_mode:   get("bridge-port", "hairpin-mode", false)
            };
        }

        if (settings.vlan) {
            result.vlan = {
                parent:         get("vlan", "parent"),
                id:             get("vlan", "id"),
                interface_name: get("vlan", "interface-name")
            };
        }

        return result;
    }

    function settings_to_nm(settings, orig) {
        var result = $.extend(true, {}, orig);

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

            var addresses = settings[first].addresses;
            if (addresses)
                set(first, "addresses", addrs_sig, addresses.map(addr_to_nm));

            var dns = settings[first].dns;
            if (dns)
                set(first, "dns", ips_sig, dns.map(ip_from_text));
            set(first, "dns-search", 'as', settings[first].dns_search);

            var routes = settings[first].routes;
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
        case 14: return 'loopback';
        case 15: return 'team';
        case 16: return 'tun';
        case 17: return 'ip_tunnel';
        case 18: return 'macvlan';
        case 19: return 'vxlan';
        case 20: return 'veth';
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

    var connections_by_uuid = { };

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
                .always(pop_refresh)
                .fail(complain)
                .done(function(reply) {
                    var result = reply[0];
                    if (result) {
                        priv(obj).orig = result;
                        set_settings(obj, settings_from_nm(result));
                    }
                });
    }

    function refresh_udev(obj) {
        if (obj.Udi.indexOf("/sys/") !== 0)
            return;

        push_refresh();
        cockpit.spawn(["udevadm", "info", obj.Udi], { err: 'message' })
                .done(function(res) {
                    var props = { };
                    function snarf_prop(line, env, prop) {
                        var prefix = "E: " + env + "=";
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
                .fail(function(ex) {
                /* udevadm info exits with 4 when device doesn't exist */
                    if (ex.exit_status !== 4) {
                        console.warn(ex.message);
                        console.warn(ex);
                    }
                })
                .always(pop_refresh);
    }

    function handle_updated(obj) {
        refresh_settings(obj);
    }

    /* NetworkManager specific object types, used by the generic D-Bus
     * code and using the data conversion functions.
     */

    var type_Manager;

    var type_Ipv4Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP4Config"
        ],

        props: {
            Addresses:            { conv: conv_Array(ip4_address_from_nm), def: [] }
        }
    };

    var type_Ipv6Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP6Config"
        ],

        props: {
            Addresses:            { conv: conv_Array(ip6_address_from_nm), def: [] }
        }
    };

    var type_Connection = {
        interfaces: [
            "org.freedesktop.NetworkManager.Settings.Connection"
        ],

        props: {
            Unsaved:              { }
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
                return $.extend(true, { }, this.Settings);
            },

            apply_settings: function (settings) {
                var self = this;
                try {
                    return call_object_method(self,
                                              "org.freedesktop.NetworkManager.Settings.Connection", "Update",
                                              settings_to_nm(settings, priv(self).orig))
                            .done(function () {
                                set_settings(self, settings);
                            });
                } catch (e) {
                    return cockpit.reject(e);
                }
            },

            activate: function (dev, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(this), objpath(dev), objpath(specific_object));
            },

            delete_: function () {
                return call_object_method(this, "org.freedesktop.NetworkManager.Settings.Connection", "Delete");
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
                var group, iface;

                // Most of the time, a connection has zero or one groups,
                // but when a connection refers to its group by interface
                // name, we might end up with more than one group
                // connection so we just collect them all.
                //
                // TODO - Nail down how NM really handles this.

                function check_con(con) {
                    var group_settings = connection_settings(con);
                    var my_settings = connection_settings(obj);
                    if (group_settings.type == my_settings.member_type) {
                        obj.Groups.push(con);
                        con.Members.push(obj);
                    }
                }

                var cs = connection_settings(obj);
                if (cs.member_type) {
                    group = connections_by_uuid[cs.group];
                    if (group) {
                        obj.Groups.push(group);
                        group.Members.push(obj);
                    } else {
                        iface = peek_interface(cs.group);
                        if (iface) {
                            iface.Connections.forEach(check_con);
                        }
                    }
                }
            }
        ]

    };

    var type_ActiveConnection = {
        interfaces: [
            "org.freedesktop.NetworkManager.Connection.Active"
        ],

        props: {
            Connection:           { conv: conv_Object(type_Connection) },
            Ip4Config:            { conv: conv_Object(type_Ipv4Config) },
            Ip6Config:            { conv: conv_Object(type_Ipv6Config) }
            // See below for "Group"
        },

        prototype: {
            deactivate: function() {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "DeactivateConnection",
                                          objpath(this));
            }
        }
    };

    var type_Device = {
        interfaces: [
            "org.freedesktop.NetworkManager.Device",
            "org.freedesktop.NetworkManager.Device.Wired",
            "org.freedesktop.NetworkManager.Device.Bond",
            "org.freedesktop.NetworkManager.Device.Team",
            "org.freedesktop.NetworkManager.Device.Bridge",
            "org.freedesktop.NetworkManager.Device.Vlan"
        ],

        props: {
            DeviceType:           { conv: device_type_to_symbol },
            Interface:            { },
            StateText:            { prop: "State", conv: device_state_to_text, def: _("Unknown") },
            State:                { },
            HwAddress:            { },
            AvailableConnections: { conv: conv_Array(conv_Object(type_Connection)), def: [] },
            ActiveConnection:     { conv: conv_Object(type_ActiveConnection) },
            Ip4Config:            { conv: conv_Object(type_Ipv4Config) },
            Ip6Config:            { conv: conv_Object(type_Ipv6Config) },
            Udi:                  { trigger: refresh_udev },
            IdVendor:             { def: "" },
            IdModel:              { def: "" },
            Driver:               { def: "" },
            Carrier:              { def: true },
            Speed:                { },
            Managed:              { def: false },
            // See below for "Members"
        },

        prototype: {
            activate: function(connection, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(connection), objpath(this), objpath(specific_object));
            },

            activate_with_settings: function(settings, specific_object) {
                try {
                    return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                              "org.freedesktop.NetworkManager", "AddAndActivateConnection",
                                              settings_to_nm(settings), objpath(this), objpath(specific_object));
                } catch (e) {
                    return cockpit.reject(e);
                }
            },

            disconnect: function () {
                return call_object_method(this, 'org.freedesktop.NetworkManager.Device', 'Disconnect');
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

    var type_Interface = {
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
        var obj = get_object(":interface:" + iface, type_Interface);
        obj.Name = iface;
        return obj;
    }

    function peek_interface(iface) {
        return peek_object(":interface:" + iface);
    }

    var type_Settings = {
        interfaces: [
            "org.freedesktop.NetworkManager.Settings"
        ],

        props: {
            Connections:            { conv: conv_Array(conv_Object(type_Connection)), def: [] }
        },

        prototype: {
            add_connection: function (conf) {
                var dfd = $.Deferred();
                try {
                    call_object_method(this,
                                       'org.freedesktop.NetworkManager.Settings',
                                       'AddConnection',
                                       settings_to_nm(conf, { }))
                            .done(function (path) {
                                dfd.resolve(get_object(path, type_Connection));
                            })
                            .fail(function (error) {
                                dfd.reject(error);
                            });
                } catch (e) {
                    dfd.reject(e);
                }
                return dfd.promise();
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
                                var cons = get_interface(name)._NonDeviceConnections;
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

    type_Manager = {
        interfaces: [
            "org.freedesktop.NetworkManager"
        ],

        props: {
            Version:  { },
            Devices: {
                conv: conv_Array(conv_Object(type_Device)),
                def: []
            },
            ActiveConnections:  { conv: conv_Array(conv_Object(type_ActiveConnection)), def: [] }
        },

        prototype: {
            checkpoint_create: function (devices, timeout) {
                var dfd = $.Deferred();
                call_object_method(this,
                                   'org.freedesktop.NetworkManager',
                                   'CheckpointCreate',
                                   devices.map(objpath),
                                   timeout,
                                   0)
                        .done(function (path) {
                            dfd.resolve(path);
                        })
                        .fail(function (error) {
                            if (error.name != "org.freedesktop.DBus.Error.UnknownMethod")
                                console.warn(error.message || error);
                            dfd.resolve(null);
                        });
                return dfd.promise();
            },

            checkpoint_destroy: function (checkpoint) {
                if (checkpoint) {
                    return call_object_method(this,
                                              'org.freedesktop.NetworkManager',
                                              'CheckpointDestroy',
                                              checkpoint);
                } else
                    return $.when();
            },

            checkpoint_rollback: function (checkpoint) {
                if (checkpoint) {
                    return call_object_method(this,
                                              'org.freedesktop.NetworkManager',
                                              'CheckpointRollback',
                                              checkpoint);
                } else
                    return $.when();
            }
        },

        exporters: [
            null,

            // Sets: type_Interface.Device
            //
            function (obj) {
                obj.Devices.forEach(function (dev) {
                    if (dev.Interface) {
                        var iface = get_interface(dev.Interface);
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
        var path, obj;
        var result = [];
        for (path in objects) {
            obj = objects[path];
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

    self.ready = false;
    return self;
}

// Add a "syn_click" method to jQuery.  This will invoke the event
// handler with the additional guarantee that the model is consistent.

$.fn.extend({
    syn_click: function(model, fun) {
        return this.click(function() {
            var self = this;
            var self_args = arguments;
            model.synchronize().then(function() {
                fun.apply(self, self_args);
            });
        });
    }
});

export function syn_click(model, fun) {
    return function() {
        const self = this;
        const self_args = arguments;
        model.synchronize().then(function() {
            fun.apply(self, self_args);
        });
    };
}

export function is_managed(dev) {
    return dev.State != 10;
}

function render_interface_link(iface) {
    return $('<a tabindex="0">')
            .text(iface)
            .click(function () {
                cockpit.location.go([iface]);
            });
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
    var result = [];
    for (var i = 0; i < elts.length; i++) {
        result.push(elts[i]);
        if (i < elts.length - 1)
            result.push(sep);
    }
    return result;
}

export function render_active_connection(dev, with_link, hide_link_local) {
    var parts = [];
    var con;

    if (!dev)
        return "";

    con = dev.ActiveConnection;

    if (con && con.Group) {
        return $('<span>').append(
            $('<span>').text(_("Part of ")),
            (with_link ? render_interface_link(con.Group.Interface) : con.Group.Interface));
    }

    var ip4config = con ? con.Ip4Config : dev.Ip4Config;
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

    var ip6config = con ? con.Ip6Config : dev.Ip6Config;
    if (ip6config) {
        ip6config.Addresses.forEach(function (a) {
            if (!(hide_link_local && is_ipv6_link_local(a[0])))
                parts.push(a[0] + "/" + a[1]);
        });
    }

    return $('<span>').text(parts.join(", "));
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
            return cockpit.resolve();
        }
    };
}

export var ipv4_method_choices =
    [
        { choice: 'auto', title: _("Automatic (DHCP)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'shared', title: _("Shared") },
        { choice: 'disabled', title: _("Disabled") }
    ];

export var ipv6_method_choices =
    [
        { choice: 'auto', title: _("Automatic") },
        { choice: 'dhcp', title: _("Automatic (DHCP only)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'ignore', title: _("Ignore") }
    ];

export var bond_mode_choices =
    [
        { choice: 'balance-rr', title: _("Round robin") },
        { choice: 'active-backup', title: _("Active backup") },
        { choice: 'balance-xor', title: _("XOR") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: '802.3ad', title: _("802.3ad") },
        { choice: 'balance-tlb', title: _("Adaptive transmit load balancing") },
        { choice: 'balance-alb', title: _("Adaptive load balancing") }
    ];

export var bond_monitoring_choices =
    [
        { choice: 'mii', title: _("MII (recommended)") },
        { choice: 'arp', title: _("ARP") }
    ];

export var team_runner_choices =
    [
        { choice: 'roundrobin', title: _("Round robin") },
        { choice: 'activebackup', title: _("Active backup") },
        { choice: 'loadbalance', title: _("Load balancing") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: 'lacp', title: _("802.3ad LACP") },
    ];

export var team_balancer_choices =
    [
        { choice: 'none', title: _("Passive") },
        { choice: 'basic', title: _("Active") }
    ];

export var team_watch_choices =
    [
        { choice: 'ethtool', title: _("Ethtool") },
        { choice: 'arp-ping', title: _("ARP ping") },
        { choice: 'nsna-ping', title: _("NSNA ping") }
    ];

export function choice_title(choices, choice, def) {
    for (var i = 0; i < choices.length; i++) {
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

var curtain_time = 1.5;
var settle_time = 1.0;
var rollback_time = 7.0;

export function with_checkpoint(model, modify, options) {
    var manager = model.get_manager();
    var curtain = $('#testing-connection-curtain');
    var curtain_testing = $('#testing-connection-curtain-testing');
    var curtain_restoring = $('#testing-connection-curtain-restoring');
    var dialog = $('#confirm-breaking-change-popup');

    var curtain_timeout;
    var curtain_title_timeout;

    function show_curtain() {
        cockpit.hint("ignore_transport_health_check", { data: true });
        curtain_timeout = window.setTimeout(function () {
            curtain_timeout = null;
            curtain_testing.prop('hidden', false);
            curtain_restoring.prop('hidden', true);
            curtain.prop('hidden', false);
        }, curtain_time * 1000);
        curtain_title_timeout = window.setTimeout(function () {
            curtain_title_timeout = null;
            curtain_testing.prop('hidden', true);
            curtain_restoring.prop('hidden', false);
        }, rollback_time * 1000);
    }

    function hide_curtain() {
        if (curtain_timeout)
            window.clearTimeout(curtain_timeout);
        curtain_timeout = null;
        if (curtain_title_timeout)
            window.clearTimeout(curtain_title_timeout);
        curtain.prop('hidden', true);
        cockpit.hint("ignore_transport_health_check", { data: false });
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
            .done(function (cp) {
                if (!cp) {
                    modify();
                    return;
                }

                show_curtain();
                modify()
                        .then(function () {
                            window.setTimeout(function () {
                                manager.checkpoint_destroy(cp)
                                        .always(hide_curtain)
                                        .fail(function () {
                                            dialog.find('#confirm-breaking-change-text').html(options.fail_text);
                                            dialog.find('.pf-c-modal-box__footer button.pf-m-danger')
                                                    .off('click')
                                                    .text(options.anyway_text)
                                                    .syn_click(model, function () {
                                                        dialog.prop('hidden', true);
                                                        modify();
                                                    });
                                            dialog.prop('hidden', false);
                                        });
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

export function switchbox(val, callback) {
    var onoff = $('<span>');
    var disabled = false;
    function render () {
        ReactDOM.render(
            React.createElement(Switch, {
                isChecked: val,
                isDisabled: disabled,
                onChange: callback
            }),
            onoff[0]);
    }
    onoff.enable = function (val) {
        disabled = !val;
        render();
    };
    render();
    return onoff;
}

function with_settings_checkpoint(model, modify, options) {
    with_checkpoint(model, modify,
                    $.extend(
                        {
                            fail_text: _("Changing the settings will break the connection to the server, and will make the administration UI unavailable."),
                            anyway_text: _("Change the settings"),
                        }, options));
}

function show_dialog_error(error_id, error) {
    var msg = error.message || error.toString();
    console.warn(msg);
    $(error_id).prop('hidden', false)
            .find('h4')
            .text(msg);
}

function connection_devices(con) {
    var devices = [];

    if (con)
        con.Interfaces.forEach(function (iface) { if (iface.Device) devices.push(iface.Device); });

    return devices;
}

PageNetworkIpSettings.prototype = {
    _init: function () {
        this.id = "network-ip-settings-dialog";
    },

    setup: function () {
        $('#network-ip-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-ip-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-ip-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-ip-settings-error').prop('hidden', true);
        this.settings = PageNetworkIpSettings.ghost_settings || PageNetworkIpSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var topic = PageNetworkIpSettings.topic;
        var params = self.settings[topic];

        var addresses_table;
        var auto_dns_btn, dns_table;
        var auto_dns_search_btn, dns_search_table;
        var auto_routes_btn, routes_table;

        function choicebox(p, choices) {
            var btn = select_btn(
                function (choice) {
                    params[p] = choice;
                    self.update();
                },
                choices);
            btn.addClass("col-left");
            select_btn_select(btn, params[p]);
            return btn;
        }

        function inverted_switchbox(title, p) {
            var onoff;
            var btn = $('<span>').append(
                $('<span class="inverted-switchbox">').text(title),
                onoff = switchbox(!params[p], function(val) {
                    params[p] = !val;
                    self.update();
                }));
            btn.enable = function enable(val) {
                onoff.enable(val);
            };
            return btn;
        }

        function tablebox(title, p, columns, def, header_buttons) {
            var direct = false;
            var add_btn;

            if (typeof columns == "string") {
                direct = true;
                columns = [columns];
            }

            function get(i, j) {
                if (direct)
                    return params[p][i];
                else
                    return params[p][i][j];
            }

            function set(i, j, val) {
                if (direct)
                    params[p][i] = val;
                else
                    params[p][i][j] = val;
            }

            function add() {
                return function() {
                    params[p].push(def);
                    self.update();
                };
            }

            function remove(index) {
                return function () {
                    params[p].splice(index, 1);
                    self.update();
                };
            }

            var panel =
                $('<div class="network-ip-settings-row">').append(
                    $('<div>').append(
                        $('<strong>').text(title),
                        $('<div class="pull-right">').append(
                            header_buttons,
                            add_btn = $('<button class="pf-c-button pf-m-secondary btn-sm">')
                                    .append('<span class="fa fa-plus">')
                                    .css("margin-left", "10px")
                                    .click(add()))),
                    $('<table width="100%">').append(
                        params[p].map(function (a, i) {
                            return ($('<tr>').append(
                                columns.map(function (c, j) {
                                    return $('<td>').append(
                                        $('<input class="form-control">')
                                                .val(get(i, j))
                                                .attr('placeholder', c)
                                                .change(function (event) {
                                                    set(i, j, $(event.target).val());
                                                }));
                                }),
                                $('<td>').append(
                                    $('<button class="pf-c-button pf-m-secondary btn-sm">')
                                            .append('<span class="fa fa-minus">')
                                            .click(remove(i)))));
                        })));

            // For testing
            panel.attr("data-field", p);

            panel.enable_add = function enable_add(val) {
                add_btn.prop('disabled', !val);
            };

            return panel;
        }

        function render_ip_settings() {
            var prefix_text = (topic == "ipv4") ? _("Prefix length or netmask") : _("Prefix length");
            var body =
                $('<div>').append(
                    addresses_table = tablebox(_("Addresses"), "addresses", ["Address", prefix_text, "Gateway"],
                                               ["", "", ""],
                                               choicebox("method", (topic == "ipv4")
                                                   ? ipv4_method_choices : ipv6_method_choices)
                                                       .css('display', 'inline-block')),
                    $('<br>'),
                    dns_table =
                        tablebox(_("DNS"), "dns", "Server", "",
                                 auto_dns_btn = inverted_switchbox(_("Automatic"), "ignore_auto_dns")),
                    $('<br>'),
                    dns_search_table =
                        tablebox(_("DNS search domains"), "dns_search", "Search Domain", "",
                                 auto_dns_search_btn = inverted_switchbox(_("Automatic"),
                                                                          "ignore_auto_dns")),
                    $('<br>'),
                    routes_table =
                        tablebox(_("Routes"), "routes",
                                 ["Address", prefix_text, "Gateway", "Metric"], ["", "", "", ""],
                                 auto_routes_btn = inverted_switchbox(_("Automatic"), "ignore_auto_routes")));
            return body;
        }

        // The manual method needs at least one address
        //
        if (params.method == "manual" && params.addresses.length === 0)
            params.addresses = [["", "", ""]];

        // The link local, shared, and disabled methods can't take any
        // addresses, dns servers, or dns search domains.  Routes,
        // however, are ok, even for "disabled" and "ignored".  But
        // since that doesn't make sense, we remove routes as well for
        // these methods.

        var is_off = (params.method == "disabled" ||
                      params.method == "ignore");

        var can_have_extra = !(params.method == "link-local" ||
                               params.method == "shared" ||
                               is_off);

        if (!can_have_extra) {
            params.addresses = [];
            params.dns = [];
            params.dns_search = [];
        }
        if (is_off) {
            params.routes = [];
        }

        $('#network-ip-settings-dialog .pf-c-modal-box__title').text(
            (topic == "ipv4") ? _("IPv4 settings") : _("IPv6 settings"));
        $('#network-ip-settings-body').html(render_ip_settings());

        // The auto_*_btns only make sense when the address method
        // is "auto" or "dhcp".
        //
        var can_auto = (params.method == "auto" || params.method == "dhcp");
        auto_dns_btn.enable(can_auto);
        auto_dns_search_btn.enable(can_auto);
        auto_routes_btn.enable(can_auto);

        addresses_table.enable_add(can_have_extra);
        dns_table.enable_add(can_have_extra);
        dns_search_table.enable_add(can_have_extra);
        routes_table.enable_add(!is_off);
    },

    cancel: function() {
        $('#network-ip-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;

        function modify() {
            return PageNetworkIpSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-ip-settings-dialog').trigger('hide');
                        if (PageNetworkIpSettings.done)
                            return PageNetworkIpSettings.done();
                    })
                    .fail(function (error) {
                        show_dialog_error('#network-ip-settings-error', error);
                    });
        }

        with_settings_checkpoint(PageNetworkIpSettings.model, modify,
                                 { devices: connection_devices(PageNetworkIpSettings.connection) });
    }

};

export function PageNetworkIpSettings() {
    this._init();
}

export function is_interface_connection(iface, connection) {
    return connection && connection.Interfaces.indexOf(iface) != -1;
}

export function is_interesting_interface(iface) {
    return !iface.Device || is_managed(iface.Device);
}

export function array_find(array, predicate) {
    if (array === null || array === undefined) {
        throw new TypeError('Array.prototype.find called on null or undefined');
    }
    if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
    }
    var list = Object(array);
    var length = list.length >>> 0;
    var thisArg = arguments[1];
    var value;

    for (var i = 0; i < length; i++) {
        if (i in list) {
            value = list[i];
            if (predicate.call(thisArg, value, i, list)) {
                return value;
            }
        }
    }
    return undefined;
}

export function member_connection_for_interface(group, iface) {
    return group && array_find(group.Members, function (s) {
        return is_interface_connection(iface, s);
    });
}

export function member_interface_choices(model, group) {
    return model.list_interfaces().filter(function (iface) {
        return !is_interface_connection(iface, group) && is_interesting_interface(iface);
    });
}

export function render_member_interface_choices(model, group) {
    return $('<ul class="list-group dialog-list-ct">').append(
        member_interface_choices(model, group).map(function (iface) {
            return $('<li class="list-group-item">').append(
                $('<div class="checkbox">')
                        .css('margin', "0px")
                        .append(
                            $('<label>').append(
                                $('<input>', {
                                    type: "checkbox",
                                    'data-iface': iface.Name
                                })
                                        .prop('checked', !!member_connection_for_interface(group, iface)),
                                $('<span>').text(iface.Name))));
        }));
}

export function member_chooser_btn(change, member_choices) {
    var choices = [{ title: "-", choice: "", is_default: true }];
    member_choices.find('input[data-iface]').each(function (i, elt) {
        var name = $(elt).attr("data-iface");
        if ($(elt).prop('checked'))
            choices.push({ title: name, choice: name });
    });
    return select_btn(change, choices, "form-control");
}

export function free_member_connection(con) {
    var cs = connection_settings(con);
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
    var iface;
    var main_connection;

    iface = model.find_interface(iface_name);
    if (!iface)
        return false;

    main_connection = iface.MainConnection;

    if (val) {
        /* Turn the main_connection into a member for group.
         */

        var group_iface;
        if (group_connection) {
            group_iface = group_connection.Interfaces[0].Name;
        } else {
            group_iface = group_settings.connection.interface_name;
        }

        if (!group_iface)
            return false;

        var member_settings;
        if (main_connection) {
            member_settings = main_connection.Settings;

            if (member_settings.connection.group == group_settings.connection.uuid ||
                member_settings.connection.group == group_settings.connection.id ||
                member_settings.connection.group == group_iface)
                return cockpit.resolve();

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
                                   member_type: member_type,
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
                var group_dev = group_connection.Interfaces[0].Device;
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

function apply_group_member(choices, model, apply_group, group_connection, group_settings, member_type) {
    var active_settings = [];
    var iface;

    if (!group_connection) {
        if (group_settings.bond &&
            group_settings.bond.options &&
            group_settings.bond.options.primary) {
            iface = model.find_interface(group_settings.bond.options.primary);
            if (iface && iface.MainConnection)
                active_settings.push(iface.MainConnection.Settings);
        } else {
            choices.find('input[data-iface]').map(function (i, elt) {
                var iface;
                if ($(elt).prop('checked')) {
                    iface = model.find_interface($(elt).attr("data-iface"));
                    if (iface && iface.Device && iface.Device.ActiveConnection && iface.Device.ActiveConnection.Connection) {
                        active_settings.push(iface.Device.ActiveConnection.Connection.Settings);
                    }
                }
            });
        }

        if (active_settings.length == 1) {
            group_settings.ipv4 = $.extend(true, { }, active_settings[0].ipv4);
            group_settings.ipv6 = $.extend(true, { }, active_settings[0].ipv6);
        }

        group_settings.connection.autoconnect_members = 1;
    }

    /* For bonds, the order in which members are added to their group matters since the first members gets to
     * set the MAC address of the bond, which matters for DHCP.  We leave it to NetworkManager to determine
     * the order in which members are added so that the order is consistent with what happens when the bond is
     * activated the next time, such as after a reboot.
     */

    function set_all_members() {
        var deferreds = choices.find('input[data-iface]').map(function (i, elt) {
            return model.synchronize().then(function () {
                return set_member(model, group_connection, group_settings, member_type,
                                  $(elt).attr("data-iface"), $(elt).prop('checked'));
            });
        });
        return Promise.all(deferreds.get());
    }

    return set_all_members().then(function () {
        return apply_group(group_settings);
    });
}

function fill_mac_menu(menu, input, model) {
    menu.empty();

    function menu_append(title, value) {
        menu.append(
            $('<li class="presentation">').append(
                $('<a tabindex="0">')
                        .text(title)
                        .click(function () {
                            input.val(value).trigger("change");
                        })));
    }

    model.list_interfaces().forEach(function (iface) {
        if (iface.Device && iface.Device.HwAddress && iface.Device.HwAddress !== "00:00:00:00:00:00")
            menu_append(cockpit.format("$0 ($1)", iface.Device.HwAddress, iface.Name), iface.Device.HwAddress);
    });

    menu_append(_("Permanent"), "permanent");
    menu_append(_("Preserve"), "preserve");
    menu_append(_("Random"), "random");
    menu_append(_("Stable"), "stable");
}

PageNetworkBondSettings.prototype = {
    _init: function () {
        this.id = "network-bond-settings-dialog";
        this.bond_settings_template = $("#network-bond-settings-template").html();
        mustache.parse(this.bond_settings_template);
    },

    setup: function () {
        $('#network-bond-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-bond-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bond-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bond-settings-error').prop('hidden', true);
        this.settings = PageNetworkBondSettings.ghost_settings || PageNetworkBondSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_member_con: function(iface) {
        if (!PageNetworkBondSettings.connection)
            return null;

        return array_find(PageNetworkBondSettings.connection.Members, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkBondSettings.model;
        var group = PageNetworkBondSettings.connection;
        var options = self.settings.bond.options;

        var members_element;
        var mac_input, mode_btn, primary_btn;
        var monitoring_btn, interval_input, targets_input, updelay_input, downdelay_input;

        function change_members() {
            var btn = member_chooser_btn(change_mode, members_element);
            primary_btn.replaceWith(btn);
            primary_btn = btn;
            select_btn_select(primary_btn, options.primary);
            change_mode();
            self.members_changed = true;
        }

        function change_mac() {
            console.log("mac");
            if (!self.settings.ethernet)
                self.settings.ethernet = { };
            self.settings.ethernet.assigned_mac_address = mac_input.val();
        }

        function change_mode() {
            options.mode = select_btn_selected(mode_btn);

            primary_btn.toggle(options.mode == "active-backup");
            primary_btn.prev().toggle(options.mode == "active-backup");
            if (options.mode == "active-backup")
                options.primary = select_btn_selected(primary_btn);
            else
                delete options.primary;
        }

        function change_monitoring() {
            var use_mii = select_btn_selected(monitoring_btn) == "mii";

            targets_input.toggle(!use_mii);
            targets_input.prev().toggle(!use_mii);
            updelay_input.toggle(use_mii);
            updelay_input.prev().toggle(use_mii);
            downdelay_input.toggle(use_mii);
            downdelay_input.prev().toggle(use_mii);

            if (use_mii) {
                options.miimon = interval_input.val();
                options.updelay = updelay_input.val();
                options.downdelay = downdelay_input.val();
                delete options.arp_interval;
                delete options.arp_ip_target;
            } else {
                delete options.miimon;
                delete options.updelay;
                delete options.downdelay;
                options.arp_interval = interval_input.val();
                options.arp_ip_target = targets_input.val();
            }
        }

        var mac = (self.settings.ethernet && self.settings.ethernet.assigned_mac_address) || "";
        var body = $(mustache.render(self.bond_settings_template, {
            interface_name: self.settings.bond.interface_name,
            assigned_mac_address: mac,
            monitoring_interval: options.miimon || options.arp_interval || "100",
            monitoring_target: options.arp_ip_target,
            link_up_delay: options.updelay || "0",
            link_down_delay: options.downdelay || "0"
        }));
        body.find('#network-bond-settings-interface-name-input')
                .change(function (event) {
                    var val = $(event.target).val();
                    self.settings.bond.interface_name = val;
                    self.settings.connection.id = val;
                    self.settings.connection.interface_name = val;
                });
        body.find('#network-bond-settings-members')
                .replaceWith(members_element = render_member_interface_choices(model, group)
                        .change(change_members));
        fill_mac_menu(body.find('#network-bond-settings-mac-menu'),
                      mac_input = body.find('#network-bond-settings-mac-input'),
                      model);
        mac_input.change(change_mac);
        body.find('#network-bond-settings-mode-select')
                .replaceWith(mode_btn = select_btn(change_mode, bond_mode_choices, "form-control"));
        body.find('#network-bond-settings-primary-select')
                .replaceWith(primary_btn = member_chooser_btn(change_mode, members_element, "form-control"));
        body.find('#network-bond-settings-link-monitoring-select')
                .replaceWith(monitoring_btn = select_btn(change_monitoring, bond_monitoring_choices, "form-control"));
        mode_btn.attr("id", "network-bond-settings-mode-select");
        primary_btn.attr("id", "network-bond-settings-primary-select");
        monitoring_btn.attr("id", "network-bond-settings-link-monitoring-select");

        interval_input = body.find('#network-bond-settings-monitoring-interval-input');
        interval_input.change(change_monitoring);
        targets_input = body.find('#network-bond-settings-monitoring-targets-input');
        targets_input.change(change_monitoring);
        updelay_input = body.find('#network-bond-settings-link-up-delay-input');
        updelay_input.change(change_monitoring);
        downdelay_input = body.find('#network-bond-settings-link-down-delay-input');
        downdelay_input.change(change_monitoring);

        select_btn_select(mode_btn, options.mode);
        select_btn_select(monitoring_btn, options.arp_interval ? "arp" : "mii");
        change_members();
        change_mode();
        change_monitoring();

        self.members_changed = false;

        $('#network-bond-settings-body').html(body);
    },

    cancel: function() {
        $('#network-bond-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;

        function modify() {
            return apply_group_member($('#network-bond-settings-body'),
                                      PageNetworkBondSettings.model,
                                      PageNetworkBondSettings.apply_settings,
                                      PageNetworkBondSettings.connection,
                                      self.settings,
                                      "bond")
                    .then(function() {
                        $('#network-bond-settings-dialog').trigger('hide');
                        if (PageNetworkBondSettings.connection)
                            cockpit.location.go([self.settings.connection.interface_name]);
                        if (PageNetworkBondSettings.done)
                            return PageNetworkBondSettings.done();
                    })
                    .catch(function (error) {
                        show_dialog_error('#network-bond-settings-error', error);
                    });
        }

        if (PageNetworkBondSettings.connection) {
            with_settings_checkpoint(PageNetworkBondSettings.model, modify,
                                     {
                                         devices: (self.members_changed
                                             ? [] : connection_devices(PageNetworkBondSettings.connection)),
                                         hack_does_add_or_remove: self.members_changed,
                                         rollback_on_failure: self.members_changed
                                     });
        } else {
            with_checkpoint(
                PageNetworkBondSettings.model,
                modify,
                {
                    fail_text: _("Creating this bond will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true,
                    rollback_on_failure: true
                });
        }
    }

};

export function PageNetworkBondSettings() {
    this._init();
}

PageNetworkTeamSettings.prototype = {
    _init: function () {
        this.id = "network-team-settings-dialog";
        this.team_settings_template = $("#network-team-settings-template").html();
        mustache.parse(this.team_settings_template);
    },

    setup: function () {
        $('#network-team-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-team-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-team-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-team-settings-error').prop('hidden', true);
        this.settings = PageNetworkTeamSettings.ghost_settings || PageNetworkTeamSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_member_con: function(iface) {
        if (!PageNetworkTeamSettings.connection)
            return null;

        return array_find(PageNetworkTeamSettings.connection.Members, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkTeamSettings.model;
        var group = PageNetworkTeamSettings.connection;
        var config = self.settings.team.config;

        var runner_btn, balancer_btn, watch_btn;
        var interval_input, target_input, updelay_input, downdelay_input;

        if (!config)
            self.settings.team.config = config = { };
        if (!config.runner)
            config.runner = { };
        if (!config.runner.name)
            config.runner.name = "activebackup";
        if (!config.link_watch)
            config.link_watch = { };
        if (!config.link_watch.name)
            config.link_watch.name = "ethtool";
        if (config.link_watch.interval === undefined)
            config.link_watch.interval = 100;
        if (config.link_watch.delay_up === undefined)
            config.link_watch.delay_up = 0;
        if (config.link_watch.delay_down === undefined)
            config.link_watch.delay_down = 0;

        function change_members() {
            self.members_changed = true;
        }

        function change_runner() {
            config.runner.name = select_btn_selected(runner_btn);
            var toggle_condition = config.runner.name == "loadbalance" || config.runner.name == "lacp";
            balancer_btn.toggle(toggle_condition);
            balancer_btn.prev().toggle(toggle_condition);
        }

        function change_balancer() {
            var balancer = select_btn_selected(balancer_btn);
            if (balancer == "none") {
                if (config.runner.tx_balancer)
                    delete config.runner.tx_balancer.name;
            } else {
                if (!config.runner.tx_balancer)
                    config.runner.tx_balancer = { };
                config.runner.tx_balancer.name = balancer;
            }
        }

        function change_watch() {
            var name = select_btn_selected(watch_btn);
            var toggle_condition = name != "ethtool";

            interval_input.toggle(toggle_condition);
            interval_input.prev().toggle(toggle_condition);
            target_input.toggle(toggle_condition);
            target_input.prev().toggle(toggle_condition);
            updelay_input.toggle(!toggle_condition);
            updelay_input.prev().toggle(!toggle_condition);
            downdelay_input.toggle(!toggle_condition);
            downdelay_input.prev().toggle(!toggle_condition);

            config.link_watch = { name: name };

            if (name == "ethtool") {
                config.link_watch.delay_up = updelay_input.val();
                config.link_watch.delay_down = downdelay_input.val();
            } else {
                config.link_watch.interval = interval_input.val();
                config.link_watch.target_host = target_input.val();
            }
        }

        var body = $(mustache.render(self.team_settings_template,
                                     {
                                         interface_name: self.settings.team.interface_name,
                                         config: config
                                     }));
        body.find('#network-team-settings-interface-name-input')
                .change(function (event) {
                    var val = $(event.target).val();
                    self.settings.team.interface_name = val;
                    self.settings.connection.id = val;
                    self.settings.connection.interface_name = val;
                });
        body.find('#network-team-settings-members')
                .replaceWith(render_member_interface_choices(model, group).change(change_members));
        body.find('#network-team-settings-runner-select')
                .replaceWith(runner_btn = select_btn(change_runner, team_runner_choices, "form-control"));
        body.find('#network-team-settings-balancer-select')
                .replaceWith(balancer_btn = select_btn(change_balancer, team_balancer_choices, "form-control"));
        body.find('#network-team-settings-link-watch-select')
                .replaceWith(watch_btn = select_btn(change_watch, team_watch_choices, "form-control"));
        runner_btn.attr("id", "network-team-settings-runner-select");
        balancer_btn.attr("id", "network-team-settings-balancer-select");
        watch_btn.attr("id", "network-team-settings-link-watch-select");

        interval_input = body.find('#network-team-settings-ping-interval-input');
        interval_input.change(change_watch);
        target_input = body.find('#network-team-settings-ping-target-input');
        target_input.change(change_watch);
        updelay_input = body.find('#network-team-settings-link-up-delay-input');
        updelay_input.change(change_watch);
        downdelay_input = body.find('#network-team-settings-link-down-delay-input');
        downdelay_input.change(change_watch);

        select_btn_select(runner_btn, config.runner.name);
        select_btn_select(balancer_btn, (config.runner.tx_balancer && config.runner.tx_balancer.name) || "none");
        select_btn_select(watch_btn, config.link_watch.name);
        change_runner();
        change_watch();

        self.members_changed = false;

        $('#network-team-settings-body').html(body);
    },

    cancel: function() {
        $('#network-team-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;

        function modify () {
            return apply_group_member($('#network-team-settings-body'),
                                      PageNetworkTeamSettings.model,
                                      PageNetworkTeamSettings.apply_settings,
                                      PageNetworkTeamSettings.connection,
                                      self.settings,
                                      "team")
                    .then(function() {
                        $('#network-team-settings-dialog').trigger('hide');
                        if (PageNetworkTeamSettings.connection)
                            cockpit.location.go([self.settings.connection.interface_name]);
                        if (PageNetworkTeamSettings.done)
                            return PageNetworkTeamSettings.done();
                    })
                    .catch(function (error) {
                        show_dialog_error('#network-team-settings-error', error);
                    });
        }

        if (PageNetworkTeamSettings.connection) {
            with_settings_checkpoint(PageNetworkTeamSettings.model, modify,
                                     {
                                         devices: (self.members_changed
                                             ? [] : connection_devices(PageNetworkTeamSettings.connection)),
                                         hack_does_add_or_remove: self.members_changed,
                                         rollback_on_failure: self.members_changed
                                     });
        } else {
            with_checkpoint(
                PageNetworkTeamSettings.model,
                modify,
                {
                    fail_text: _("Creating this team will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true,
                    rollback_on_failure: true
                });
        }
    }

};

export function PageNetworkTeamSettings() {
    this._init();
}

PageNetworkTeamPortSettings.prototype = {
    _init: function () {
        this.id = "network-teamport-settings-dialog";
        this.team_port_settings_template = $("#network-team-port-settings-template").html();
        mustache.parse(this.team_port_settings_template);
    },

    setup: function () {
        $('#network-teamport-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-teamport-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-teamport-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-teamport-settings-error').prop('hidden', true);
        this.settings = PageNetworkTeamPortSettings.ghost_settings || PageNetworkTeamPortSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var group_config = PageNetworkTeamPortSettings.group_settings.team.config;
        var config = self.settings.team_port.config;

        var ab_prio_input, ab_sticky_input, lacp_prio_input, lacp_key_input;

        if (!config)
            self.settings.team_port.config = config = { };

        function change() {
            // XXX - handle parse errors
            if (group_config.runner.name == "activebackup") {
                config.prio = parseInt(ab_prio_input.val(), 10);
                config.sticky = ab_sticky_input.prop('checked');
            } else if (group_config.runner.name == "lacp") {
                config.lacp_prio = parseInt(lacp_prio_input.val(), 10);
                config.lacp_key = parseInt(lacp_key_input.val(), 10);
            }
        }

        var body = $(mustache.render(self.team_port_settings_template, config));
        ab_prio_input = body.find('#network-team-port-settings-ab-prio-input');
        ab_prio_input.change(change);
        ab_sticky_input = body.find('#network-team-port-settings-ab-sticky-input');
        ab_sticky_input.change(change);
        lacp_prio_input = body.find('#network-team-port-settings-lacp-prio-input');
        lacp_prio_input.change(change);
        lacp_key_input = body.find('#network-team-port-settings-lacp-key-input');
        lacp_key_input.change(change);

        ab_prio_input.toggle(group_config.runner.name == "activebackup");
        ab_prio_input.prev().toggle(group_config.runner.name == "activebackup");
        ab_sticky_input.toggle(group_config.runner.name == "activebackup");
        ab_sticky_input
                .parent()
                .prev()
                .toggle(group_config.runner.name == "activebackup");
        lacp_prio_input.toggle(group_config.runner.name == "lacp");
        lacp_prio_input.prev().toggle(group_config.runner.name == "lacp");
        lacp_key_input.toggle(group_config.runner.name == "lacp");
        lacp_key_input.prev().toggle(group_config.runner.name == "lacp");

        $('#network-teamport-settings-body').html(body);
    },

    cancel: function() {
        $('#network-teamport-settings-dialog').prop('hidden', true);
    },

    apply: function() {
        var self = this;
        var model = PageNetworkTeamPortSettings.model;

        function modify () {
            return PageNetworkTeamPortSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-teamport-settings-dialog').trigger('hide');
                        if (PageNetworkTeamPortSettings.done)
                            return PageNetworkTeamPortSettings.done();
                    })
                    .fail(function (error) {
                        show_dialog_error('#network-teamport-settings-error', error);
                    });
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkTeamPortSettings.connection) });
    }
};

export function PageNetworkTeamPortSettings() {
    this._init();
}

PageNetworkBridgeSettings.prototype = {
    _init: function () {
        this.id = "network-bridge-settings-dialog";
        this.bridge_settings_template = $("#network-bridge-settings-template").html();
        mustache.parse(this.bridge_settings_template);
    },

    setup: function () {
        $('#network-bridge-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-bridge-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridge-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridge-settings-error').prop('hidden', true);
        this.settings = PageNetworkBridgeSettings.ghost_settings || PageNetworkBridgeSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_member_con: function(iface) {
        if (!PageNetworkBridgeSettings.connection)
            return null;

        return array_find(PageNetworkBridgeSettings.connection.Members, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkBridgeSettings.model;
        var con = PageNetworkBridgeSettings.connection;
        var options = self.settings.bridge;

        var stp_input, priority_input, forward_delay_input, hello_time_input, max_age_input;

        function change_members() {
            self.members_changed = true;
        }

        function change_stp() {
            // XXX - handle parse errors
            options.stp = stp_input.prop('checked');
            options.priority = parseInt(priority_input.val(), 10);
            options.forward_delay = parseInt(forward_delay_input.val(), 10);
            options.hello_time = parseInt(hello_time_input.val(), 10);
            options.max_age = parseInt(max_age_input.val(), 10);

            priority_input.toggle(options.stp);
            priority_input.prev().toggle(options.stp);
            forward_delay_input.toggle(options.stp);
            forward_delay_input.prev().toggle(options.stp);
            hello_time_input.toggle(options.stp);
            hello_time_input.prev().toggle(options.stp);
            max_age_input.toggle(options.stp);
            max_age_input.prev().toggle(options.stp);
        }

        var body = $(mustache.render(self.bridge_settings_template, {
            bridge_name: options.interface_name,
            stp_checked: options.stp,
            stp_priority: options.priority,
            stp_forward_delay: options.forward_delay,
            stp_hello_time: options.hello_time,
            stp_max_age: options.max_age
        }));
        body.find('#network-bridge-settings-name-input')
                .change(function (event) {
                    var val = $(event.target).val();
                    options.interface_name = val;
                    self.settings.connection.id = val;
                    self.settings.connection.interface_name = val;
                });
        var member_interfaces = body.find('#network-bridge-settings-member-interfaces')
                .replaceWith(render_member_interface_choices(model, con).change(change_members));
        member_interfaces.toggle(!con);
        member_interfaces.prev().toggle(!con);

        stp_input = body.find('#network-bridge-settings-stp-enabled-input');
        stp_input.change(change_stp);
        priority_input = body.find('#network-bridge-settings-stp-priority-input');
        priority_input.change(change_stp);
        forward_delay_input = body.find('#network-bridge-settings-stp-forward-delay-input');
        forward_delay_input.change(change_stp);
        hello_time_input = body.find('#network-bridge-settings-stp-hello-time-input');
        hello_time_input.change(change_stp);
        max_age_input = body.find('#network-bridge-settings-stp-max-age-input');
        max_age_input.change(change_stp);

        change_stp();

        self.members_changed = false;

        $('#network-bridge-settings-body').html(body);
    },

    cancel: function() {
        $('#network-bridge-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;

        function modify () {
            return apply_group_member($('#network-bridge-settings-body'),
                                      PageNetworkBridgeSettings.model,
                                      PageNetworkBridgeSettings.apply_settings,
                                      PageNetworkBridgeSettings.connection,
                                      self.settings,
                                      "bridge")
                    .then(function() {
                        $('#network-bridge-settings-dialog').trigger('hide');
                        if (PageNetworkBridgeSettings.connection)
                            cockpit.location.go([self.settings.connection.interface_name]);
                        if (PageNetworkBridgeSettings.done)
                            return PageNetworkBridgeSettings.done();
                    })
                    .catch(function (error) {
                        $('#network-bridge-settings-error').prop('hidden', false)
                                .find('h4')
                                .text(error.message || error.toString());
                    });
        }

        if (PageNetworkBridgeSettings.connection) {
            with_settings_checkpoint(PageNetworkBridgeSettings.model, modify,
                                     {
                                         devices: (self.members_changed
                                             ? [] : connection_devices(PageNetworkBridgeSettings.connection)),
                                         hack_does_add_or_remove: self.members_changed,
                                         rollback_on_failure: self.members_changed
                                     });
        } else {
            with_checkpoint(
                PageNetworkBridgeSettings.model,
                modify,
                {
                    fail_text: _("Creating this bridge will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true,
                    rollback_on_failure: true
                });
        }
    }

};

export function PageNetworkBridgeSettings() {
    this._init();
}

PageNetworkBridgePortSettings.prototype = {
    _init: function () {
        this.id = "network-bridgeport-settings-dialog";
        this.bridge_port_settings_template = $("#network-bridge-port-settings-template").html();
        mustache.parse(this.bridge_port_settings_template);
    },

    setup: function () {
        $('#network-bridgeport-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-bridgeport-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridgeport-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridgeport-settings-error').prop('hidden', true);
        this.settings = PageNetworkBridgePortSettings.ghost_settings || PageNetworkBridgePortSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var options = self.settings.bridge_port;

        var priority_input, path_cost_input, hairpin_mode_input;

        function change() {
            // XXX - handle parse errors
            options.priority = parseInt(priority_input.val(), 10);
            options.path_cost = parseInt(path_cost_input.val(), 10);
            options.hairpin_mode = hairpin_mode_input.prop('checked');
        }

        var body = $(mustache.render(self.bridge_port_settings_template, {
            priority: options.priority,
            path_cost: options.path_cost,
            hairpin_mode_checked: options.hairpin_mode
        }));
        priority_input = body.find('#network-bridge-port-settings-priority-input');
        priority_input.change(change);
        path_cost_input = body.find('#network-bridge-port-settings-path-cost-input');
        path_cost_input.change(change);
        hairpin_mode_input = body.find('#network-bridge-port-settings-hairpin-mode-input');
        hairpin_mode_input.change(change);

        $('#network-bridgeport-settings-body').html(body);
    },

    cancel: function() {
        $('#network-bridgeport-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkBridgePortSettings.model;

        function modify () {
            return PageNetworkBridgePortSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-bridgeport-settings-dialog').trigger('hide');
                        if (PageNetworkBridgePortSettings.done)
                            return PageNetworkBridgePortSettings.done();
                    })
                    .fail(function (error) {
                        show_dialog_error('#network-bridgeport-settings-error', error);
                    });
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkBridgePortSettings.connection) });
    }

};

export function PageNetworkBridgePortSettings() {
    this._init();
}

PageNetworkVlanSettings.prototype = {
    _init: function () {
        this.id = "network-vlan-settings-dialog";
        this.vlan_settings_template = $("#network-vlan-settings-template").html();
        mustache.parse(this.vlan_settings_template);
    },

    setup: function () {
        $('#network-vlan-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-vlan-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-vlan-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-vlan-settings-error').prop('hidden', true);
        this.settings = PageNetworkVlanSettings.ghost_settings || PageNetworkVlanSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var model = PageNetworkVlanSettings.model;
        var options = self.settings.vlan;

        var auto_update_name = true;
        var parent_btn, id_input, name_input;

        function change() {
            // XXX - parse errors
            options.parent = select_btn_selected(parent_btn);
            $("#network-vlan-settings-apply").prop("disabled", !options.parent);

            options.id = parseInt(id_input.val(), 10);

            if (auto_update_name && options.parent && options.id)
                name_input.val(options.parent + "." + options.id);

            options.interface_name = name_input.val();
            self.settings.connection.id = options.interface_name;
            self.settings.connection.interface_name = options.interface_name;
        }

        function change_name() {
            auto_update_name = false;
            change();
        }

        var parent_choices = [];
        model.list_interfaces().forEach(function (i) {
            if (!is_interface_connection(i, PageNetworkVlanSettings.connection) &&
                is_interesting_interface(i))
                parent_choices.push({ title: i.Name, choice: i.Name });
        });

        var body = $(mustache.render(self.vlan_settings_template, {
            vlan_id: options.id || "1",
            interface_name: options.interface_name
        }));
        parent_btn = select_btn(change, parent_choices, "form-control");
        parent_btn.attr('id', 'network-vlan-settings-parent-select');
        body.find('#network-vlan-settings-parent-select').replaceWith(parent_btn);
        id_input = body.find('#network-vlan-settings-vlan-id-input')
                .change(change)
                .on('input', change);
        name_input = body.find('#network-vlan-settings-interface-name-input')
                .change(change_name)
                .on('input', change_name);

        select_btn_select(parent_btn, (options.parent ||
                                               (parent_choices[0]
                                                   ? parent_choices[0].choice
                                                   : "")));
        change();
        $('#network-vlan-settings-body').html(body);
    },

    cancel: function() {
        $('#network-vlan-settings-dialog').prop('hidden', true);
    },

    apply: function() {
        var self = this;
        var model = PageNetworkVlanSettings.model;

        function modify () {
            return PageNetworkVlanSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-vlan-settings-dialog').trigger('hide');
                        if (PageNetworkVlanSettings.connection)
                            cockpit.location.go([self.settings.connection.interface_name]);
                        if (PageNetworkVlanSettings.done)
                            return PageNetworkVlanSettings.done();
                    })
                    .fail(function (error) {
                        show_dialog_error('#network-vlan-settings-error', error);
                    });
        }

        if (PageNetworkVlanSettings.connection)
            with_settings_checkpoint(model, modify, { hack_does_add_or_remove: true });
        else
            with_checkpoint(
                PageNetworkVlanSettings.model,
                modify,
                {
                    fail_text: _("Creating this VLAN will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true
                });
    }

};

export function PageNetworkVlanSettings() {
    this._init();
}

PageNetworkMtuSettings.prototype = {
    _init: function () {
        this.id = "network-mtu-settings-dialog";
        this.ethernet_settings_template = $("#network-mtu-settings-template").html();
        mustache.parse(this.ethernet_settings_template);
    },

    setup: function () {
        $('#network-mtu-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-mtu-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-mtu-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-mtu-settings-error').prop('hidden', true);
        this.settings = PageNetworkMtuSettings.ghost_settings || PageNetworkMtuSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var options = self.settings.ethernet;

        var body = $(mustache.render(self.ethernet_settings_template, options));
        $('#network-mtu-settings-body').html(body);
        $('#network-mtu-settings-input').focus(function () {
            $('#network-mtu-settings-custom').prop('checked', true);
        });
    },

    cancel: function() {
        $('#network-mtu-settings-dialog').trigger('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkMtuSettings.model;

        function show_error(error) {
            show_dialog_error('#network-mtu-settings-error', error);
        }

        if ($("#network-mtu-settings-auto").prop('checked'))
            self.settings.ethernet.mtu = 0;
        else {
            var mtu = $("#network-mtu-settings-input").val();
            if (/^[0-9]+$/.test(mtu))
                self.settings.ethernet.mtu = parseInt(mtu, 10);
            else {
                show_error(_("MTU must be a positive number"));
                return;
            }
        }

        function modify () {
            return PageNetworkMtuSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-mtu-settings-dialog').trigger('hide');
                        if (PageNetworkMtuSettings.done)
                            return PageNetworkMtuSettings.done();
                    })
                    .fail(show_error);
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkMtuSettings.connection) });
    }

};

export function PageNetworkMtuSettings() {
    this._init();
}

PageNetworkMacSettings.prototype = {
    _init: function () {
        this.id = "network-mac-settings-dialog";
        this.ethernet_settings_template = $("#network-mac-settings-template").html();
        mustache.parse(this.ethernet_settings_template);
    },

    setup: function () {
        $('#networl-mac-settings-close-button').click($.proxy(this, "cancel"));
        $('#network-mac-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-mac-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-mac-settings-error').prop('hidden', true);
        this.settings = PageNetworkMacSettings.ghost_settings || PageNetworkMacSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var options = self.settings.ethernet;

        var body = $(mustache.render(self.ethernet_settings_template, options));
        $('#network-mac-settings-body').html(body);

        fill_mac_menu($('#network-mac-settings-menu'),
                      $('#network-mac-settings-input'),
                      PageNetworkMacSettings.model);
    },

    cancel: function() {
        $('#network-mac-settings-dialog').prop('hidden', true);
    },

    apply: function() {
        var self = this;
        var model = PageNetworkMacSettings.model;

        function show_error(error) {
            show_dialog_error('#network-mac-settings-error', error);
        }

        if (!self.settings.ethernet)
            self.settings.ethernet = { };
        self.settings.ethernet.assigned_mac_address = $("#network-mac-settings-input").val();

        function modify () {
            return PageNetworkMacSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-mac-settings-dialog').prop('hidden', true);
                        if (PageNetworkMacSettings.done)
                            return PageNetworkMacSettings.done();
                    })
                    .fail(show_error);
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkMacSettings.connection) });
    }

};

export function PageNetworkMacSettings() {
    this._init();
}

/* INITIALIZATION AND NAVIGATION
 *
 * The code above still uses the legacy 'Page' abstraction for both
 * pages and dialogs, and expects page.setup, page.enter, page.show,
 * and page.leave to be called at the right times.
 *
 * We cater to this with a little compatibility shim consisting of
 * 'dialog_setup'.
 */

function dialog_setup(d) {
    d.setup();
    $('#' + d.id)
            .on('show', function () {
                $('#' + d.id).prop('hidden', false);
                d.enter();
                d.show();
            })
            .on('hide', function () {
                $('#' + d.id).prop('hidden', true);
                d.leave();
            });
}

export function init() {
    cockpit.translate();

    dialog_setup(new PageNetworkIpSettings());
    dialog_setup(new PageNetworkBondSettings());
    dialog_setup(new PageNetworkTeamSettings());
    dialog_setup(new PageNetworkTeamPortSettings());
    dialog_setup(new PageNetworkBridgeSettings());
    dialog_setup(new PageNetworkBridgePortSettings());
    dialog_setup(new PageNetworkVlanSettings());
    dialog_setup(new PageNetworkMtuSettings());
    dialog_setup(new PageNetworkMacSettings());

    $('#confirm-breaking-change-popup [data-dismiss]').click(() =>
        $('#confirm-breaking-change-popup').prop('hidden', true));
}
