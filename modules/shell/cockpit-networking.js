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

var cockpit = cockpit || { };

(function($, cockpit, cockpit_pages) {

function nm_debug() {
    if (cockpit.debugging == "all" || cockpit.debugging == "nm")
        console.debug.apply(console, arguments);
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
 *    model.manager.Devices[0].ActiveConnection.Ipv4Config.Addresses[0][0]
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
 *    model.manager.Devices[0].disconnect();
 *    model.manager.Devices[0].ActiveConnection.deactivate();
 *
 * Editing connection settings is supported directly:
 *
 *    connection = model.manager.Devices[0].AvailableConnections[0];
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

function NetworkManagerModel(address) {
    /*
     * The NetworkManager model doesn't need DBusObjects or
     * DBusInterfaces in its DBusClient.  Instead, it uses the 'raw'
     * events and method of DBusClient and constructs its own data
     * structure.  This has the advantage of avoiding wasting
     * resources for maintaining the unused proxies, avoids some code
     * complexity, and allows to do the right thing with the
     * pecularities of the NetworkManager API.
     *
     * However, we do use a fake object manager since that allows us
     * to avoid a lot of 'GetAll' round trips during initialization
     * and helps with removing obsolete objects.
     *
     * TODO - make sure that we receive information about new objects
     *        before they are referenced.
     */

    var self = this;

    var client = new DBusClient(address,
                                { 'bus':          "system",
                                  'service':      "org.freedesktop.NetworkManager",
                                  'object-paths': [ "/org/freedesktop/NetworkManager" ],
                                  'proxies':      false
                                });

    self.client = client;

    /* Mostly generic D-Bus stuff.

       TODO - make this more generic and factor it out.
     */

    var objects = { };

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
        if (!objects[path]) {
            function constructor() {
                this[' priv'] = { };
                priv(this).type = type;
                priv(this).path = path;
                for (var p in type.props)
                    this[p] = type.props[p].def;
            }
            constructor.prototype = type.prototype;
            objects[path] = new constructor();
            if (type.refresh)
                type.refresh(objects[path]);
            if (type.export_phase_0)
                type.export_phase_0(objects[path]);
        }
        return objects[path];
    }

    function peek_object(path) {
        return objects[path] || null;
    }

    function drop_object(path) {
        delete objects[path];
    }

    function set_object_properties(obj, props, prefix) {
        var p, decl, val;
        decl = priv(obj).type.props;
        prefix = prefix || "";
        for (p in decl) {
            val = props[prefix + (decl[p].prop || p)];
            if(val) {
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
                props[p] = props_with_sigs[p].val;
            }
        }
        return props;
    }

    function refresh_object_properties(obj) {
        var type = priv(obj).type;
        var path = priv(obj).path;
        push_refresh();
        type.interfaces.forEach(function (iface) {
            push_refresh();
            client.call(path, "org.freedesktop.DBus.Properties", "GetAll", iface,
                        function (error, result) {
                            if (!error)
                                set_object_properties(obj, remove_signatures(result));
                            pop_refresh();
                        });
        });
        if (type.refresh)
            type.refresh(obj);
        pop_refresh();
    }

    function objpath(obj) {
        if (obj && priv(obj).path)
            return priv(obj).path;
        else
            return "/";
    }

    function call_object_method(obj, iface, method) {
        var dfd = new $.Deferred();

        function slice_arguments(args, first, last) {
            return Array.prototype.slice.call(args, first, last);
        }

        client.call_with_args(objpath(obj), iface, method,
                              slice_arguments(arguments, 3),
                              function (error) {
                                  if (error)
                                      dfd.reject(error);
                                  else
                                      dfd.resolve.apply(dfd, slice_arguments(arguments, 1));
                              });
        return dfd.promise();
    }

    var interface_types = { };

    function set_object_types(all_types) {
        all_types.forEach(function (type) {
            type.interfaces.forEach(function (iface) {
                interface_types[iface] = type;
            });
        });
    }

    function signal_emitted (event, path, iface, signal, args) {
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

    function seed(event, data) {
        for (var path in data)
            object_added(event, path, data[path].ifaces);
    }

    function object_added(event, path, ifaces) {
        for (var iface in ifaces)
            interface_added(event, path, iface, ifaces[iface]);
    }

    function interface_added (event, path, iface, props) {
        var type = interface_types[iface];
        if (type)
            set_object_properties (get_object(path, type), props, "dbus_prop_");
    }

    function object_removed(event, path) {
        drop_object(path);
    }

    function export_model() {
        var phase, path, obj, meth;
        var again = true;
        for (phase = 0; again; phase++) {
            again = false;
            meth = "export_phase_" + phase;
            for (path in objects) {
                obj = objects[path];
                if (priv(obj).type[meth]) {
                    again = true;
                    priv(obj).type[meth](obj, phase);
                }
            }
        }

        model_changed();
    }

    $(client).on("signal", signal_emitted);
    $(client).on("seed", seed);
    $(client).on("object-added", object_added);
    $(client).on("interface-added", interface_added);
    $(client).on("object-removed", object_removed);

    self.close = function close() {
        $(client).off("signal", signal_emitted);
        $(client).off("seed", seed);
        $(client).off("object-added", object_added);
        $(client).off("interface-added", interface_added);
        $(client).off("object-removed", object_removed);
        client.close("unused");
    };

    /* NetworkManager specific data conversions and utility functions.
     */

    function toDec(n) {
        return n.toString(10);
    }

    function bytes_from_nm32(num) {
        var bytes = [], i;
        if (client.byteorder == "be") {
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
        if (client.byteorder == "be") {
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

    function ip4_from_nm(addr) {
        return [ ip4_to_text(addr[0]),
                 addr[1],
                 ip4_to_text(addr[2])
               ];
    }

    function ip4_to_nm(addr) {
        return [ ip4_from_text(addr[0]),
                 parseInt(addr[1], 10) || 24,
                 ip4_from_text(addr[2])
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
        return bytes;
    }

    function ip6_to_text(bytes) {
        var parts = [];
        for (var i = 0; i < 8; i++)
            parts[i] = ((bytes[2*i] << 8) + bytes[2*i+1]).toString(16);
        return parts.join(':');
    }

    function ip6_from_nm(addr) {
        return [ ip6_to_text(addr[0]),
                 addr[1],
                 ip6_to_text(addr[2])
               ];
    }

    function ip6_to_nm(addr) {
        return [ ip6_from_text(addr[0]),
                 parseInt(addr[1], 10) || 64,
                 ip6_from_text(addr[2])
               ];
    }


    function settings_from_nm(settings) {

        function get(first, second, def) {
            if (settings[first] && settings[first][second])
                return settings[first][second].val;
            else
                return def;
        }

        function get_ip(first, addr_from_nm, ip_to_text) {
            var meth = get(first, "method", "auto");
            var ign_dns = get(first, "ignore-auto-dns", false);
            if (meth == "auto" && ign_dns)
                meth = "auto-addr";
            if (meth == "dhcp" && ign_dns)
                meth = "dhcp-addr";

            return {
                method:       meth,
                addresses:    get(first, "addresses", []).map(addr_from_nm),
                dns:          get(first, "dns", []).map(ip_to_text),
                "dns-search": get(first, "dns-search", []).map(ip_to_text)
            };
        }

        var result = {
            connection: {
                type:        get("connection", "type"),
                uuid:        get("connection", "uuid"),
                id:          get("connection", "id", _("Unknown")),
                autoconnect: get("connection", "autoconnect", true),
                slave_type:  get("connection", "slave-type"),
                master:      get("connection", "master")
            }
        };

        if (!settings.connection.master) {
            result.ipv4 = get_ip("ipv4", ip4_from_nm, ip4_to_text);
            result.ipv6 = get_ip("ipv6", ip6_from_nm, ip6_to_text);
        }

        if (settings.bond)
            result.bond = { all: JSON.stringify(settings.bond),
                            "interface-name": get("bond", "interface-name")
                          };

        return result;
    }

    function settings_to_nm(settings, orig) {
        var result = $.extend(true, {}, orig);

        function set(first, second, sig, val) {
            if (!result[first])
                result[first] = { };
            result[first][second] = new DBusVariant(sig, val);
        }

        function set_ip(first, addrs_sig, addr_to_nm, ips_sig, ip_from_text) {
            var meth = settings[first].method;
            var ign_dns = undefined;

            if (meth == "auto-addr") {
                meth = "auto";
                ign_dns = true;
            } else if (meth == "dhcp-addr") {
                meth = "dhcp";
                ign_dns = true;
            } else if (meth == "auto" || meth == "dhcp") {
                ign_dns = false;
            }

            set(first, "method", 's', meth);
            if (ign_dns !== undefined)
                set(first, "ignore-auto-dns", 'b', ign_dns);

            set(first, "addresses", addrs_sig, settings[first].addresses.map(addr_to_nm));
            set(first, "dns", ips_sig, settings[first].dns.map(ip_from_text));
            set(first, "dns-search", 'as', settings[first]["dns-search"]);
        }

        set("connection", "id", 's', settings.connection.id);
        set("connection", "autoconnect", 'b', settings.connection.autoconnect);
        set_ip("ipv4", 'aau', ip4_to_nm, 'au', ip4_from_text);
        set_ip("ipv6", 'a(ayuay)', ip6_to_nm, 'aay', ip6_from_text);

        return result;
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
        case 30: return _("Disconnected");
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

    function refresh_all_devices() {
        for (var path in objects) {
            if (path.startsWith("/org/freedesktop/NetworkManager/Devices/"))
                refresh_object_properties(objects[path]);
        }
    }

    function refresh_settings(obj) {
        push_refresh();
        client.call(objpath(obj), "org.freedesktop.NetworkManager.Settings.Connection", "GetSettings",
                    function (error, result) {
                        if (result) {
                            priv(obj).orig = result;
                            if (!priv(obj).frozen) {
                                obj.Settings = settings_from_nm(result);
                            }
                        }
                        pop_refresh();
                    });
    }

    function refresh_udev(obj) {
        if (!obj.Udi.startsWith("/sys/"))
            return;

        push_refresh();
        cockpit.spawn(["/usr/bin/udevadm", "info", obj.Udi], { host: address }).
            done(function(res) {
                var props = { };
                function snarf_prop(line, env, prop) {
                    var prefix = "E: " + env + "=";
                    if (line.startsWith(prefix)) {
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

    function find_connection_by_uuid(uuid) {
        // TODO - Use a hashtable for this
        var path, iface, connections;
        var i;
        for (path in objects) {
            if (path.startsWith(":interface:")) {
                iface = objects[path];
                connections = iface.Connections;
                if (iface.Device)
                    connections = connections.concat(iface.Device.AvailableConnections);
                for (i = 0; i < connections.length; i++) {
                    if (connections[i].Settings.connection.uuid == uuid)
                        return connections[i];
                }
            }
        }
        return null;
    }

    /* NetworkManager specific object types, used by the generic D-Bus
     * code and using the data conversion functions.
     */

    var type_Ipv4Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP4Config"
        ],

        props: {
            Addresses:            { conv: conv_Array(ip4_from_nm), def: [] }
        }
    };

    var type_Ipv6Config = {
        interfaces: [
            "org.freedesktop.NetworkManager.IP6Config"
        ],

        props: {
            Addresses:            { conv: conv_Array(ip6_from_nm), def: [] }
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

        prototype: {
            freeze: function () {
                priv(this).frozen = true;
            },

            apply: function() {
                var self = this;
                return call_object_method(this,
                                          "org.freedesktop.NetworkManager.Settings.Connection", "Update",
                                          settings_to_nm(this.Settings, priv(this).orig)).
                    done(function () { priv(self).frozen = false; });
            },

            reset:  function () {
                this.Settings = settings_from_nm(priv(this).orig);
                priv(this).frozen = false;
                model_changed();
            },

            activate: function (dev, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(this), objpath(dev), objpath(specific_object));
            }
        },

        export_phase_0: function (obj) {
            obj.Slaves = [ ];
            obj.Interfaces = [ ];
        },

        // Sets: type_Interface.Connections
        //
        export_phase_1: function (obj) {
            if (obj.Settings.bond) {
                var iface = get_interface(obj.Settings.bond["interface-name"]);
                iface.Connections.push(obj);
            }
        },

        // Needs: type_Interface.Device
        //        type_Interface.Connections
        //
        // Sets:  type_Connection.Slaves
        //        type_Connection.Masters
        //
        export_phase_2: function (obj) {
            var master, iface;

            // Most of the time, a connection has zero or one masters,
            // but when a connection refers to its master by interface
            // name, we might end up with more than one master
            // connection so we just collect them all.
            //
            // TODO - Nail down how NM really handles this.

            obj.Masters = [ ];
            if (obj.Settings.connection.slave_type == "bond") {
                master = find_connection_by_uuid(obj.Settings.connection.master);
                if (master) {
                    obj.Masters.push(master);
                    master.Slaves.push(obj);
                } else {
                    function check_con(con) {
                        if (con.Settings.connection.type == "bond") {
                            obj.Masters.push(con);
                            con.Slaves.push(obj);
                        }
                    }

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
            "org.freedesktop.NetworkManager.Device.Bond"
        ],

        props: {
            DeviceType:           { },
            Interface:            { },
            StateText:            { prop: "State", conv: device_state_to_text,        def: _("Unknown") },
            State:                { },
            HwAddress:            { },
            AvailableConnections: { conv: conv_Array(conv_Object(type_Connection)),   def: [] },
            ActiveConnection:     { conv: conv_Object(type_ActiveConnection) },
            Udi:                  { trigger: refresh_udev },
            IdVendor:             { def: "" },
            IdModel:              { def: "" },
            Driver:               { def: "" }
            // See below for "Slaves"
        },

        prototype: {
            disconnect: function () {
                return call_object_method(this, 'org.freedesktop.NetworkManager.Device', 'Disconnect');
            }
        },

        // Sets: type_Interface.Device
        //
        export_phase_1: function (obj) {
            if (obj.Interface) {
                var iface = get_interface(obj.Interface);
                iface.Device = obj;
            }
        }
    };

    // The 'Interface' type does not correspond to any NetworkManager
    // object or interface.  We use it to represent a network device
    // that might or might not actually be known to the kernel, such
    // as the interface of a bond that is currently down.

    var type_Interface = {
        interfaces: [ ],

        export_phase_0: function (obj) {
            obj.Device = null;
            obj.Connections = [ ];
        },

        // Needs: type_Interface.Device
        //        type_Interface.Connections
        //
        export_phase_2: function (obj) {
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

    };

    function get_interface(iface) {
        var obj = get_object(":interface:" + iface, type_Interface);
        obj.Name = iface;
        return obj;
    }

    function peek_interface(iface) {
        return peek_object(":interface:" + iface);
    }

    var type_Manager = {
        interfaces: [
            "org.freedesktop.NetworkManager"
        ],

        props: {
            Devices:            { conv: conv_Array(conv_Object(type_Device)),           def: [] },
            ActiveConnections:  { conv: conv_Array(conv_Object(type_ActiveConnection)), def: [] }
        }
    };

    /* Now create the cycle declarations.
     */
    type_ActiveConnection.props.Master = { conv: conv_Object(type_Device) };
    type_Device.props.Slaves = { conv: conv_Array(conv_Object(type_Device)), def: [] };

    /* Exporting the model, called by the generic D-Bus code when
     * something has changed and everything has settled.
     */

    self.manager = null;

    var changed_pending;

    function model_changed() {
        self.manager = peek_object("/org/freedesktop/NetworkManager");

        if (!changed_pending) {
            changed_pending = true;
            setTimeout(function () { changed_pending = false; $(self).trigger('changed'); }, 300);
        }
    }

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

    /* Initialization.
     */

    set_object_types([ type_Manager,
                       type_Device,
                       type_Ipv4Config,
                       type_Ipv6Config,
                       type_Connection,
                       type_ActiveConnection
                     ]);

    get_object("/org/freedesktop/NetworkManager", type_Manager);
    return self;
}

var nm_models = cockpit.util.make_resource_cache();

function get_nm_model(machine) {
    return nm_models.get(machine, function () { return new NetworkManagerModel(machine); });
}

function network_log_box(client, elt)
{
    return cockpit_simple_logbox(client,
                                 elt, [ [ "_SYSTEMD_UNIT=NetworkManager.service" ],
                                        [ "_SYSTEMD_UNIT=firewalld.service" ]
                                      ], 10);
}

function render_interface_link(iface) {
    return $('<a>').
               text(iface).
               click(function () {
                   cockpit_go_sibling({ page: "network-interface",
                                        dev: iface
                                      });
               });
}

function render_connection_link(con) {
    var res =
        $('<span>').append(
            F("Connection %{id} of ", { id: con.Settings.connection.id }),
            array_join(
                con.Interfaces.map(function (iface) {
                    return $('<a>').
                        text(iface.Name).
                        click(function () {
                            cockpit_go_sibling({ page: "network-interface",
                                                 dev: iface.Name
                                               });
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

function render_active_connection(dev) {
    var parts = [ ];
    var con;

    if (!dev)
        return "";

    con = dev.ActiveConnection;

    if (con && con.Master) {
        return $('<span>').append(
                   $('<span>').text(_("Part of ")),
                   render_interface_link(con.Master.Interface));
    }

    if (con && con.Ip4Config) {
        con.Ip4Config.Addresses.forEach(function (a) {
            parts.push(a[0] + "/" + a[1]);
        });
    }

    if (con && con.Ip6Config) {
        con.Ip6Config.Addresses.forEach(function (a) {
            parts.push(a[0] + "/" + a[1]);
        });
    }

    return $('<span>').text(parts.join(", "));
}

PageNetworking.prototype = {
    _init: function () {
        this.id = "networking";
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    enter: function () {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        this.model = get_nm_model(this.address);
        cockpit.set_watched_client(this.model.client);

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function is_interesting_netdev(netdev) {
            return netdev && netdev != "lo";
        }

        function highlight_netdev_row(event, id) {
            $('#networking-interfaces tr').removeClass('highlight');
            if (id) {
                $('#networking-interfaces tr[data-interface="' + cockpit_esc(id) + '"]').addClass('highlight');
            }
        }

        function render_samples(event, timestamp, samples) {
            for (var id in samples) {
                var row = $('#networking-interfaces tr[data-sample-id="' + cockpit_esc(id) + '"]');
                if (row.length > 0) {
                    row.find('td:nth-child(3)').text(cockpit_format_bytes_per_sec(samples[id][1]));
                    row.find('td:nth-child(4)').text(cockpit_format_bytes_per_sec(samples[id][0]));
                }
            }
        }

        this.cockpitd = cockpit.dbus(this.address);
        this.monitor = this.cockpitd.get("/com/redhat/Cockpit/NetdevMonitor",
                                         "com.redhat.Cockpit.MultiResourceMonitor");

        $(this.monitor).on('NewSample.networking', render_samples);

        this.rx_plot = cockpit_setup_cgroups_plot ('#networking-rx-graph', this.monitor, 0, blues.concat(blues),
                                                   is_interesting_netdev);
        $(this.rx_plot).on('update-total', function (event, total) {
            $('#networking-rx-text').text(cockpit_format_bytes_per_sec(total));
        });
        $(this.rx_plot).on('highlight', highlight_netdev_row);

        this.tx_plot = cockpit_setup_cgroups_plot ('#networking-tx-graph', this.monitor, 1, blues.concat(blues),
                                                   is_interesting_netdev);
        $(this.tx_plot).on('update-total', function (event, total) {
            $('#networking-tx-text').text(cockpit_format_bytes_per_sec(total));
        });
        $(this.tx_plot).on('highlight', highlight_netdev_row);

        this.log_box = network_log_box(this.cockpitd, $('#networking-log'));

        $(this.model).on('changed.networking', $.proxy(this, "update_devices"));
        this.update_devices();
    },

    show: function() {
        this.rx_plot.start();
        this.tx_plot.start();
    },

    leave: function() {
        this.rx_plot.destroy();
        this.tx_plot.destroy();
        this.log_box.stop();

        cockpit.set_watched_client(null);
        $(this.model).off(".networking");
        this.model.release();
        this.model = null;

        $(this.monitor).off(".networking");
        this.cockpitd.release();
        this.cockpitd = null;
    },

    update_devices: function() {
        var self = this;
        var tbody;

        tbody = $('#networking-interfaces tbody');
        tbody.empty();

        self.model.list_interfaces().forEach(function (iface) {
            // Skip everything that is not ethernet or a bond
            if (iface.Device && iface.Device.DeviceType != 1 && iface.Device.DeviceType != 10)
                return;

            var dev = iface.Device;
            var is_active = (dev && dev.State == 100);

            tbody.append($('<tr>', { "data-interface": iface.Name,
                                     "data-sample-id": is_active? iface.Name : null
                                   }).
                         append($('<td>').text(iface.Name),
                                $('<td>').html(render_active_connection(dev)),
                                (is_active?
                                 [ $('<td>').text(""), $('<td>').text("") ] :
                                 $('<td colspan="2">').text(dev? dev.StateText : _("Not present")))).
                         click(function () { cockpit_go_down ({ page: 'network-interface',
                                                                dev: iface.Name
                                                              });
                                           }));
        });
    }

};

function PageNetworking() {
    this._init();
}

cockpit_pages.push(new PageNetworking());

var ipv4_method_choices =
    [
        { choice: 'auto',         title: _("Automatic (DHCP)") },
        { choice: 'auto-addr',    title: _("Automatic (DHCP), Addresses only") },
        { choice: 'link-local',   title: _("Link local") },
        { choice: 'manual',       title: _("Manual") },
        { choice: 'shared',       title: _("Shared") },
        { choice: 'disabled',     title: _("Disabled") }
    ];

var ipv6_method_choices =
    [
        { choice: 'auto',         title: _("Automatic") },
        { choice: 'auto-addr',    title: _("Automatic, Addresses only") },
        { choice: 'dhcp',         title: _("Automatic (DHCP only)") },
        { choice: 'dhcp-addr',    title: _("Automatic (DHCP only), Addresses only") },
        { choice: 'link-local',   title: _("Link local") },
        { choice: 'manual',       title: _("Manual") },
        { choice: 'ignore',       title: _("Ignore") }
    ];

PageNetworkInterface.prototype = {
    _init: function () {
        this.id = "network-interface";
        this.connection_mods = { };
    },

    getTitle: function() {
        return cockpit_get_page_param ("dev", "network-interface") || "?";
    },

    setup: function () {
        $('#network-interface-disconnect').click($.proxy(this, "disconnect"));
    },

    enter: function () {
        var self = this;

        self.address = cockpit_get_page_param('machine', 'server') || "localhost";
        self.model = get_nm_model(self.address);
        cockpit.set_watched_client(self.model.client);
        $(self.model).on('changed.network-interface', $.proxy(self, "update"));

        self.dev_name = cockpit_get_page_param('dev');

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function is_interesting_netdev(netdev) {
            return netdev == self.dev_name;
        }

        this.cockpitd = cockpit.dbus(this.address);
        this.monitor = this.cockpitd.get("/com/redhat/Cockpit/NetdevMonitor",
                                         "com.redhat.Cockpit.MultiResourceMonitor");

        this.rx_plot = cockpit_setup_cgroups_plot ('#network-interface-rx-graph', this.monitor, 0,
                                                   blues.concat(blues), is_interesting_netdev);
        $(this.rx_plot).on('update-total', function (event, total) {
            $('#network-interface-rx-text').text(cockpit_format_bytes_per_sec(total));
        });

        this.tx_plot = cockpit_setup_cgroups_plot ('#network-interface-tx-graph', this.monitor, 1,
                                                   blues.concat(blues), is_interesting_netdev);
        $(this.tx_plot).on('update-total', function (event, total) {
            $('#network-interface-tx-text').text(cockpit_format_bytes_per_sec(total));
        });

        self.dev = null;
        self.update();
    },

    show: function() {
        this.rx_plot.start();
        this.tx_plot.start();
    },

    leave: function() {
        this.rx_plot.destroy();
        this.tx_plot.destroy();

        cockpit.set_watched_client(null);
        $(this.model).off(".network-interface");
        this.model.release();
        this.model = null;
        this.dev = null;

        this.cockpitd.release();
        this.cockpitd = null;
    },

    disconnect: function() {
        if (this.dev)
            this.dev.disconnect().fail(cockpit_show_unexpected_error);
    },

    update: function() {
        var self = this;

        var $hw = $('#network-interface-hw');
        var $connections = $('#network-interface-connections');

        var iface = self.model.find_interface(self.dev_name);
        var dev = iface && iface.Device;
        self.dev = dev;

        if (dev) {
            var desc;
            if (dev.DeviceType == 1) {
                desc = $('<span>').text(F("%{IdVendor} %{IdModel} (%{Driver})", dev));
            } else if (dev.DeviceType == 10) {
                if (dev.Slaves.length === 0)
                    desc = $('<span>').text("Bond without active parts");
                else {
                    desc = $('<span>').append(
                        $('<span>').text("Bond of "),
                        array_join(dev.Slaves.map(function (s) {
                            return render_interface_link(s.Interface);
                        }), ", "));
                }
            }

            $hw.html(
                $('<div class="panel-body">').append(
                    $('<div>').append(
                        desc,
                        $('<span style="float:right">').text(dev.HwAddress)),
                    $('<div>').append(
                        $('<span>').html(render_active_connection(dev)),
                        $('<span style="float:right">').text(dev.StateText))));

            $('#network-interface-disconnect').prop('disabled', !dev.ActiveConnection);
        } else {
            $hw.html(
                $('<div class="panel-body">').append(
                    $('<div>').text("--")));
            $('#network-interface-disconnect').prop('disabled', true);
        }


        function render_connection(con) {

            if (!con || !con.Settings)
                return [ ];

            var is_active = dev && dev.ActiveConnection && dev.ActiveConnection.Connection === con;

            function apply() {
                con.apply().fail(cockpit_show_unexpected_error);
            }

            function activate_connection() {
                con.activate(dev, null).
                    fail(cockpit_show_unexpected_error);
            }

            function deactivate_connection() {
                if (dev && dev.ActiveConnection) {
                    dev.ActiveConnection.deactivate().
                        fail(cockpit_show_unexpected_error);
                }
            }

            function render_ip_settings(topic) {
                var params = con.Settings[topic];
                var parts = [];

                function choice_title(choices, choice, def) {
                    for (var i = 0; i < choices.length; i++) {
                        if (choices[i].choice == choice)
                            return choices[i].title;
                    }
                    return def;
                }

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
                    parts.push(F(addr_is_extra? "Additional address %{val}" : "Address %{val}",
                                 { val: addrs.join(", ") }));

                var dns_is_extra = (!params["ignore-auto-dns"] && params.method != "manual");
                if (params.dns.length > 0)
                    parts.push(F(dns_is_extra? "Additional DNS %{val}" : "DNS %{val}",
                                 { val: params.dns.join(", ") }));
                if (params["dns-search"].length > 0)
                    parts.push(F(dns_is_extra? "Additional DNS Search Domains %{val}" : "DNS Search Domains %{val}",
                                 { val: params["dns-search"].join(", ") }));

                return parts.join(", ");
            }

            function change_id(event) {
                con.Settings.connection.id = $(event.target).val();
                apply();
            }

            function configure_ip_settings(topic) {
                PageNetworkIpSettings.connection = con;
                PageNetworkIpSettings.topic = topic;
                PageNetworkIpSettings.done = is_active? activate_connection : null;
                $('#network-ip-settings-dialog').modal('show');
            }

            function onoffbox(val, on, off) {
                function toggle(event) {
                    $(this).find('.btn').toggleClass('active');
                    $(this).find('.btn').toggleClass('btn-primary');
                    $(this).find('.btn').toggleClass('btn-default');
                    if ($(this).find("button:first-child").hasClass('active')) {
                        if (off)
                            on();
                        else
                            on(true);
                    } else {
                        if (off)
                            off();
                        else
                            on(false);
                    }
                }

                var box =
                    $('<div class="btn-group btn-toggle">').append(
                        $('<button class="btn">').
                            text("On").
                            addClass(!val? "btn-default" : "btn-primary active"),
                        $('<button class="btn">').
                            text("Off").
                            addClass(val? "btn-default" : "btn-primary active")).
                    click(toggle);
                return box;
            }

            function render_ip_settings_row(topic, title) {
                if (!con.Settings[topic])
                    return null;

                return $('<tr>').append(
                    $('<td>').text(title),
                    $('<td>').text(render_ip_settings(topic)),
                    $('<td style="text-align:right">').append(
                        $('<button class="btn btn-default">').
                            text(_("Configure")).
                            click(function () {
                                configure_ip_settings(topic);
                            })));
            }

            function render_master() {
                if (con.Masters.length > 0) {
                    return $('<tr>').append(
                        $('<td>').text(_("Master")),
                        $('<td>').append(
                            array_join(con.Masters.map(render_connection_link), ", ")));
                } else
                    return null;
            }

            function render_bond_settings_row() {
                if (!con.Settings.bond)
                    return null;

                return [ $('<tr>').append(
                             $('<td>').text(_("Bond")),
                             $('<td>').text(con.Settings.bond.all),
                             $('<td style="text-align:right">').append(
                                 $('<button class="btn btn-default">').
                                     text(_("Configure")).
                                     click(function () {
                                         // TODO
                                     }))),
                         $('<tr>').append(
                             $('<td>'),
                             $('<td>').html(array_join(
                                 con.Slaves.map(function (con) {
                                     return render_connection_link(con);
                                 }),
                                 ", ")))
                       ];
            }

            var $panel =
                $('<div class="panel panel-default">').append(
                    $('<div class="panel-heading">').append(
                        $('<input>').
                            val(con.Settings.connection.id).
                            change(change_id),
                        onoffbox(is_active, activate_connection, deactivate_connection).
                            css("float", "right")),
                    $('<div class="panel-body">').append(
                        $('<table class="cockpit-form-table">').append(
                            render_master(),
                            $('<tr>').append(
                                $('<td>').text("Connect automatically"),
                                $('<td>').append(
                                    onoffbox(con.Settings.connection.autoconnect,
                                             function (val) {
                                                 con.Settings.connection.autoconnect = val;
                                                 apply();
                                             }))),
                            render_ip_settings_row("ipv4", _("IPv4")),
                            render_ip_settings_row("ipv6", _("IPv6")),
                            render_bond_settings_row())));

            return $panel;
        }

        $connections.empty();
        function append_connection(con) {
            $connections.append(render_connection(con));
        }

        if (iface) {
            if (iface.Device)
                iface.Device.AvailableConnections.forEach(append_connection);
            else
                iface.Connections.forEach(append_connection);
        }
    }

};

PageNetworkIpSettings.prototype = {
    _init: function () {
        this.id = "network-ip-settings-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Network Ip Settings");
    },

    setup: function () {
        $('#network-ip-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-ip-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-ip-settings-error').text("");
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var con = PageNetworkIpSettings.connection;
        var topic = PageNetworkIpSettings.topic;
        var params = con.Settings[topic];

        function choicebox(p, choices) {
            var btn = cockpit_select_btn(
                function (choice) {
                    params[p] = choice;
                },
                choices);
            cockpit_select_btn_select(btn, params[p]);
            btn.css('margin-bottom', "19px");
            return btn;
        }

        function boolbox(p, text, inverted) {
            var btn = cockpit_select_btn(function (choice) { params[p] = (choice == "on"); },
                                         [ { choice: inverted? 'off':'on', title: _("Yes") },
                                           { choice: inverted? 'on':'off', title: _("No") }
                                         ]);
            cockpit_select_btn_select(btn, params[p]? 'on':'off');
            return $('<div style="margin-bottom:19px">').append(
                $('<span style="margin-right:10px">').text(text),
                btn);
        }

        function tablebox(p, columns, def) {
            var direct = false;

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
                $('<div class="panel panel-default">').append(
                    $('<table class="table">').append(
                        $('<tr>').append(
                            columns.map(function (c) {
                                return $('<th>').text(c);
                            }),
                            $('<th style="text-align:right">').append(
                                $('<button class="btn btn-default">').
                                    text(_("Add")).
                                    click(add()))),
                        params[p].map(function (a, i) {
                            return ($('<tr>').append(
                                columns.map(function (c, j) {
                                    return $('<td>').append(
                                        $('<input class="form-control">').
                                            val(get(i,j)).
                                            change(function (event) {
                                                set(i,j, $(event.target).val());
                                            }));
                                }),
                                $('<td style="text-align:right">').append(
                                    $('<button class="btn btn-default">').
                                        text(_("X")).
                                        click(remove(i)))));
                        })));
            return panel;
        }

        function render_ip_settings() {
            var body =
                $('<div>').append(
                    $('<div>').append(
                        $('<span>').text(_("Method: ")),
                        choicebox("method", (topic == "ipv4")? ipv4_method_choices : ipv6_method_choices)),
                    tablebox("addresses", [ "Address", "Netmask", "Gateway" ],
                             (topic == "ipv4")? [ "", "24", "" ] : [ "", "64", "" ]),
                    tablebox("dns", "DNS Server", ""),
                    tablebox("dns-search", "DNS Search Domains", ""));
            return body;
        }

        $('#network-ip-settings-dialog .modal-title').text(
            (topic == "ipv4")? _("IPv4 Settings") : _("IPv6 Settings"));
        $('#network-ip-settings-body').html(render_ip_settings());
    },

    cancel: function() {
        PageNetworkIpSettings.connection.reset();
        $('#network-ip-settings-dialog').modal('hide');
    },

    apply: function() {
        PageNetworkIpSettings.connection.apply().
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

function PageNetworkInterface() {
    this._init();
}

cockpit_pages.push(new PageNetworkInterface());


function PageNetworkIpSettings() {
    this._init();
}

cockpit_pages.push(new PageNetworkIpSettings());

})($, cockpit, cockpit_pages);
