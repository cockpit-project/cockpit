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

function NetworkManagerModel(address) {
    var self = this;

    var client = new DBusClient(address,
                                { 'bus':          "system",
                                  'service':      "org.freedesktop.NetworkManager",
                                  'object-paths': [ "/org/freedesktop/NetworkManager" ]
                                });

    self.client = client;

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

    function get_object(path, type) {
        if (path == "/")
            return null;
        if (!objects[path]) {
            function constructor() {
                this[' type'] = type;
                this[' path'] = path;
                if (type) {
                    for (var p in type.props)
                        this[p] = type.props[p].def;
                }
            }
            if (type)
                constructor.prototype = type.prototype;
            objects[path] = new constructor();
        }
        return objects[path];
    }

    function set_object_properties(obj, props) {
        var p, decl, val;
        decl = obj[' type'].props;
        for (p in decl) {
            if(props[p]) {
                val = props[p];
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

    function objpath(obj) {
        if (obj && obj[' path'])
            return obj[' path'];
        else
            return "/";
    }

    function call_object_method(obj, iface, method) {
        var dfd = new $.Deferred();
        var proxy = client.get(obj[' path'], iface);

        function slice_arguments(args, first, last) {
            return Array.prototype.slice.call(args, first, last);
        }

        proxy.call_with_args(method, slice_arguments(arguments, 3), function (error) {
            if (error)
                dfd.reject(error);
            else
                dfd.resolve.apply(dfd, slice_arguments(arguments, 1));
        });
        return dfd.promise();
    }

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

        return {
            connection: {
                id:          get("connection", "id", _("Unknown")),
                autoconnect: get("connection", "autoconnect", true)
            },
            ipv4: get_ip("ipv4", ip4_from_nm, ip4_to_text),
            ipv6: get_ip("ipv6", ip6_from_nm, ip6_to_text)
        };
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

    var type_Ipv4Config = {
        props: {
            Addresses:            { conv: conv_Array(ip4_from_nm), def: [] }
        }
    };

    var type_Ipv6Config = {
        props: {
            Addresses:            { conv: conv_Array(ip6_from_nm), def: [] }
        }
    };

    var type_Connection = {
        props: {
            Unsaved:              { }
        },

        prototype: {
            freeze: function () {
                this[' frozen'] = true;
            },

            apply: function() {
                return call_object_method(this,
                                          "org.freedesktop.NetworkManager.Settings.Connection", "Update",
                                          settings_to_nm(this.Settings, this[' orig'])).
                    done(function () { this[' frozen'] = false; });
            },

            reset:  function () {
                this.Settings = settings_from_nm(this[' orig']);
                this[' frozen'] = false;
                export_model();
            },

            activate: function (dev, specific_object) {
                return call_object_method(get_object("/org/freedesktop/NetworkManager", type_Manager),
                                          "org.freedesktop.NetworkManager", "ActivateConnection",
                                          objpath(this), objpath(dev), objpath(specific_object));
            }
        }
    };

    var type_ActiveConnection = {
        props: {
            Connection:           { conv: conv_Object(type_Connection) }
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
        props: {
            DeviceType:           { },
            Interface:            { },
            Ip4Config:            { conv: conv_Object(type_Ipv4Config) },
            Ip6Config:            { conv: conv_Object(type_Ipv6Config) },
            State:                { conv: device_state_to_text,                       def: _("Unknown") },
            HwAddress:            { },
            AvailableConnections: { conv: conv_Array(conv_Object(type_Connection)),   def: [] },
            ActiveConnection:     { conv: conv_Object(type_ActiveConnection) },
            Udi:                  { trigger: refresh_udev },
            IdVendor:             { def: "" },
            IdModel:              { def: "" },
            Driver:               { def: "" }
        },

        prototype: {
            disconnect: function () {
                return call_object_method(this, 'org.freedesktop.NetworkManager.Device', 'Disconnect');
            }
        }
    };

    var type_Manager = {
        props: {
            Devices:            { conv: conv_Array(conv_Object(type_Device)),           def: [] },
            ActiveConnections:  { conv: conv_Array(conv_Object(type_ActiveConnection)), def: [] }
        }
    };

    var interface_types = {
        "org.freedesktop.NetworkManager":                     type_Manager,
        "org.freedesktop.NetworkManager.Device":              type_Device,
        "org.freedesktop.NetworkManager.IP4Config":           type_Ipv4Config,
        "org.freedesktop.NetworkManager.IP6Config":           type_Ipv6Config,
        "org.freedesktop.NetworkManager.Settings.Connection": type_Connection,
        "org.freedesktop.NetworkManager.Connection.Active":   type_ActiveConnection
    };

    function model_properties_changed (path, iface, props) {
        /* HACK
         *
         * NetworkManager interfaces have their own PropertiesChanged
         * signals, so we catch them here.
         *
         * Unfortunatly, o.f.NM.Device doesn't have a PropertiesChanged
         * signal.  Instead, the specialized interfaces like
         * o.f.NM.Device.Wired do double duty: Their PropertiesChanged signals
         * contain change notifications for both themselves and the
         * o.f.NM.Device properties.
         *
         * We 'solve' this here by merging the properties of all interfaces
         * for a given object.
         *
         * https://bugzilla.gnome.org/show_bug.cgi?id=729826
         */
        if (iface.startsWith("org.freedesktop.NetworkManager.Device."))
            iface = "org.freedesktop.NetworkManager.Device";

        var type = interface_types[iface];
        if (type) {
            set_object_properties(get_object(path, type), props);
            export_model();
        }
    }

    function model_removed (path) {
        delete objects[path];
    }

    function model_refresh (path, iface) {
        var p = client.get(path, "org.freedesktop.DBus.Properties");
        p.call('GetAll', iface,
               function (error, result) {
                   if (!error) {
                       model_properties_changed(path, iface, remove_signatures(result));
                       if (iface == "org.freedesktop.NetworkManager.Settings.Connection") {
                           var proxy = client.get(path, iface);
                           refresh_settings(proxy);
                       }
                   }
               });
    }

    var changed_pending;

    self.devices = [ ];

    function export_model() {
        var manager = objects["/org/freedesktop/NetworkManager"];
        self.devices = (manager && manager.Devices) || [];

        if (!changed_pending) {
            changed_pending = true;
            setTimeout(function () { changed_pending = false; $(self).trigger('changed'); }, 0);
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

    function refresh_all_devices() {
        for (var path in objects) {
            if (path.startsWith("/org/freedesktop/NetworkManager/Devices/")) {
                model_refresh(path, "org.freedesktop.NetworkManager.Device");
                model_refresh(path, "org.freedesktop.NetworkManager.Wired");
            }
        }
    }

    function refresh_settings(iface) {
        iface.call('GetSettings', function (error, result) {
            if (result) {
                var path = iface.getObject().objectPath;
                var obj = get_object(path, type_Connection);
                obj[' orig'] = result;
                if (!obj[' frozen']) {
                    obj.Settings = settings_from_nm(result);
                    export_model ();
                }
            }
        });
    }

    function refresh_udev(obj) {
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
                export_model();
            }).
            fail(function(ex) {
                console.warn(ex);
            });
    }

    function object_added (event, object) {
        for (var iface in object._ifaces)
            interface_added (event, object, object._ifaces[iface]);
    }

    function object_removed (event, object) {
        for (var iface in object._ifaces)
            interface_removed (event, object, object._ifaces[iface]);
    }

    function interface_added (event, object, iface) {
        var path = object.objectPath;
        model_properties_changed (path, iface._iface_name, iface);
        if (iface._iface_name == "org.freedesktop.NetworkManager.Settings.Connection")
            refresh_settings(iface);
    }

    function interface_removed (event, object, iface) {
        var path = object.objectPath;
        model_removed (path);
    }

    function signal_emitted (event, iface, signal, args) {
        if (signal == "PropertiesChanged") {
            var path = iface.getObject().objectPath;
            model_properties_changed (path, iface._iface_name, remove_signatures(args[0]));
        } else if (signal == "Updated") {
            refresh_settings(iface);

            /* HACK
             *
             * Some versions of NetworkManager don't always send
             * PropertyChanged notifications for the
             * o.f.NM.Device.Ip4Config property.
             *
             * https://bugzilla.gnome.org/show_bug.cgi?id=729828
             */
            refresh_all_devices();
        }
    }

    $(client).on("objectAdded", object_added);
    $(client).on("objectRemoved", object_removed);
    $(client).on("interfaceAdded", interface_added);
    $(client).on("interfaceRemoved", interface_removed);
    $(client).on("signalEmitted", signal_emitted);

    self.close = function close() {
        $(client).off("objectAdded", object_added);
        $(client).off("objectRemoved", object_removed);
        $(client).off("interfaceAdded", interface_added);
        $(client).off("interfaceRemoved", interface_removed);
        $(client).off("signalEmitted", signal_emitted);
        client.close("unused");
    };

    self.find_device = function find_device(iface) {
        for (var i = 0; i < self.devices.length; i++) {
            if (self.devices[i].Interface == iface)
                return self.devices[i];
        }
        return null;
    };

    client.getObjectsFrom("/").forEach(function (object) {
        for (var iface in object._ifaces)
            model_refresh (object.objectPath, iface);
    });

    return self;
}

var nm_models = cockpit.util.make_resource_cache();

function get_nm_model(machine) {
    return nm_models.get(machine, function () { return new NetworkManagerModel(machine); });
}

function render_device_addresses(dev) {
    var addresses = [ ];

    var ip4config = dev.Ip4Config;
    if (ip4config && ip4config.Addresses) {
        ip4config.Addresses.forEach(function (a) {
            addresses.push(a[0] + "/" + a[1]);
        });
    }

    var ip6config = dev.Ip6Config;
    if (ip6config && ip6config.Addresses) {
        ip6config.Addresses.forEach(function (a) {
            addresses.push(a[0] + "/" + a[1]);
        });
    }

    return addresses.join(", ");
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
        $(this.model).on('changed.networking', $.proxy(this, "update_devices"));
        this.update_devices();
    },

    show: function() {
    },

    leave: function() {
        cockpit.set_watched_client(null);
        $(this.model).off(".networking");
        this.model.release();
        this.model = null;
    },

    update_devices: function() {
        var self = this;
        var tbody;

        tbody = $('#networking-interfaces tbody');
        tbody.empty();
        self.model.devices.forEach(function (dev) {
            if (!dev)
                return;

            // Skip everything that is not ethernet
            if (dev.DeviceType != 1)
                return;

            tbody.append($('<tr>').
                         append($('<td>').text(dev.Interface),
                                $('<td>').text(render_device_addresses(dev)),
                                $('<td>').text(dev.HwAddress),
                                $('<td>').text(dev.State)).
                         click(function () { cockpit_go_down ({ page: 'network-interface',
                                                                dev: dev.Interface
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
        return C_("page-title", "Network Interface");
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

        self.dev = null;
        self.update();
    },

    show: function() {
    },

    leave: function() {
        cockpit.set_watched_client(null);
        $(this.model).off(".network-interface");
        this.model.release();
        this.model = null;
        this.dev = null;
    },

    disconnect: function() {
        if (this.dev)
            this.dev.disconnect().fail(cockpit_show_unexpected_error);
    },

    update: function() {
        var self = this;

        var $hw = $('#network-interface-hw');
        var $connections = $('#network-interface-connections');

        $hw.empty();
        $connections.empty();

        var dev = self.model.find_device(cockpit_get_page_param('dev'));
        if (!dev)
            return;

        self.dev = dev;

        $hw.append($('<table class="table">').
                   append($('<tr>').
                          append($('<td>').text(dev.Driver),
                                 $('<td>').text(dev.IdVendor),
                                 $('<td>').text(dev.IdModel),
                                 $('<td>').text(dev.HwAddress)),
                          $('<tr>').
                          append($('<td>').text(dev.Interface),
                                 $('<td colspan="2">').text(render_device_addresses(dev)),
                                 $('<td>').text(dev.State))));

        $('#network-interface-disconnect').prop('disabled', !dev.ActiveConnection);

        function render_connection(con) {

            if (!con || !con.Settings)
                return [ ];

            var is_active = dev.ActiveConnection && dev.ActiveConnection.Connection === con;

            function apply() {
                con.apply().fail(cockpit_show_unexpected_error);
            }

            function activate_connection() {
                con.activate(self.dev, null).
                    done(function() {
                        con.Settings.connection.autoconnect = true;
                        apply();
                    }).
                    fail(cockpit_show_unexpected_error);
            }

            function deactivate_connection() {
                if (self.dev.ActiveConnection) {
                    self.dev.ActiveConnection.deactivate().
                        done(function () {
                            con.Settings.connection.autoconnect = false;
                            apply();
                        }).
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

            function toggle_onoff(event) {
                $(this).find('.btn').toggleClass('active');
                $(this).find('.btn').toggleClass('btn-primary');
                $(this).find('.btn').toggleClass('btn-default');
                if ($(this).find("button:first-child").hasClass('active'))
                    activate_connection();
                else
                    deactivate_connection();
            }

            var $panel =
                $('<div class="panel panel-default">').append(
                    $('<div class="panel-heading">').append(
                        $('<input>').
                            val(con.Settings.connection.id).
                            change(change_id),
                        $('<span>').text(
                            (is_active && !con.Settings.connection.autoconnect)?
                                " (active now, but wont be active after next boot)" :
                                ""),
                        $('<div class="btn-group btn-toggle" style="float:right">').append(
                            $('<button class="btn">').
                                text("On").
                                addClass(!is_active? "btn-default" : "btn-primary active"),
                            $('<button class="btn">').
                                text("Off").
                                addClass(is_active? "btn-default" : "btn-primary active")).
                            click(toggle_onoff)),
                    $('<div class="panel-body">').append(
                        $('<table class="cockpit-form-table">').append(
                            $('<tr>').append(
                                $('<td>').text("IPv4"),
                                $('<td>').text(render_ip_settings("ipv4")),
                                $('<td style="text-align:right">').append(
                                    $('<button class="btn btn-default">').
                                        text(_("Configure")).
                                        click(function () {
                                            configure_ip_settings("ipv4");
                                        }))),
                            $('<tr>').append(
                                $('<td>').text("IPv6"),
                                $('<td>').text(render_ip_settings("ipv6")),
                                $('<td style="text-align:right">').append(
                                    $('<button class="btn btn-default">').
                                        text(_("Configure")).
                                        click(function () {
                                            configure_ip_settings("ipv6");
                                        }))))));
            return $panel;
        }

        (dev.AvailableConnections || []).forEach(function (con) {
            $connections.append(render_connection(con));
        });
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
                    choicebox("method", (topic == "ipv4")? ipv4_method_choices : ipv6_method_choices),
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
