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

PageNetworking.prototype = {
    _init: function () {
        this.id = "networking";
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    enter: function () {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address,
                                    { 'bus': 'system',
                                      'service': "org.freedesktop.NetworkManager",
                                      'object-paths': [ "/org/freedesktop/NetworkManager" ],
                                      'protocol': "dbus-json1"
                                    });

        this.manager = this.client.get("/org/freedesktop/NetworkManager",
                                       "org.freedesktop.NetworkManager");

        $(this.client).on("objectAdded.networking", $.proxy(this, "trigger_update_devices"));
        $(this.client).on("objectRemoved.networking", $.proxy(this, "trigger_update_devices"));
        $(this.client).on("interfaceAdded.networking", $.proxy(this, "trigger_update_devices"));
        $(this.client).on("interfaceRemoved.networking", $.proxy(this, "trigger_update_devices"));
        $(this.client).on("propertiesChanged.networking", $.proxy(this, "trigger_update_devices"));
        $(this.client).on("signalEmitted.networking", $.proxy(this, "handle_signal"));
        this.update_devices();
    },

    show: function() {
    },

    leave: function() {
        $(this.manager).off(".networking");
        $(this.client).off(".networking");
        this.client.release();
        this.client = null;
    },

    handle_signal: function(event, iface, signal, args) {
        if (signal == "PropertiesChanged") {
            /* HACK
             *
             * NetworkManager interfaces have their own
             * PropertiesChanged signals, so we catch them here and
             * tell the interfaces to update their values.
             *
             * Unfortunatly, o.f.NM.Device doesn't have a
             * PropertiesChanged signal.  Instead, the specialized
             * interfaces like o.f.NM.Device.Wired do double duty:
             * Their PropertiesChanged signals contain change
             * notifications for both themselves and the o.f.NM.Device
             * properties.
             *
             * In order to make this work, we put all properties of
             * o.f.NM.Device.* interfaces into the o.f.NM.Device
             * interface, and access them there.
             *
             * https://bugzilla.gnome.org/show_bug.cgi?id=729826
             */

            if (iface._iface_name.startsWith("org.freedesktop.NetworkManager.Device."))
                iface = iface._client.get(iface.getObject().objectPath,
                                          "org.freedesktop.NetworkManager.Device");

            if (iface)
                iface.propertiesChanged(args[0]);
        } else if (signal == "Updated") {
            /* HACK
             *
             * Some versions of NetworkManager don't always send
             * PropertyChanged notifications about the
             * o.f.NM.Device.Ip4Config property.
             *
             * https://bugzilla.gnome.org/show_bug.cgi?id=729828
             */
            this.refresh_device_props();
        }
    },

    refresh_device_props: function() {
        var self = this;
        var devices = self.manager.Devices || [];
        devices.forEach(function (objpath) {
            var props = self.client.get(objpath, "org.freedesktop.DBus.Properties");
            var device = self.client.get(objpath, "org.freedesktop.NetworkManager.Device");
            props.call('GetAll', "org.freedesktop.NetworkManager.Device",
                       function (error, result) {
                           if (!error) {
                               device.propertiesChanged(result);
                           }
                       });
        });
    },

    trigger_update_devices: function() {
        if (!this.udpate_devices_pending) {
            this.udpate_devices_pending = true;
            setTimeout($.proxy(this, "update_devices"), 0);
        }
    },

    update_devices: function() {
        var self = this;

        self.udpate_devices_pending = false;

        var i;
        var devices = this.manager.Devices || [];
        var addresses;
        var device, ip4config, ip6config;
        var tbody;

        function toDec(n) {
            return n.toString(10);
        }

        function toHex(n) {
            var x = n.toString(16);
            while (x.length < 2)
                x = '0' + x;
            return x;
        }

        function net32_to_bytes(num) {
            var bytes = [], i;
            if (self.client.byteorder == "be") {
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

        function render_ip4_address(addr) {
            var num = addr[0];
            var bytes = net32_to_bytes(addr[0]);
            var prefix = addr[1];
            return bytes.map(toDec).join('.') + '/' + toDec(addr[1]);
        }

        function render_ip6_address(addr) {
            var bytes = addr[0];
            var prefix = addr[1];
            return bytes.map(toHex).join(':') + '/' + toDec(addr[1]);
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

        function merge_props(iface, other_iface, props) {
            var other = self.client.lookup(devices[i], other_iface);
            if (other) {
                props.forEach(function (p) {
                    if (!iface[p])
                        iface[p] = other[p];
                });
            }
        }

        tbody = $('#networking-interfaces tbody');
        tbody.empty();
        for (i = 0; i < devices.length; i++) {
            device = this.client.lookup(devices[i], "org.freedesktop.NetworkManager.Device");

            if (!device)
                continue;

            // Skip loopback
            if (device.DeviceType == 14)
                continue;

            merge_props(device, "org.freedesktop.NetworkManager.Device.Wired",
                        [ "HwAddress" ]);

            addresses = [ ];

            ip4config = this.client.lookup(device.Ip4Config, "org.freedesktop.NetworkManager.IP4Config");
            if (ip4config && ip4config.Addresses) {
                ip4config.Addresses.forEach(function (a) {
                    addresses.push(render_ip4_address(a));
                });
            }

            ip6config = this.client.lookup(device.Ip6Config, "org.freedesktop.NetworkManager.IP6Config");
            if (ip6config && ip6config.Addresses) {
                ip6config.Addresses.forEach(function (a) {
                    addresses.push(render_ip6_address(a));
                });
            }

            tbody.append(
                $('<tr>').append(
                    $('<td>').text(device.Interface),
                    $('<td>').text(addresses.join(", ")),
                    $('<td>').text(device.HwAddress),
                    $('<td>').text(device_state_to_text(device.State))));
        }
    }

};

function PageNetworking() {
    this._init();
}

cockpit_pages.push(new PageNetworking());
