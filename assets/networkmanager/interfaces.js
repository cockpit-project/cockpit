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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "shell/controls",
    "shell/shell",
    "system/server",
    "shell/cockpit-util",
    "shell/plot",
    "base1/patterns",
], function($, cockpit, Mustache, controls, shell, server) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

function nm_debug() {
    if (window.debugging == "all" || window.debugging == "nm")
        console.debug.apply(console, arguments);
}

function generate_uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

function show_unexpected_error(error) {
    $("#error-popup-message").text(error.message || error || "???");
    $('.modal[role="dialog"]').modal('hide');
    $('#error-popup').modal('show');
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
 * Editing connection settings is supported directly:
 *
 *    connection = manager.Devices[0].AvailableConnections[0];
 *    connection.freeze();
 *    connection.Settings.connection.autoconnect = false;
 *    connection.apply().fail(show_error);
 *
 * Freezing a connection object will prevent external, asynchronous
 * updates to the Settings.  Calling 'apply' will unfreeze the object
 * when it succeeds.
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

function NetworkManagerModel() {
    /*
     * The NetworkManager model doesn't need proxies in its DBus client.
     * It uses the 'raw' dbus events and methods and constructs its own data
     * structure.  This has the advantage of avoiding wasting
     * resources for maintaining the unused proxies, avoids some code
     * complexity, and allows to do the right thing with the
     * pecularities of the NetworkManager API.
     *
     * However, we do use a fake object manager since that allows us
     * to avoid a lot of 'GetAll' round trips during initialization
     * and helps with removing obsolete objects.
     */

    var self = this;
    var byteorder = null;

    var client = cockpit.dbus("org.freedesktop.NetworkManager");

    self.client = client;

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
            if(val !== undefined) {
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
            if (props_with_sigs.hasOwnProperty(p)) {
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
        client.call(objpath(obj), iface, method, Array.prototype.slice.call(arguments, 3)).
            fail(function(ex) {
                dfd.reject(ex);
            }).
            done(function(reply) {
                dfd.resolve.apply(dfd, reply);
            });
        return dfd.promise();
    }

    var interface_types = { };

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

    var max_export_phases = 0;
    var export_pending;

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

            $(self).trigger('changed');
        }

        if (!export_pending) {
            export_pending = true;
            window.setTimeout(function () { export_pending = false; doit(); }, 300);
        }
    }

    client.call("/org/freedesktop/NetworkManager",
                "org.freedesktop.DBus.Properties", "Get",
                ["org.freedesktop.NetworkManager", "State"], { flags: "" }).
        fail(complain).
        done(function(reply, options) {
            if (options.flags) {
                if (options.flags.indexOf(">") !== -1)
                    byteorder = "be";
                else if (options.flags.indexOf("<") !== -1)
                    byteorder = "le";
            }
        });

    var subscription = client.subscribe({ }, signal_emitted);
    var watch = client.watch({ });
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

    self.close = function close() {
        subscription.remove();
        watch.remove();
        $(client).off("notify");
        client.close("unused");
    };

    /* NetworkManager specific data conversions and utility functions.
     */

    function toDec(n) {
        return n.toString(10);
    }

    function bytes_from_nm32(num) {
        var bytes = [], i;
        if (byteorder == "be") {
            for (i = 3; i >= 0; i--) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        } else {
            for (i = 0; i < 4; i++) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        }
        return bytes;
    }

    function bytes_to_nm32(bytes) {
        var num = 0, i;
        if (byteorder == "be") {
            for (i = 0; i < 4; i++) {
                num = 256*num + bytes[i];
            }
        } else {
            for (i = 3; i >= 0; i--) {
                num = 256*num + bytes[i];
            }
        }
        return num;
    }

    function ip4_to_text(num) {
        return bytes_from_nm32(num).map(toDec).join('.');
    }

    function ip4_from_text(text) {
        var parts = text.split('.');
        if (parts.length == 4)
            return bytes_to_nm32(parts.map(function(s) { return parseInt(s, 10); }));
        else // XXX - error
            return 0;
    }

    var text_to_prefix_bits = {
        "255": 8, "254": 7, "252": 6, "248": 5, "240": 4, "224": 3, "192": 2, "128": 1, "0": 0
    };

    function ip4_prefix_from_text(text) {
        if (/^[0-9]+$/.test(text.trim()))
            return parseInt(text, 10);
        var parts = text.split('.');
        if (parts.length != 4)
            return -1;
        var prefix = 0;
        var i;
        for (i = 0; i < 4; i++) {
            var p = text_to_prefix_bits[parts[i].trim()];
            if (p !== undefined) {
                prefix += p;
                if (p < 8)
                    break;
            } else
                return -1;
        }
        for (i += 1; i < 4; i++) {
            if (/^0+$/.test(parts[i].trim()) === false)
                return -1;
        }
        return prefix;
    }

    function ip4_address_from_nm(addr) {
        return [ ip4_to_text(addr[0]),
                 addr[1].toString(),
                 ip4_to_text(addr[2])
               ];
    }

    function ip4_address_to_nm(addr) {
        return [ ip4_from_text(addr[0]),
                 ip4_prefix_from_text(addr[1]),
                 ip4_from_text(addr[2])
               ];
    }

    function ip4_route_from_nm(addr) {
        return [ ip4_to_text(addr[0]),
                 addr[1].toString(),
                 ip4_to_text(addr[2]),
                 addr[3].toString()
               ];
    }

    function ip4_route_to_nm(addr) {
        return [ ip4_from_text(addr[0]),
                 ip4_prefix_from_text(addr[1]),
                 ip4_from_text(addr[2]),
                 parseInt(addr[3], 10) || 0
               ];
    }

    function ip6_from_text(text) {
        var parts = text.split(':');
        var bytes = [];
        for (var i = 0; i < 8; i++) {
            var num = parseInt(parts[i], 16) || 0;
            bytes[2*i] = num >> 8;
            bytes[2*i+1] = num & 255;
        }
        return cockpit.base64_encode(bytes);
    }

    function ip6_to_text(data) {
        var parts = [];
        var bytes = cockpit.base64_decode(data);
        for (var i = 0; i < 8; i++)
            parts[i] = ((bytes[2*i] << 8) + bytes[2*i+1]).toString(16);
        return parts.join(':');
    }

    function ip6_address_from_nm(addr) {
        return [ ip6_to_text(addr[0]),
                 addr[1].toString(),
                 ip6_to_text(addr[2])
               ];
    }

    function ip6_address_to_nm(addr) {
        return [ ip6_from_text(addr[0]),
                 parseInt(addr[1], 10) || 64,
                 ip6_from_text(addr[2])
               ];
    }

    function ip6_route_from_nm(addr) {
        return [ ip6_to_text(addr[0]),
                 addr[1].toString(),
                 ip6_to_text(addr[2]),
                 addr[3].toString()
               ];
    }

    function ip6_route_to_nm(addr) {
        return [ ip6_from_text(addr[0]),
                 parseInt(addr[1], 10) || 64,
                 ip6_from_text(addr[2]),
                 parseInt(addr[3], 10) || 0
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
                slave_type:     get("connection", "slave-type"),
                master:         get("connection", "master")
            }
        };

        if (!settings.connection.master) {
            result.ipv4 = get_ip("ipv4", ip4_address_from_nm, ip4_route_from_nm, ip4_to_text);
            result.ipv6 = get_ip("ipv6", ip6_address_from_nm, ip6_route_from_nm, ip6_to_text);
        }

        if (settings.bond) {
            /* Options are documented as part of the Linux bonding driver.
               https://www.kernel.org/doc/Documentation/networking/bonding.txt
            */
            result.bond = { options:        $.extend({}, get("bond", "options", { })),
                            interface_name: get("bond", "interface-name")
                          };
        }

        if (settings.bridge) {
            result.bridge = { interface_name: get("bridge", "interface-name"),
                              stp:            get("bridge", "stp", true),
                              priority:       get("bridge", "priority", 32768),
                              forward_delay:  get("bridge", "forward-delay", 15),
                              hello_time:     get("bridge", "hello-time", 2),
                              max_age:        get("bridge", "max-age", 20),
                              ageing_time:    get("bridge", "ageing-time", 300)
                            };
        }

        if (settings["bridge-port"] || result.connection.slave_type == "bridge") {
            result.bridge_port = { priority:       get("bridge-port", "priority", 32),
                                   path_cost:      get("bridge-port", "path-cost", 100),
                                   hairpin_mode:   get("bridge-port", "hairpin-mode", false)
                                 };
        }

        if (settings.vlan) {
            result.vlan = { parent:         get("vlan", "parent"),
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
            set(first, "addresses", addrs_sig, settings[first].addresses.map(addr_to_nm));
            set(first, "dns", ips_sig, settings[first].dns.map(ip_from_text));
            set(first, "dns-search", 'as', settings[first].dns_search);
            set(first, "routes", routes_sig, settings[first].routes.map(route_to_nm));

            // Never pass "address-labels" back to NetworkManager.  It
            // is documented as "internal only", but needs to somehow
            // stay in sync with "addresses".  By not passing it back
            // we don't have to worry about that.
            //
            delete result[first]["address-labels"];
        }

        set("connection", "id", 's', settings.connection.id);
        set("connection", "autoconnect", 'b', settings.connection.autoconnect);
        set("connection", "uuid", 's', settings.connection.uuid);
        set("connection", "interface-name", 's', settings.connection.interface_name);
        set("connection", "type", 's', settings.connection.type);
        set("connection", "slave-type", 's', settings.connection.slave_type);
        set("connection", "master", 's', settings.connection.master);

        delete result.ipv4;
        if (settings.ipv4)
            set_ip("ipv4", 'aau', ip4_address_to_nm, 'aau', ip4_route_to_nm, 'au', ip4_from_text);

        delete result.ipv6;
        if (settings.ipv6)
            set_ip("ipv6", 'a(ayuay)', ip6_address_to_nm, 'a(ayuayu)', ip6_route_to_nm, 'aay', ip6_from_text);

        delete result.bond;
        if (settings.bond) {
            set("bond", "options", 'a{ss}', settings.bond.options);
            set("bond", "interface-name", 's', settings.bond.interface_name);
        }

        delete result.bridge;
        if (settings.bridge) {
            set("bridge", "interface-name", 's', settings.bridge.interface_name);
            set("bridge", "stp", 'b', settings.bridge.stp);
            set("bridge", "priority", 'u', settings.bridge.priority);
            set("bridge", "forward-delay", 'u', settings.bridge.forward_delay);
            set("bridge", "hello-time", 'u', settings.bridge.hello_time);
            set("bridge", "max-age", 'u', settings.bridge.max_age);
            set("bridge", "ageing-time", 'u', settings.bridge.ageing_time);
        }

        delete result["bridge-port"];
        if (settings.bridge_port) {
            set("bridge-port", "priority", 'u', settings.bridge_port.priority);
            set("bridge-port", "path-cost", 'u', settings.bridge_port.path_cost);
            set("bridge-port", "hairpin-mode", 'b', settings.bridge_port.hairpin_mode);
        }

        delete result.vlan;
        if (settings.vlan) {
            set("vlan", "parent",         's', settings.vlan.parent);
            set("vlan", "id",             'u', settings.vlan.id);
            set("vlan", "interface-name", 's', settings.vlan.interface_name);
        }

        if (settings["802-3-ethernet"]) {
            if (!result["802-3-ethernet"])
                result["802-3-ethernet"] = { };
        }

        return result;
    }

    function device_type_to_symbol(type) {
        switch (type) {
        case 0:  return 'unknown';
        case 1:  return 'ethernet';
        case 2:  return 'wifi';
        case 3:  return 'unused1';
        case 4:  return 'unused2';
        case 5:  return 'bt';
        case 6:  return 'olpc_mesh';
        case 7:  return 'wimax';
        case 8:  return 'modem';
        case 9:  return 'infiniband';
        case 10: return 'bond';
        case 11: return 'vlan';
        case 12: return 'adsl';
        case 13: return 'bridge';
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
        if (obj.Settings && obj.Settings.connection && obj.Settings.connection.uuid)
            connections_by_uuid[obj.Settings.connection.uuid] = obj;
    }

    function refresh_settings(obj) {
        push_refresh();
        client.call(objpath(obj), "org.freedesktop.NetworkManager.Settings.Connection", "GetSettings").
            always(pop_refresh).
            fail(complain).
            done(function(reply) {
                var result = reply[0];
                if (result) {
                    priv(obj).orig = result;
                    if (!priv(obj).frozen) {
                        set_settings(obj, settings_from_nm(result));
                    }
                }
            });
    }

    function refresh_udev(obj) {
        if (obj.Udi.indexOf("/sys/") !== 0)
            return;

        push_refresh();
        cockpit.spawn(["udevadm", "info", obj.Udi]).
            done(function(res) {
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
            }).
            fail(function(ex) {
                console.warn(ex);
            }).
            always(pop_refresh);
    }

    function handle_updated(obj) {
        refresh_settings(obj);
    }

    /* NetworkManager specific object types, used by the generic D-Bus
     * code and using the data conversion functions.
     */

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
            freeze: function () {
                priv(this).frozen = true;
            },

            apply: function() {
                var self = this;
                return call_object_method(this,
                                          "org.freedesktop.NetworkManager.Settings.Connection", "Update",
                                          settings_to_nm(this.Settings, priv(this).orig)).
                    done(function () {
                        priv(self).frozen = false;
                    });
            },

            reset:  function () {
                set_settings (this, settings_from_nm(priv(this).orig));
                priv(this).frozen = false;
                export_model();
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
                obj.Slaves = [ ];
                obj.Interfaces = [ ];
            },

            null,

            // Needs: type_Interface.Device
            //        type_Interface.Connections
            //
            // Sets:  type_Connection.Slaves
            //        type_Connection.Masters
            //
            function (obj) {
                var master, iface;

                // Most of the time, a connection has zero or one masters,
                // but when a connection refers to its master by interface
                // name, we might end up with more than one master
                // connection so we just collect them all.
                //
                // TODO - Nail down how NM really handles this.

                function check_con(con) {
                    if (con.Settings.connection.type == obj.Settings.connection.slave_type) {
                        obj.Masters.push(con);
                        con.Slaves.push(obj);
                    }
                }

                obj.Masters = [ ];
                if (obj.Settings && obj.Settings.connection && obj.Settings.connection.slave_type) {
                    master = connections_by_uuid[obj.Settings.connection.master];
                    if (master) {
                        obj.Masters.push(master);
                        master.Slaves.push(obj);
                    } else {

                        iface = peek_interface(obj.Settings.connection.master);
                        if (iface) {
                            if (iface.Device)
                                iface.Device.AvailableConnections.forEach(check_con);
                            else
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
            // See below for "Master"
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
            "org.freedesktop.NetworkManager.Device.Bridge",
            "org.freedesktop.NetworkManager.Device.Vlan"
        ],

        props: {
            DeviceType:           { conv: device_type_to_symbol },
            Interface:            { },
            StateText:            { prop: "State", conv: device_state_to_text,        def: _("Unknown") },
            State:                { },
            HwAddress:            { },
            AvailableConnections: { conv: conv_Array(conv_Object(type_Connection)),   def: [] },
            ActiveConnection:     { conv: conv_Object(type_ActiveConnection) },
            Udi:                  { trigger: refresh_udev },
            IdVendor:             { def: "" },
            IdModel:              { def: "" },
            Driver:               { def: "" },
            Carrier:              { def: true },
            Speed:                { }
            // See below for "Slaves"
        },

        prototype: {
            activate: function(connection, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(connection), objpath(this), objpath(specific_object));
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
        interfaces: [ ],

        exporters: [
            function (obj) {
                obj.Device = null;
                obj.Connections = [ ];
            },

            null,

            // Needs: type_Interface.Device
            //        type_Interface.Connections
            //
            // Sets:  type_Connection.Interfaces
            //
            function (obj) {
                if (!obj.Device && obj.Connections.length === 0) {
                    drop_object(priv(obj).path);
                    return;
                }

                if (obj.Device) {
                    obj.Device.AvailableConnections.forEach(function (con) {
                        con.Interfaces.push(obj);
                    });
                } else {
                    obj.Connections.forEach(function (con) {
                        con.Interfaces.push(obj);
                    });
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
            Connections:            { conv: conv_Array(conv_Object(type_Connection)),           def: [] }
        },

        prototype: {
            add_connection: function (conf) {
                var dfd = $.Deferred();
                call_object_method(this,
                                   'org.freedesktop.NetworkManager.Settings',
                                   'AddConnection',
                                   settings_to_nm(conf, { })).
                    done(function (path) {
                        dfd.resolve(get_object(path, type_Connection));
                    }).
                    fail(function (error) {
                        dfd.reject(error);
                    });
                return dfd.promise();
            }
        },

        exporters: [
            null,

            // Sets: type_Interface.Connections
            //
            function (obj) {
                if (obj.Connections) {
                    obj.Connections.forEach(function (con) {
                        function add_to_interface(name) {
                            get_interface(name).Connections.push(con);
                        }

                        if (con.Settings) {
                            if (con.Settings.bond)
                                add_to_interface(con.Settings.bond.interface_name);
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

    var type_Manager = {
        interfaces: [
            "org.freedesktop.NetworkManager"
        ],

        props: {
            Devices:            { conv: conv_Array(conv_Object(type_Device)),           def: [] },
            ActiveConnections:  { conv: conv_Array(conv_Object(type_ActiveConnection)), def: [] }
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
    type_ActiveConnection.props.Master = { conv: conv_Object(type_Device) };
    type_Device.props.Slaves = { conv: conv_Array(conv_Object(type_Device)), def: [] };

    /* Accessing the model.
     */

    self.list_interfaces = function list_interfaces() {
        var path, obj;
        var result = [ ];
        for (path in objects) {
            obj = objects[path];
            if (priv(obj).type === type_Interface)
                result.push(obj);
        }
        return result.sort(function (a, b) { return a.Name.localeCompare(b.Name); });
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

    set_object_types([ type_Manager,
                       type_Settings,
                       type_Device,
                       type_Ipv4Config,
                       type_Ipv6Config,
                       type_Connection,
                       type_ActiveConnection
                     ]);

    get_object("/org/freedesktop/NetworkManager", type_Manager);
    get_object("/org/freedesktop/NetworkManager/Settings", type_Settings);
    return self;
}

function render_interface_link(iface) {
    return $('<a>').
               text(iface).
               click(function () {
                   cockpit.location.go([ iface ]);
               });
}

function device_state_text(dev) {
    if (!dev)
        return _("Inactive");
    if (dev.State == 100 && dev.Carrier === false)
        return _("No carrier");
    return dev.StateText;
}

function render_connection_link(con) {
    var res =
        $('<span>').append(
            array_join(
                con.Interfaces.map(function (iface) {
                    return $('<a>').
                        text(iface.Name).
                        click(function () {
                            cockpit.location.go([ iface.Name ]);
                        });
                }),
                ", "));
    return res;
}

function array_join(elts, sep) {
    var result = [ ];
    for (var i = 0; i < elts.length; i++) {
        result.push(elts[i]);
        if (i < elts.length-1)
            result.push(sep);
    }
    return result;
}

function render_active_connection(dev, with_link, hide_link_local) {
    var parts = [ ];
    var con;

    if (!dev)
        return "";

    con = dev.ActiveConnection;

    if (con && con.Master) {
        return $('<span>').append(
                   $('<span>').text(_("Part of ")),
                   (with_link? render_interface_link(con.Master.Interface) : con.Master.Interface));
    }

    if (con && con.Ip4Config) {
        con.Ip4Config.Addresses.forEach(function (a) {
            parts.push(a[0] + "/" + a[1]);
        });
    }

    function is_ipv6_link_local(addr) {
        return (addr.indexOf("fe8") === 0 ||
                addr.indexOf("fe9") === 0 ||
                addr.indexOf("fea") === 0 ||
                addr.indexOf("feb") === 0);
    }

    if (con && con.Ip6Config) {
        con.Ip6Config.Addresses.forEach(function (a) {
            if (!(hide_link_local && is_ipv6_link_local(a[0])))
                parts.push(a[0] + "/" + a[1]);
        });
    }

    return $('<span>').text(parts.join(", "));
}

function network_plot_setup_hook(plot) {
    var axes = plot.getAxes();
    if (axes.yaxis.datamax < 100000)
        axes.yaxis.options.max = 100000;
    else
        axes.yaxis.options.max = null;
    axes.yaxis.options.min = 0;
}

var permission = cockpit.permission({ group: "wheel" });
$(permission).on("changed", update_network_privileged);

function update_network_privileged() {
    controls.update_privileged_ui(
        permission, ".network-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify network settings"),
            cockpit.user.name)
    );
}

/* Resource usage monitoring
*/

var usage_metrics_channel;
var usage_samples;
var usage_grid;

function ensure_usage_monitor() {
    if (usage_metrics_channel)
        return;

    usage_samples = { };
    usage_metrics_channel = cockpit.metrics(1000,
                                            [ { source: "direct",
                                                metrics: [ { name: "network.interface.in.bytes",
                                                             units: "bytes",
                                                             derive: "rate"
                                                           },
                                                           { name: "network.interface.out.bytes",
                                                             units: "bytes",
                                                             derive: "rate"
                                                           },
                                                         ],
                                                metrics_path_names: [ "rx", "tx" ]
                                              },
                                              { source: "internal",
                                                metrics: [ { name: "network.all.rx",
                                                             units: "bytes",
                                                             derive: "rate"
                                                           },
                                                           { name: "network.all.tx",
                                                             units: "bytes",
                                                             derive: "rate"
                                                           },
                                                         ],
                                                metrics_path_names: [ "rx", "tx" ]
                                              }
                                            ]);
    usage_grid = cockpit.grid(1000, -1, -0);
    usage_metrics_channel.follow();
    usage_grid.walk();
}

function add_usage_monitor(iface) {
    usage_samples[iface] = [ usage_grid.add(usage_metrics_channel, [ "rx", iface ]),
                             usage_grid.add(usage_metrics_channel, [ "tx", iface ]),
                           ];
}

PageNetworking.prototype = {
    _init: function (model) {
        this.id = "networking";
        this.model = model;
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    setup: function () {
        var self = this;

        update_network_privileged();
        $("#networking-add-bond").click($.proxy(this, "add_bond"));
        $("#networking-add-bridge").click($.proxy(this, "add_bridge"));
        $("#networking-add-vlan").click($.proxy(this, "add_vlan"));

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function highlight_netdev_row(event, id) {
            $('#networking-interfaces tr').removeClass('highlight');
            if (id) {
                $('#networking-interfaces tr[data-interface="' + shell.esc(id) + '"]').addClass('highlight');
            }
        }

        var rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.all.rx",
            units: "bytes",
            derive: "rate"
        };

        var rx_plot_options = shell.plot_simple_template();
        $.extend(rx_plot_options.yaxis, { tickFormatter: shell.format_bytes_per_sec_tick,
                                          labelWidth: 60
                                        });
        $.extend(rx_plot_options.grid,  { hoverable: true,
                                          autoHighlight: false
                                        });
        rx_plot_options.colors = blues;
        rx_plot_options.setup_hook = network_plot_setup_hook;
        this.rx_plot = shell.plot($("#networking-rx-graph"), 300);
        this.rx_plot.set_options(rx_plot_options);
        this.rx_series = this.rx_plot.add_metrics_stacked_instances_series(rx_plot_data, { });
        this.rx_plot.start_walking();
        $(this.rx_series).on('hover', highlight_netdev_row);

        var tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.all.tx",
            units: "bytes",
            derive: "rate"
        };

        var tx_plot_options = shell.plot_simple_template();
        $.extend(tx_plot_options.yaxis, { tickFormatter: shell.format_bytes_per_sec_tick,
                                          labelWidth: 60
                                        });
        $.extend(tx_plot_options.grid,  { hoverable: true,
                                          autoHighlight: false
                                        });
        tx_plot_options.colors = blues;
        tx_plot_options.setup_hook = network_plot_setup_hook;
        this.tx_plot = shell.plot($("#networking-tx-graph"), 300);
        this.tx_plot.set_options(tx_plot_options);
        this.tx_series = this.tx_plot.add_metrics_stacked_instances_series(tx_plot_data, { });
        this.tx_plot.start_walking();
        $(this.tx_series).on('hover', highlight_netdev_row);

        $(cockpit).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });

        var plot_controls = shell.setup_plot_controls($('#networking'), $('#networking-graph-toolbar'));
        plot_controls.reset([ this.rx_plot, this.tx_plot ]);

        ensure_usage_monitor();
        $(usage_grid).on('notify', function (event, index, count) {
            handle_usage_samples();
        });

        function handle_usage_samples() {
            for (var iface in usage_samples) {
                var samples = usage_samples[iface];
                var rx = samples[0][0];
                var tx = samples[1][0];
                var row = $('#networking-interfaces tr[data-sample-id="' + shell.esc(iface) + '"]');
                if (rx !== undefined && tx !== undefined && row.length > 0) {
                    row.find('td:nth-child(3)').text(cockpit.format_bits_per_sec(tx * 8));
                    row.find('td:nth-child(4)').text(cockpit.format_bits_per_sec(rx * 8));
                }
            }
        }
    },

    enter: function () {
        var self = this;

        this.log_box = server.logbox([ "_SYSTEMD_UNIT=NetworkManager.service",
                                       "_SYSTEMD_UNIT=firewalld.service" ], 10);
        $('#networking-log').empty().append(this.log_box);

        $(this.model).on('changed.networking', $.proxy(this, "update_devices"));
        this.update_devices();
    },

    show: function() {
        this.rx_plot.resize();
        this.tx_plot.resize();
    },

    leave: function() {
        if (this.log_box)
            this.log_box.stop();

        $(this.model).off(".networking");
    },

    update_devices: function() {
        var self = this;
        var tbody;

        tbody = $('#networking-interfaces tbody');
        tbody.empty();

        self.model.list_interfaces().forEach(function (iface) {

            function has_master(iface) {
                var connections =
                    (iface.Device ? iface.Device.AvailableConnections : iface.Connections);
                return connections.some(function (c) { return c.Masters.length > 0; });
            }

            // Skip slaves
            if (has_master(iface))
                return;

            // Skip everything that is not ethernet, bond, or bridge
            if (iface.Device && iface.Device.DeviceType != 'ethernet' &&
                iface.Device.DeviceType != 'bond' &&
                iface.Device.DeviceType != 'vlan' &&
                iface.Device.DeviceType != 'bridge')
                return;

            var dev = iface.Device;
            var is_active = (dev && dev.State == 100 && dev.Carrier === true);

            self.rx_series.add_instance(iface.Name);
            self.tx_series.add_instance(iface.Name);
            add_usage_monitor(iface.Name);

            tbody.append($('<tr>', { "data-interface": iface.Name,
                                     "data-sample-id": is_active? iface.Name : null
                                   }).
                         append($('<td>').text(iface.Name),
                                $('<td>').html(render_active_connection(dev, false, true)),
                                (is_active?
                                 [ $('<td>').text(""), $('<td>').text("") ] :
                                 $('<td colspan="2">').text(device_state_text(dev)))).
                         click(function () {
                             cockpit.location.go([ iface.Name ]);
                         }));
        });
    },

    add_bond: function () {
        var iface, i, uuid;

        uuid = generate_uuid();
        for (i = 0; i < 100; i++) {
            iface = "bond" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        PageNetworkBondSettings.model = this.model;
        PageNetworkBondSettings.done = null;
        PageNetworkBondSettings.connection = null;
        PageNetworkBondSettings.settings =
            {
                connection: {
                    id: uuid,
                    autoconnect: false,
                    type: "bond",
                    uuid: uuid,
                    interface_name: iface
                },
                bond: {
                    options: {
                        mode: "balance-rr"
                    },
                    interface_name: iface
                }
            };

        $('#network-bond-settings-dialog').modal('show');
    },

    add_bridge: function () {
        var iface, i, uuid;

        uuid = generate_uuid();
        for (i = 0; i < 100; i++) {
            iface = "bridge" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        PageNetworkBridgeSettings.model = this.model;
        PageNetworkBridgeSettings.done = null;
        PageNetworkBridgeSettings.connection = null;
        PageNetworkBridgeSettings.settings =
            {
                connection: {
                    id: uuid,
                    autoconnect: false,
                    type: "bridge",
                    uuid: uuid,
                    interface_name: iface
                },
                bridge: {
                    interface_name: iface,
                    stp: false,
                    priority: 32768,
                    forward_delay: 15,
                    hello_time: 2,
                    max_age: 20,
                    ageing_time: 300
                }
            };

        $('#network-bridge-settings-dialog').modal('show');
    },

    add_vlan: function () {
        var iface, i, uuid;

        uuid = generate_uuid();

        PageNetworkVlanSettings.model = this.model;
        PageNetworkVlanSettings.done = null;
        PageNetworkVlanSettings.connection = null;
        PageNetworkVlanSettings.settings =
            {
                connection: {
                    id: uuid,
                    autoconnect: false,
                    type: "vlan",
                    uuid: uuid,
                    interface_name: ""
                },
                vlan: {
                    interface_name: "",
                    parent: ""
                }
            };

        $('#network-vlan-settings-dialog').modal('show');
    }

};

function PageNetworking(model) {
    this._init(model);
}

var ipv4_method_choices =
    [
        { choice: 'auto',         title: _("Automatic (DHCP)") },
        { choice: 'link-local',   title: _("Link local") },
        { choice: 'manual',       title: _("Manual") },
        { choice: 'shared',       title: _("Shared") },
        { choice: 'disabled',     title: _("Disabled") }
    ];

var ipv6_method_choices =
    [
        { choice: 'auto',         title: _("Automatic") },
        { choice: 'dhcp',         title: _("Automatic (DHCP only)") },
        { choice: 'link-local',   title: _("Link local") },
        { choice: 'manual',       title: _("Manual") },
        { choice: 'ignore',       title: _("Ignore") }
    ];

var bond_mode_choices =
    [
        { choice: 'balance-rr',    title: _("Round Robin") },
        { choice: 'active-backup', title: _("Active Backup") },
        { choice: 'balance-xor',   title: _("XOR") },
        { choice: 'broadcast',     title: _("Broadcast") },
        { choice: '802.3ad',       title: _("802.3ad") },
        { choice: 'balance-tlb',   title: _("Adaptive transmit load balancing") },
        { choice: 'balance-alb',   title: _("Adaptive load balancing") }
    ];

var bond_monitoring_choices =
    [
        { choice: 'mii',    title: _("MII (Recommended)") },
        { choice: 'arp',    title: _("ARP") }
    ];

function choice_title(choices, choice, def) {
    for (var i = 0; i < choices.length; i++) {
        if (choices[i].choice == choice)
            return choices[i].title;
    }
    return def;
}

PageNetworkInterface.prototype = {
    _init: function (model) {
        this.id = "network-interface";
        this.model = model;
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    setup: function () {
        var self = this;

        $('#network-interface .breadcrumb a').on("click", function() {
            cockpit.location.go('/');
        });

        $('#network-interface-delete').click($.proxy(this, "delete_connections"));

        this.device_onoff = $("#network-interface-delete-switch")
            .on("change", function() {
                var val = $(this).onoff("value");
                if (val)
                    self.connect();
                else
                    self.disconnect();
            });

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function highlight_netdev_row(event, id) {
            $('#network-interface-slaves tr').removeClass('highlight');
            if (id) {
                $('#network-interface-slaves tr[data-interface="' + shell.esc(id) + '"]').addClass('highlight');
            }
        }

        var rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.all.rx",
            units: "bytes",
            derive: "rate"
        };

        var rx_plot_options = shell.plot_simple_template();
        $.extend(rx_plot_options.yaxis, { tickFormatter: shell.format_bytes_per_sec_tick,
                                          labelWidth: 60
                                        });
        $.extend(rx_plot_options.grid,  { hoverable: true,
                                          autoHighlight: false
                                        });
        rx_plot_options.colors = blues;
        rx_plot_options.setup_hook = network_plot_setup_hook;
        this.rx_plot = shell.plot($("#network-interface-rx-graph"), 300);
        this.rx_plot.set_options(rx_plot_options);
        this.rx_series = this.rx_plot.add_metrics_stacked_instances_series(rx_plot_data, { });
        this.rx_plot.start_walking();
        $(this.rx_series).on('hover', highlight_netdev_row);

        var tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.all.tx",
            units: "bytes",
            derive: "rate"
        };

        var tx_plot_options = shell.plot_simple_template();
        $.extend(tx_plot_options.yaxis, { tickFormatter: shell.format_bytes_per_sec_tick,
                                          labelWidth: 60
                                        });
        $.extend(tx_plot_options.grid,  { hoverable: true,
                                          autoHighlight: false
                                        });
        tx_plot_options.colors = blues;
        tx_plot_options.setup_hook = network_plot_setup_hook;
        this.tx_plot = shell.plot($("#network-interface-tx-graph"), 300);
        this.tx_plot.set_options(tx_plot_options);
        this.tx_series = this.tx_plot.add_metrics_stacked_instances_series(tx_plot_data, { });
        this.tx_plot.start_walking();
        $(this.tx_series).on('hover', highlight_netdev_row);

        $(cockpit).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });

        var plot_controls = shell.setup_plot_controls($('#network-interface'), $('#network-interface-graph-toolbar'));
        plot_controls.reset([ this.rx_plot, this.tx_plot ]);

        ensure_usage_monitor();
        $(usage_grid).on('notify', function (event, index, count) {
            handle_usage_samples();
        });

        function handle_usage_samples() {
            for (var iface in usage_samples) {
                var samples = usage_samples[iface];
                var rx = samples[0][0];
                var tx = samples[1][0];
                var row = $('#network-interface-slaves tr[data-sample-id="' + shell.esc(iface) + '"]');
                if (row.length > 0) {
                    row.find('td:nth-child(2)').text(cockpit.format_bits_per_sec(tx * 8));
                    row.find('td:nth-child(3)').text(cockpit.format_bits_per_sec(rx * 8));
                }
            }
        }

    },

    enter: function (dev_name) {
        var self = this;

        $(self.model).on('changed.network-interface', $.proxy(self, "update"));

        self.dev_name = dev_name;

        $('#network-interface .breadcrumb .active').text(self.dev_name);

        self.rx_series.clear_instances();
        self.tx_series.clear_instances();

        $('#network-interface-delete').hide();
        self.dev = null;
        self.update();
    },

    show: function() {
        this.rx_plot.resize();
        this.tx_plot.resize();
    },

    leave: function() {
        $(this.model).off(".network-interface");
        this.dev = null;
    },

    delete_connections: function() {
        var self = this;

        function delete_connection_and_slaves(con) {
            return $.when(con.delete_(),
                          $.when.apply($, con.Slaves.map(function (s) {
                              return free_slave_connection(s);
                          })));
        }

        function delete_connections(cons) {
            return $.when.apply($, cons.map(delete_connection_and_slaves));
        }

        function delete_iface_connections(iface) {
            if (iface.Device)
                return delete_connections(iface.Device.AvailableConnections);
            else
                return delete_connections(iface.Connections);
        }

        if (this.iface) {
            var location = cockpit.location;
            delete_iface_connections(this.iface).
                done(function () {
                    location.go("/");
                }).
                fail(show_unexpected_error);
        }
    },

    connect: function() {
        var self = this;
        var settings_manager = self.model.get_settings();

        function fail(error) {
            show_unexpected_error(error);
            self.update();
        }

        function activate(con) {
            con.activate(self.dev, null).
                fail(fail);
        }

        if (self.ghost_settings) {
            settings_manager.add_connection(self.ghost_settings).
                done(activate).
                fail(fail);
        } else if (self.main_connection) {
            activate(self.main_connection);
        } else
            self.update();
    },

    disconnect: function() {
        var self = this;

        if (!self.dev) {
            self.update();
            return;
        }

        self.dev.disconnect().fail(function (error) {
            show_unexpected_error(error);
            self.update();
        });
    },

    update: function() {
        var self = this;
        var iface = self.model.find_interface(self.dev_name);
        var dev = iface && iface.Device;

        self.iface = iface;
        self.dev = dev;

        var desc;
        if (dev) {
            if (dev.DeviceType == 'ethernet') {
                desc = cockpit.format("$IdVendor $IdModel $Driver)", dev);
            } else if (dev.DeviceType == 'bond') {
                desc = _("Bond");
            } else if (dev.DeviceType == 'vlan') {
                desc = _("VLAN");
            } else if (dev.DeviceType == 'bridge') {
                desc = _("Bridge");
            }
        } else if (iface) {
            if (iface.Connections[0] && iface.Connections[0].Settings.connection.type == "bond")
                desc = _("Bond");
            else if (iface.Connections[0] && iface.Connections[0].Settings.connection.type == "vlan")
                desc = _("VLAN");
            else if (iface.Connections[0] && iface.Connections[0].Settings.connection.type == "bridge")
                desc = _("Bridge");
            else
                desc = _("Unknown");
        } else
            desc = _("Unknown");

        $('#network-interface-name').text(self.dev_name);
        $('#network-interface-hw').text(desc);
        $('#network-interface-mac').text(dev? dev.HwAddress : "");

        this.device_onoff.prop('disabled', !dev);
        this.device_onoff.onoff("value", !!(dev && dev.ActiveConnection));

        $('#network-interface-disconnect').prop('disabled', !dev || !dev.ActiveConnection);

        var is_deletable = (iface && !dev) || (dev && (dev.DeviceType == 'bond' || dev.DeviceType == 'vlan' || dev.DeviceType == 'bridge'));
        $('#network-interface-delete').toggle(!!is_deletable);

        function render_carrier_status_row() {
            if (dev && dev.Carrier !== undefined) {
                return $('<tr>').append(
                    $('<td>').text(_("Carrier")),
                    $('<td>').append(
                        dev.Carrier ?
                            (dev.Speed? cockpit.format_bits_per_sec(dev.Speed*1e6) :_("Yes")) :
                        _("No")));
            } else
                return null;
        }

        function render_active_status_row() {
            var state;

            if (self.main_connection && self.main_connection.Masters.length > 0)
                return null;

            if (!dev)
                state = _("Inactive");
            else if (dev.State != 100)
                state = dev.StateText;
            else
                state = null;

            return $('<tr>').append(
                $('<td>').text(_("Status")),
                $('<td>').append(
                    render_active_connection(dev, true, false),
                    " ",
                    state? $('<span>').text(state) : null));
        }

        function render_connection_settings_rows(con, settings) {
            if (!settings)
                return [ ];

            function apply() {
                if (con)
                    con.apply().fail(show_unexpected_error);
                else {
                    var settings_manager = self.model.get_settings();
                    settings_manager.add_connection(settings).fail(show_unexpected_error);
                }
            }

            function reactivate_connection() {
                if (con && dev && dev.ActiveConnection && dev.ActiveConnection.Connection === con) {
                    con.activate(dev, null).
                        fail(show_unexpected_error);
                }
            }

            function render_ip_settings(topic) {
                var params = settings[topic];
                var parts = [];

                if (params.method != "manual")
                    parts.push(choice_title((topic == "ipv4")? ipv4_method_choices : ipv6_method_choices,
                                            params.method, _("Unknown configuration")));

                var addr_is_extra = (params.method != "manual");
                var addrs = [ ];
                params.addresses.forEach(function (a) {
                    var addr = a[0] + "/" + a[1];
                    if (a[2] && a[2] != "0.0.0.0" && a[2] != "0:0:0:0:0:0:0:0")
                        addr += " via " + a[2];
                    addrs.push(addr);
                });
                if (addrs.length > 0)
                    parts.push(cockpit.format(addr_is_extra ? "Additional address $val" : "Address $val",
                                 { val: addrs.join(", ") }));

                var dns_is_extra = (!params["ignore-auto-dns"] && params.method != "manual");
                if (params.dns.length > 0)
                    parts.push(cockpit.format(dns_is_extra ? "Additional DNS $val" : "DNS $val",
                                 { val: params.dns.join(", ") }));
                if (params.dns_search.length > 0)
                    parts.push(cockpit.format(dns_is_extra ? "Additional DNS Search Domains $val" : "DNS Search Domains $val",
                                 { val: params.dns_search.join(", ") }));

                return parts.map(function (p) { return $('<div>').text(p); });
            }

            function configure_ip_settings(topic) {
                PageNetworkIpSettings.model = self.model;
                PageNetworkIpSettings.connection = con;
                PageNetworkIpSettings.settings = $.extend({ }, settings);
                PageNetworkIpSettings.topic = topic;
                PageNetworkIpSettings.done = reactivate_connection;
                $('#network-ip-settings-dialog').modal('show');
            }

            function configure_bond_settings() {
                PageNetworkBondSettings.model = self.model;
                PageNetworkBondSettings.connection = con;
                PageNetworkBondSettings.settings = settings;
                PageNetworkBondSettings.done = reactivate_connection;
                $('#network-bond-settings-dialog').modal('show');
            }

            function configure_bridge_settings() {
                PageNetworkBridgeSettings.model = self.model;
                PageNetworkBridgeSettings.connection = con;
                PageNetworkBridgeSettings.settings = con.Settings;
                PageNetworkBridgeSettings.done = reactivate_connection;
                $('#network-bridge-settings-dialog').modal('show');
            }

            function configure_bridge_port_settings() {
                PageNetworkBridgePortSettings.model = self.model;
                PageNetworkBridgePortSettings.connection = con;
                PageNetworkBridgePortSettings.settings = con.Settings;
                PageNetworkBridgePortSettings.done = reactivate_connection;
                $('#network-bridgeport-settings-dialog').modal('show');
            }

            function configure_vlan_settings() {
                PageNetworkVlanSettings.model = self.model;
                PageNetworkVlanSettings.connection = con;
                PageNetworkVlanSettings.settings = con.Settings;
                PageNetworkVlanSettings.done = reactivate_connection;
                $('#network-vlan-settings-dialog').modal('show');
            }

            function render_settings_row(title, rows, configure) {
                return $('<tr>').append(
                    $('<td>').
                        text(title).
                        css('vertical-align', rows.length > 1 ? "top" : "center"),
                    $('<td>').append(rows),
                    $('<td style="text-align:right;vertical-align:top">').append(
                        $('<button class="btn btn-default network-privileged">').
                            text(_("Configure")).
                            click(function () {
                                configure();
                            })));
            }

            function render_ip_settings_row(topic, title) {
                if (!settings[topic])
                    return null;

                return render_settings_row(title, render_ip_settings(topic),
                                           function () { configure_ip_settings(topic); });
            }

            function render_master() {
                if (con && con.Masters.length > 0) {
                    return $('<tr>').append(
                        $('<td>').text(_("Master")),
                        $('<td>').append(
                            array_join(con.Masters.map(render_connection_link), ", ")));
                } else
                    return null;
            }

            function render_bond_settings_row() {
                var parts = [ ];
                var rows = [ ];
                var options;

                if (!settings.bond)
                    return null;

                options = settings.bond.options;

                parts.push(choice_title(bond_mode_choices, options.mode, options.mode));
                if (options.arp_interval)
                    parts.push(_("ARP Monitoring"));

                if (parts.length > 0)
                    rows.push($('<div>').text(parts.join (", ")));

                return render_settings_row(_("Bond"), rows, configure_bond_settings);
            }

            function render_bridge_settings_row() {
                var rows = [ ];
                var options = settings.bridge;

                if (!options)
                    return null;

                function add_row(fmt, args) {
                    rows.push($('<div>').text(cockpit.format(fmt, args)));
                }

                if (options.stp) {
                    add_row(_("Spanning Tree Protocol"));
                    if (options.priority != 32768)
                        add_row(_("Priority $priority"), options);
                    if (options.forward_delay != 15)
                        add_row(_("Forward delay $forward_delay"), options);
                    if (options.hello_time != 2)
                        add_row(_("Hello time $hello_time"), options);
                    if (options.max_age != 20)
                        add_row(_("Maximum message age $max_age"), options);
                }

                return render_settings_row(_("Bridge"), rows, configure_bridge_settings);
            }

            function render_bridge_port_settings_row() {
                var rows = [ ];
                var options = settings.bridge_port;

                if (!options)
                    return null;

                function add_row(fmt, args) {
                    rows.push($('<div>').text(cockpit.format(fmt, args)));
                }

                if (options.priority != 32)
                    add_row(_("Priority $priority"), options);
                if (options.path_cost != 100)
                    add_row(_("Path cost $path_cost"), options);
                if (options.hairpin_mode)
                    add_row(_("Hairpin mode"));

                return render_settings_row(_("Bridge port"), rows, configure_bridge_port_settings);
            }

            function render_vlan_settings_row() {
                var rows = [ ];
                var options = settings.vlan;

                if (!options)
                    return null;

                function add_row(fmt, args) {
                    rows.push($('<div>').text(cockpit.format(fmt, args)));
                }

                add_row(_("Parent $parent"), options);
                add_row(_("Id $id"), options);

                return render_settings_row(_("VLAN"), rows,
                                           configure_vlan_settings);
            }

            return [ render_master(),
                     $('<tr>').append(
                         $('<td>').text(_("General")),
                         $('<td>').append(
                             $('<label style="font-weight:inherit">').append(
                                 $('<input type="checkbox" style="margin-left:0px">').
                                     prop('checked', settings.connection.autoconnect).
                                     change(function () {
                                         settings.connection.autoconnect = $(this).prop('checked');
                                         apply();
                                     }),
                                 _("Connect automatically")))),
                     render_ip_settings_row("ipv4", _("IPv4")),
                     render_ip_settings_row("ipv6", _("IPv6")),
                     render_vlan_settings_row(),
                     render_bridge_settings_row(),
                     render_bridge_port_settings_row(),
                     render_bond_settings_row()
                   ];
        }

        function create_ghost_connection_settings() {
            var uuid = generate_uuid();
            return {
                connection: {
                    id: uuid,
                    uuid: uuid,
                    autoconnect: false,
                    type: "802-3-ethernet",
                    interface_name: iface.Name
                },
                "802-3-ethernet": {
                },
                ipv4: {
                    method: "auto",
                    addresses: [ ],
                    dns: [ ],
                    dns_search: [ ],
                    routes: [ ]
                },
                ipv6: {
                    method: "auto",
                    addresses: [ ],
                    dns: [ ],
                    dns_search: [ ],
                    routes: [ ]
                }
            };
        }

        self.ghost_settings = null;
        self.main_connection = null;
        self.connection_settings = null;

        function find_main_connection(cons) {
            cons.forEach(function(c) {
                if (!self.main_connection ||
                    self.main_connection.Settings.connection.timestamp < c.Settings.connection.timestamp)
                    self.main_connection = c;
            });
            if (self.main_connection) {
                self.connection_settings = self.main_connection.Settings;
            } else {
                self.ghost_settings = create_ghost_connection_settings();
                self.connection_settings = self.ghost_settings;
            }
        }

        if (iface) {
            if (iface.Device)
                find_main_connection(iface.Device.AvailableConnections);
            else
                find_main_connection(iface.Connections);
        }

        $('#network-interface-settings').
            empty().
            append(render_active_status_row()).
            append(render_carrier_status_row()).
            append(render_connection_settings_rows(self.main_connection, self.connection_settings));
        update_network_privileged();

        function update_connection_slaves(con) {
            var tbody = $('#network-interface-slaves tbody');
            var rows = { };
            var slave_ifaces = { };

            tbody.empty();

            if (!con || (con.Settings.connection.type != "bond" &&
                         con.Settings.connection.type != "bridge")) {
                self.rx_series.add_instance(self.dev_name);
                self.tx_series.add_instance(self.dev_name);
                $('#network-interface-slaves').hide();
                return;
            }

            $('#network-interface-slaves thead th:first-child').
                text(con.Settings.connection.type == "bond"? _("Members") : _("Ports"));

            con.Slaves.forEach(function (slave_con) {
                slave_con.Interfaces.forEach(function(iface) {
                    var dev = iface.Device;
                    var is_active = (dev && dev.State == 100 && dev.Carrier === true);

                    self.rx_series.add_instance(iface.Name);
                    self.tx_series.add_instance(iface.Name);
                    slave_ifaces[iface.Name] = true;

                    rows[iface.Name] =
                        $('<tr>', { "data-interface": iface.Name,
                                    "data-sample-id": is_active? iface.Name : null
                                  }).
                            append($('<td>').text(iface.Name),
                                   (is_active?
                                    [ $('<td>').text(""), $('<td>').text("") ] :
                                    $('<td colspan="2">').text(device_state_text(dev))),
                                   $('<td style="text-align:right">').append(
                                       switchbox(is_active, function(val) {
    console.log("is_active", val);
                                           if (val) {
                                               slave_con.activate(iface.Device).
                                                   fail(show_unexpected_error);
                                           } else if (dev) {
                                               dev.disconnect().
                                                   fail(show_unexpected_error);
                                           }
                                       }, "network-privileged")),
                                   $('<td width="28px">').append(
                                       $('<button class="btn btn-default btn-control network-privileged">').
                                           text("-").
                                           click(function () {
                                               slave_con.delete_().
                                                   fail(show_unexpected_error);
                                               return false;
                                           }))).
                        click(function () {
                            cockpit.location.go([ iface.Name ]);
                        });
                });
            });

            Object.keys(rows).sort().forEach(function(name) {
                tbody.append(rows[name]);
            });

            var add_btn =
                $('<div>', { 'class': 'dropdown' }).append(
                    $('<button>', { 'class': 'network-privileged btn btn-default btn-control dropdown-toggle',
                                    'data-toggle': 'dropdown'
                                  }).
                        text("+"),
                    $('<ul>', { 'class': 'dropdown-menu',
                                'style': 'right:0px;left:auto;min-width:0;text-align:left',
                                'role': 'menu'
                              }).
                        append(
                            self.model.list_interfaces().map(function (iface) {
                                if (is_interesting_interface(iface) &&
                                    !slave_ifaces[iface.Name] &&
                                    iface != self.iface) {
                                    return $('<li role="presentation">').append(
                                        $('<a role="menuitem" class="network-privileged">').
                                            text(iface.Name).
                                            click(function () {
                                                set_slave(self.model, con, con.Settings,
                                                          con.Settings.connection.type, iface.Name,
                                                          true).
                                                    fail(show_unexpected_error);
                                            }));
                                }
                                return null;
                            })));

            $('#network-interface-slaves thead th:nth-child(5)').html(add_btn);

            $('#network-interface-slaves').show();
            update_network_privileged();
        }

        update_connection_slaves(self.main_connection);
    }

};

function PageNetworkInterface(model) {
    this._init(model);
}

function switchbox(val, callback) {
    return $('<div class="btn-onoff">').onoff();
}

PageNetworkIpSettings.prototype = {
    _init: function () {
        this.id = "network-ip-settings-dialog";
    },

    setup: function () {
        $('#network-ip-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-ip-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-ip-settings-error').text("");
        if (PageNetworkIpSettings.connection)
            PageNetworkIpSettings.connection.freeze();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var con = PageNetworkIpSettings.connection;
        var settings = PageNetworkIpSettings.settings;
        var topic = PageNetworkIpSettings.topic;
        var params = settings[topic];

        var method_btn, addresses_table;
        var auto_dns_btn, dns_table;
        var auto_dns_search_btn, dns_search_table;
        var auto_routes_btn, routes_table;

        function choicebox(p, choices) {
            var btn = shell.select_btn(
                function (choice) {
                    params[p] = choice;
                    self.update();
                },
                choices);
            shell.select_btn_select(btn, params[p]);
            return btn;
        }

        function inverted_switchbox(title, p) {
            var onoff;
            var btn = $('<span>').append(
                $('<span style="margin-right:10px">').text(title),
                onoff = switchbox(!params[p], function(val) {
                    params[p] = !val;
                    self.update();
                }));
            btn.enable = function enable(val) {
                onoff.onoff("disabled", !val);
            };
            return btn;
        }

        function tablebox(title, p, columns, def, header_buttons) {
            var direct = false;
            var add_btn;

            if (typeof columns == "string") {
                direct = true;
                columns = [ columns ];
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
                    params[p].splice(index,1);
                    self.update();
                };
            }

            var panel =
                $('<div class="network-ip-settings-row">').append(
                    $('<div>').append(
                        $('<span style="font-weight:bold">').text(title),
                        $('<div style="float:right">').append(
                            header_buttons,
                            add_btn = $('<button class="btn btn-default" style="width:2em">').
                                text("+").
                                css("margin-left", "10px").
                                click(add()))),
                    $('<table width="100%">').append(
                        params[p].map(function (a, i) {
                            return ($('<tr>').append(
                                columns.map(function (c, j) {
                                    return $('<td>').append(
                                        $('<input class="form-control">').
                                            val(get(i,j)).
                                            attr('placeholder', c).
                                            change(function (event) {
                                                set(i,j, $(event.target).val());
                                            }));
                                }),
                                $('<td style="text-align:right; padding-right: 0;">').append(
                                    $('<button class="btn btn-default" style="width:2em">').
                                        text(_("-")).
                                        click(remove(i)))));
                        })));

            panel.enable_add = function enable_add(val) {
                add_btn.prop('disabled', !val);
            };

            return panel;
        }

        function render_ip_settings() {
            var prefix_text = (topic == "ipv4")? _("Prefix length or Netmask") : _("Prefix length");
            var body =
                $('<div>').append(
                    addresses_table = tablebox(_("Addresses"), "addresses", [ "Address", prefix_text, "Gateway" ],
                             [ "", "", "" ],
                             method_btn = choicebox("method", (topic == "ipv4")?
                                                    ipv4_method_choices : ipv6_method_choices).
                                              css('display', 'inline-block')),
                    $('<br>'),
                    dns_table =
                        tablebox(_("DNS"), "dns", "Server", "",
                                 auto_dns_btn = inverted_switchbox(_("Automatic"), "ignore_auto_dns")),
                    $('<br>'),
                    dns_search_table =
                        tablebox(_("DNS Search Domains"), "dns_search", "Search Domain", "",
                                 auto_dns_search_btn = inverted_switchbox(_("Automatic"),
                                                                                         "ignore_auto_dns")),
                    $('<br>'),
                    routes_table =
                        tablebox(_("Routes"), "routes",
                                 [ "Address", prefix_text, "Gateway", "Metric" ], [ "", "", "", "" ],
                                 auto_routes_btn = inverted_switchbox(_("Automatic"), "ignore_auto_routes")));
            return body;
        }

        // The manual method needs at least one address
        //
        if (params.method == "manual" && params.addresses.length === 0)
            params.addresses = [ [ "", "", "" ] ];

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
            params.addresses = [ ];
            params.dns = [ ];
            params.dns_search = [ ];
        }
        if (is_off) {
            params.routes = [ ];
        }

        $('#network-ip-settings-dialog .modal-title').text(
            (topic == "ipv4")? _("IPv4 Settings") : _("IPv6 Settings"));
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
        if (PageNetworkIpSettings.connection)
            PageNetworkIpSettings.connection.reset();
        $('#network-ip-settings-dialog').modal('hide');
    },

    apply: function() {
        function apply_or_create() {
            if (PageNetworkIpSettings.connection)
                return PageNetworkIpSettings.connection.apply();
            else {
                var settings_manager = PageNetworkIpSettings.model.get_settings();
                return settings_manager.add_connection(PageNetworkIpSettings.settings);
            }
        }

        apply_or_create().
            done(function () {
                $('#network-ip-settings-dialog').modal('hide');
                if (PageNetworkIpSettings.done)
                    PageNetworkIpSettings.done();
            }).
            fail(function (error) {
                $('#network-ip-settings-error').text(error.message || error.toString());
            });
    }

};

function PageNetworkIpSettings() {
    this._init();
}

function is_interface_connection(iface, connection) {
    return connection && connection.Interfaces.indexOf(iface) != -1;
}

function is_interesting_interface(iface) {
    return (!iface.Device ||
            iface.Device.DeviceType == 'ethernet' ||
            iface.Device.DeviceType == 'bond' ||
            iface.Device.DeviceType == 'vlan' ||
            iface.Device.DeviceType == 'bridge');
}

function array_find(array, predicate) {
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

function slave_connection_for_interface(master, iface) {
    return master && array_find(master.Slaves, function (s) {
        return is_interface_connection(iface, s);
    });
}

function slave_interface_choices(model, master) {
    return model.list_interfaces().filter(function (iface) {
        return !is_interface_connection(iface, master) && is_interesting_interface(iface);
    });
}

function render_slave_interface_choices(model, master) {
    return $('<ul class="list-group available-interfaces-group">').append(
        slave_interface_choices(model, master).map(function (iface) {
            return $('<li class="list-group-item">').append(
                $('<div class="checkbox">').
                    css('margin', "0px").
                    append(
                        $('<label>').append(
                            $('<input>', { 'type': "checkbox",
                                           'data-iface': iface.Name }).
                                prop('checked', !!slave_connection_for_interface(master, iface)),
                            $('<span>').text(iface.Name))));
        }));
}

function slave_chooser_btn(change, slave_choices) {
    var choices = [ { title: "-", choice: "", is_default: true } ];
    slave_choices.find('input[data-iface]').each(function (i, elt) {
        var name = $(elt).attr("data-iface");
        if ($(elt).prop('checked'))
            choices.push({ title: name, choice: name });
    });
    return shell.select_btn(change, choices);
}

function free_slave_connection(con) {
    if (con.Settings.connection.slave_type) {
        delete con.Settings.connection.slave_type;
        delete con.Settings.connection.master;
        return con.apply();
    }
}

function set_slave(model, master_connection, master_settings, slave_type,
                   iface_name, val) {
    var iface, uuid;
    var main_connection;

    iface = model.find_interface(iface_name);
    if (!iface)
        return false;

    function find_main_connection(cons) {
        cons.forEach(function(c) {
            if (!main_connection ||
                main_connection.Settings.connection.timestamp < c.Settings.connection.timestamp)
                main_connection = c;
        });
    }

    if (iface.Device)
        find_main_connection(iface.Device.AvailableConnections);
    else
        find_main_connection(iface.Connections);

    if (val) {
        /* Turn the main_connection into a slave for master, if
         * necessary.  If there is no main_connection, we assume that
         * this is a ethernet device and create a suitable connection.
         */

        if (!main_connection) {
            uuid = generate_uuid();
            return model.get_settings().add_connection({ connection:
                                                         { id: uuid,
                                                           uuid: uuid,
                                                           autoconnect: true,
                                                           type: "802-3-ethernet",
                                                           interface_name: iface.Name,
                                                           slave_type: slave_type,
                                                           master: master_settings.connection.uuid
                                                         },
                                                         "802-3-ethernet":
                                                         {
                                                         }
                                                       });
        } else if (main_connection.Settings.connection.master != master_settings.connection.uuid) {
            main_connection.Settings.connection.slave_type = slave_type;
            main_connection.Settings.connection.master = master_settings.connection.uuid;
            delete main_connection.Settings.ipv4;
            delete main_connection.Settings.ipv6;
            return main_connection.apply().then(function () {
                var dev = iface.Device;
                if (dev && dev.ActiveConnection && dev.ActiveConnection.Connection === main_connection)
                    return main_connection.activate(dev, null);
            });
        }
    } else {
        /* Free the main_connection from being a slave if it is our slave.  If there is
         * no main_connection, we don't need to do anything.
         */
        if (main_connection && main_connection.Settings.connection.master == master_settings.connection.uuid) {
            free_slave_connection(main_connection);
        }
    }

    return true;
}

function apply_master_slave(choices, model, master_connection, master_settings, slave_type) {
    var settings_manager = model.get_settings();

    function set_all_slaves() {
        var deferreds = choices.find('input[data-iface]').map(function (i, elt) {
            return set_slave(model, master_connection, master_settings, slave_type,
                             $(elt).attr("data-iface"), $(elt).prop('checked'));
        });
        return $.when.apply($, deferreds.get());
    }

    function update_master() {
        if (master_connection)
            return master_connection.apply();
        else
            return settings_manager.add_connection(master_settings);
    }

    return update_master().then(set_all_slaves);
}

PageNetworkBondSettings.prototype = {
    _init: function () {
        this.id = "network-bond-settings-dialog";
        this.bond_settings_template = $("#network-bond-settings-template").html();
        Mustache.parse(this.bond_settings_template);
    },

    setup: function () {
        $('#network-bond-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bond-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bond-settings-error').text("");
        if (PageNetworkBondSettings.connection)
            PageNetworkBondSettings.connection.freeze();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_slave_con: function(iface) {
        if (!PageNetworkBondSettings.connection)
            return null;

        return array_find(PageNetworkBondSettings.connection.Slaves, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkBondSettings.model;
        var master =  PageNetworkBondSettings.connection;
        var settings = PageNetworkBondSettings.settings;
        var options = settings.bond.options;

        var slaves_element;
        var mode_btn, primary_btn;
        var monitoring_btn, interval_input, targets_input, updelay_input, downdelay_input;

        function change_slaves() {
            var btn = slave_chooser_btn(change_mode, slaves_element);
            primary_btn.replaceWith(btn);
            primary_btn = btn;
            shell.select_btn_select(primary_btn, options.primary);
            change_mode();
        }

        function change_mode() {
            options.mode = shell.select_btn_selected(mode_btn);

            primary_btn.parents("tr").toggle(options.mode == "active-backup");
            if (options.mode == "active-backup")
                options.primary = shell.select_btn_selected(primary_btn);
            else
                delete options.primary;
        }

        function change_monitoring() {
            var use_mii = shell.select_btn_selected(monitoring_btn) == "mii";

            targets_input.parents("tr").toggle(!use_mii);
            updelay_input.parents("tr").toggle(use_mii);
            downdelay_input.parents("tr").toggle(use_mii);

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

        var body = $(Mustache.render(self.bond_settings_template, {
                       interface_name: settings.bond.interface_name,
                       monitoring_interval: options.miimon || options.arp_interval || "100",
                       monitoring_targets: options.arp_ip_targets,
                       link_up_delay: options.updelay || "0",
                       link_down_delay: options.downdelay || "0"
                   }));
        body.find('#network-bond-settings-interface-name-input').
                    change(function (event) {
                        var val = $(event.target).val();
                        settings.bond.interface_name = val;
                        settings.connection.interface_name = val;
                    });
        body.find('#network-bond-settings-members').
                      append(slaves_element = render_slave_interface_choices(model, master).
                             change(change_slaves));
        body.find('#network-bond-settings-mode-select').
                      append(mode_btn = shell.select_btn(change_mode, bond_mode_choices));
        body.find('#network-bond-settings-primary-select').
                      append(primary_btn = slave_chooser_btn(change_mode, slaves_element));
        body.find('#network-bond-settings-link-monitoring-select').
                      append(monitoring_btn = shell.select_btn(change_monitoring, bond_monitoring_choices));

        interval_input = body.find('#network-bond-settings-monitoring-interval-input');
        interval_input.change(change_monitoring);
        targets_input = body.find('#network-bond-settings-monitoring-targets-input');
        targets_input.change(change_monitoring);
        updelay_input = body.find('#network-bond-settings-link-up-delay-input');
        updelay_input.change(change_monitoring);
        downdelay_input = body.find('#network-bond-settings-link-down-delay-input');
        downdelay_input.change(change_monitoring);

        shell.select_btn_select(mode_btn, options.mode);
        shell.select_btn_select(monitoring_btn, (options.miimon !== 0)? "mii" : "arp");
        change_slaves();
        change_mode();
        change_monitoring();

        $('#network-bond-settings-body').html(body);
    },

    cancel: function() {
        if (PageNetworkBondSettings.connection)
            PageNetworkBondSettings.connection.reset();
        $('#network-bond-settings-dialog').modal('hide');
    },

    apply: function() {
        apply_master_slave($('#network-bond-settings-body'),
                           PageNetworkBondSettings.model,
                           PageNetworkBondSettings.connection,
                           PageNetworkBondSettings.settings,
                           "bond").
            done(function() {
                $('#network-bond-settings-dialog').modal('hide');
                if (PageNetworkBondSettings.done)
                    PageNetworkBondSettings.done();
            }).
            fail(function (error) {
                $('#network-bond-settings-error').text(error.message || error.toString());
            });
    }

};

function PageNetworkBondSettings() {
    this._init();
}

PageNetworkBridgeSettings.prototype = {
    _init: function () {
        this.id = "network-bridge-settings-dialog";
        this.bridge_settings_template = $("#network-bridge-settings-template").html();
        Mustache.parse(this.bridge_settings_template);
    },

    setup: function () {
        $('#network-bridge-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridge-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridge-settings-error').text("");
        if (PageNetworkBridgeSettings.connection)
            PageNetworkBridgeSettings.connection.freeze();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_slave_con: function(iface) {
        if (!PageNetworkBridgeSettings.connection)
            return null;

        return array_find(PageNetworkBridgeSettings.connection.Slaves, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkBridgeSettings.model;
        var settings = PageNetworkBridgeSettings.settings;
        var options = settings.bridge;

        var stp_input, priority_input, forward_delay_input, hello_time_input, max_age_input;

        function change_stp() {
            // XXX - handle parse errors
            options.stp = stp_input.prop('checked');
            options.priority = parseInt(priority_input.val(), 10);
            options.forward_delay = parseInt(forward_delay_input.val(), 10);
            options.hello_time = parseInt(hello_time_input.val(), 10);
            options.max_age = parseInt(max_age_input.val(), 10);

            priority_input.parents("tr").toggle(options.stp);
            forward_delay_input.parents("tr").toggle(options.stp);
            hello_time_input.parents("tr").toggle(options.stp);
            max_age_input.parents("tr").toggle(options.stp);
        }

        var body = $(Mustache.render(self.bridge_settings_template, {
                       bridge_name: options.interface_name,
                       stp_checked: options.stp,
                       stp_priority: options.priority,
                       stp_forward_delay: options.forward_delay,
                       stp_hello_time: options.hello_time,
                       stp_max_age: options.max_age
                   }));
        body.find('#network-bridge-settings-name-input').
                      change(function (event) {
                                var val = $(event.target).val();
                                options.interface_name = val;
                                settings.connection.interface_name = val;
                            });
        body.find('#network-bridge-settings-slave-interfaces').
                      append(render_slave_interface_choices(model, PageNetworkBridgeSettings.connection)).
                      parent().toggle(!PageNetworkBridgeSettings.connection);
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
        $('#network-bridge-settings-body').html(body);
    },

    cancel: function() {
        if (PageNetworkBridgeSettings.connection)
            PageNetworkBridgeSettings.connection.reset();
        $('#network-bridge-settings-dialog').modal('hide');
    },

    apply: function() {
        apply_master_slave($('#network-bridge-settings-body'),
                           PageNetworkBridgeSettings.model,
                           PageNetworkBridgeSettings.connection,
                           PageNetworkBridgeSettings.settings,
                           "bridge").
            done(function() {
                $('#network-bridge-settings-dialog').modal('hide');
                if (PageNetworkBridgeSettings.done)
                    PageNetworkBridgeSettings.done();
            }).
            fail(function (error) {
                $('#network-bridge-settings-error').text(error.message || error.toString());
            });
    }

};

function PageNetworkBridgeSettings() {
    this._init();
}

PageNetworkBridgePortSettings.prototype = {
    _init: function () {
        this.id = "network-bridgeport-settings-dialog";
        this.bridge_port_settings_template = $("#network-bridge-port-settings-template").html();
        Mustache.parse(this.bridge_port_settings_template);
    },

    setup: function () {
        $('#network-bridgeport-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridgeport-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridgeport-settings-error').text("");
        if (PageNetworkBridgePortSettings.connection)
            PageNetworkBridgePortSettings.connection.freeze();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var model = PageNetworkBridgePortSettings.model;
        var settings = PageNetworkBridgePortSettings.settings;
        var options = settings.bridge_port;

        var priority_input, path_cost_input, hairpin_mode_input;

        function change() {
            // XXX - handle parse errors
            options.priority = parseInt(priority_input.val(), 10);
            options.path_cost = parseInt(path_cost_input.val(), 10);
            options.hairpin_mode = hairpin_mode_input.prop('checked');
        }

        var body = $(Mustache.render(self.bridge_port_settings_template, {
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
        if (PageNetworkBridgePortSettings.connection)
            PageNetworkBridgePortSettings.connection.reset();
        $('#network-bridgeport-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkBridgePortSettings.model;
        var master_settings = PageNetworkBridgePortSettings.settings;
        var settings_manager = model.get_settings();

        function show_error(error) {
            $('#network-bridgeport-settings-error').text(error.message || error.toString());
        }

        function update_master() {
            if (PageNetworkBridgePortSettings.connection)
                return PageNetworkBridgePortSettings.connection.apply();
            else
                return settings_manager.add_connection(master_settings);
        }

        update_master().
            done(function () {
                $('#network-bridgeport-settings-dialog').modal('hide');
                if (PageNetworkBridgePortSettings.done)
                    PageNetworkBridgePortSettings.done();
            }).
            fail(show_error);
    }

};

function PageNetworkBridgePortSettings() {
    this._init();
}

PageNetworkVlanSettings.prototype = {
    _init: function () {
        this.id = "network-vlan-settings-dialog";
        this.vlan_settings_template = $("#network-vlan-settings-template").html();
        Mustache.parse(this.vlan_settings_template);
    },

    setup: function () {
        $('#network-vlan-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-vlan-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-vlan-settings-error').text("");
        if (PageNetworkVlanSettings.connection)
            PageNetworkVlanSettings.connection.freeze();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var model = PageNetworkVlanSettings.model;
        var settings = PageNetworkVlanSettings.settings;
        var options = settings.vlan;

        var auto_update_name = true;
        var parent_btn, id_input, name_input;

        function change() {
            // XXX - parse errors
            options.parent = shell.select_btn_selected(parent_btn);
            $("#network-vlan-settings-apply").toggleClass("disabled", !options.parent);

            options.id = parseInt(id_input.val(), 10);

            if (auto_update_name && options.parent && options.id)
                name_input.val(options.parent + "." + options.id);

            options.interface_name = name_input.val();
            settings.connection.interface_name = options.interface_name;
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


        var body = $(Mustache.render(self.vlan_settings_template, {
                       vlan_id: options.id || "1",
                       interface_name: options.interface_name
                   }));
        parent_btn = shell.select_btn(change, parent_choices);
        body.find('#network-vlan-settings-parent-select').html(parent_btn);
        id_input = body.find('#network-vlan-settings-vlan-id-input').
                       change(change).
                       on('input', change);
        name_input = body.find('#network-vlan-settings-interface-name-input').
                       change(change_name).
                       on('input', change_name);

        shell.select_btn_select(parent_btn, (options.parent ||
                                               (parent_choices[0] ?
                                                parent_choices[0].choice :
                                                "")));
        change();
        $('#network-vlan-settings-body').html(body);
    },

    cancel: function() {
        if (PageNetworkVlanSettings.connection)
            PageNetworkVlanSettings.connection.reset();
        $('#network-vlan-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkVlanSettings.model;
        var master_settings = PageNetworkVlanSettings.settings;
        var settings_manager = model.get_settings();

        function show_error(error) {
            $('#network-vlan-settings-error').text(error.message || error.toString());
        }

        function update_master() {
            if (PageNetworkVlanSettings.connection)
                return PageNetworkVlanSettings.connection.apply();
            else
                return settings_manager.add_connection(master_settings);
        }

        update_master().
            done(function () {
                $('#network-vlan-settings-dialog').modal('hide');
                if (PageNetworkVlanSettings.done)
                    PageNetworkVlanSettings.done();
            }).
            fail(show_error);
    }

};

function PageNetworkVlanSettings() {
    this._init();
}

/* INITIALIZATION AND NAVIGATION
 *
 * The code above still uses the legacy 'Page' abstraction for both
 * pages and dialogs, and expects page.setup, page.enter, page.show,
 * and page.leave to be called at the right times.
 *
 * We cater to this with a little compatability shim consisting of
 * 'dialog_setup', 'page_show', and 'page_hide'.
 */

function dialog_setup(d) {
    d.setup();
    $('#' + d.id).
        on('show.bs.modal', function () { d.enter(); }).
        on('shown.bs.modal', function () { d.show(); }).
        on('hidden.bs.modal', function () { d.leave(); });
}

function page_show(p, arg) {
    if (p._entered_)
        p.leave();
    p.enter(arg);
    p._entered_ = true;
    $('#' + p.id).show();
    p.show();
}

function page_hide(p) {
    $('#' + p.id).hide();
    if (p._entered_) {
        p.leave();
        p._entered_ = false;
    }
}

function init() {
    var model;
    var overview_page;
    var interface_page;

    function navigate() {
        var path = cockpit.location.path;

        if (path.length === 0) {
            page_hide(interface_page);
            page_show (overview_page);
        } else if (path.length === 1) {
            page_hide(overview_page);
            page_show(interface_page, path[0]);
        } else { /* redirect */
            console.warn("not a networking location: " + path);
            cockpit.location = '';
        }

        $("body").show();
    }

    cockpit.translate();

    model = new NetworkManagerModel();

    overview_page = new PageNetworking(model);
    overview_page.setup();

    interface_page = new PageNetworkInterface(model);
    interface_page.setup();

    dialog_setup(new PageNetworkIpSettings());
    dialog_setup(new PageNetworkBondSettings());
    dialog_setup(new PageNetworkBridgeSettings());
    dialog_setup(new PageNetworkBridgePortSettings());
    dialog_setup(new PageNetworkVlanSettings());

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

return init;

});
