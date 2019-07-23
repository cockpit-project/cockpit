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
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import cockpit from 'cockpit';

import firewall from './firewall-client.js';
import * as utils from './utils';
import * as service from 'service';

import { mustache } from 'mustache';
import * as plot from 'plot.js';
import { journal } from 'journal';

/* jQuery extensions */
import 'patterns';

import "page.css";
import "table.css";
import "plot.css";
import "journal.css";
import "./networking.css";
import "form-layout.less";

const _ = cockpit.gettext;
var C_ = cockpit.gettext;

function nm_debug() {
    if (window.debugging == "all" || window.debugging == "nm")
        console.debug.apply(console, arguments);
}

function generate_uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function show_unexpected_error(error) {
    var msg = error.message || error || "???";
    console.warn(msg);
    $("#error-popup-message").text(msg);
    $('.modal[role="dialog"]').modal('hide');
    $('#error-popup').modal('show');
}

function select_btn(func, spec, klass) {
    var choice = spec[0].choice;

    function option_mapper(opt) {
        return $('<li>', { value: opt.choice }).append($("<a tabindex='0'>").text(opt.title));
    }

    var toggle = $('<button class="btn btn-default dropdown-toggle" type="button" data-toggle="dropdown">').append(
        $('<span class="pull-left"></span>'),
        $('<div class="caret"></div>')
    );

    var btn = $('<div class="btn-group bootstrap-select dropdown">').append(
        toggle,
        $('<ul class="dropdown-menu">').append(spec.map(option_mapper))
    );

    btn.on('click', 'li', function() {
        choice = $(this).attr('value');
        select(choice);
        func(choice);
    });

    function select(a) {
        $("button span", btn).text($("li[value='" + a + "']", btn).text());
        choice = a;
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

function connection_settings(c) {
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

    /* HACK: https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=808162 */
    var hacks = { };
    if (cockpit.manifests["network"] && cockpit.manifests["network"]["hacks"])
        hacks = cockpit.manifests["network"]["hacks"];
    var options = { };
    if (hacks.with_networkmanager_needs_root)
        options["superuser"] = "try";

    var client = cockpit.dbus("org.freedesktop.NetworkManager", options);

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

            $(self).trigger('changed');
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

    /**
     * Handle NM not running
     */
    var nm_service = service.proxy("NetworkManager");
    var nm_enabled = null;
    var nm_running = null;

    function update_nm_trouble() {
        nm_debug("update_nm_trouble; enabled", nm_enabled, "running", nm_running);
        // need to wait until we have both pieces of information
        if (nm_enabled === null || nm_running === null)
            return;

        // running
        if (nm_running) {
            $("#networking-nm-crashed").hide();
            $("#networking-nm-disabled").hide();
            $("#networking-graphs").show();
            $("#networking-interfaces").show();
            // NM appearing will also trigger a device update, which hides it if necessary
            $("#networking-unmanaged-interfaces").show();
        } else {
            $("#networking-graphs").hide();
            $("#networking-interfaces").hide();
            $("#networking-unmanaged-interfaces").hide();
            if (nm_enabled) {
                $("#networking-nm-disabled").hide();
                $("#networking-nm-crashed").show();
            } else {
                $("#networking-nm-disabled").show();
                $("#networking-nm-crashed").hide();
            }
        }
    }

    nm_service.addEventListener('changed', function() {
        nm_enabled = nm_service.enabled;
        update_nm_trouble();
    });

    // track NM going away or reappearing
    client.addEventListener("owner", function(event, owner) {
        nm_debug("NetworkManager owner changed:", JSON.stringify(owner));
        nm_running = (owner !== null);
        update_nm_trouble();
    });

    // Troubleshoot link and start button
    $("#networking-nm-crashed a").click(function() {
        cockpit.jump("/system/services#/NetworkManager.service", cockpit.transport.host);
    });
    $("#networking-nm-crashed button").click(nm_service.start);

    // Enable NM button
    $("#networking-nm-disabled button").click(function() {
        nm_service.enable();
        nm_service.start();
    });

    client.call("/org/freedesktop/NetworkManager",
                "org.freedesktop.DBus.Properties", "Get",
                ["org.freedesktop.NetworkManager", "State"], { flags: "" })
            .fail(complain)
            .done(function(reply, options) {
                if (options.flags) {
                    if (options.flags.indexOf(">") !== -1)
                        utils.set_byteorder("be");
                    else if (options.flags.indexOf("<") !== -1)
                        utils.set_byteorder("le");
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

    function ip4_address_from_nm(addr) {
        return [ utils.ip4_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip4_to_text(addr[2], true)
        ];
    }

    function ip4_address_to_nm(addr) {
        return [ utils.ip4_from_text(addr[0]),
            utils.ip4_prefix_from_text(addr[1]),
            utils.ip4_from_text(addr[2], true)
        ];
    }

    function ip4_route_from_nm(addr) {
        return [ utils.ip4_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip4_to_text(addr[2], true),
            utils.ip_metric_to_text(addr[3])
        ];
    }

    function ip4_route_to_nm(addr) {
        return [ utils.ip4_from_text(addr[0]),
            utils.ip4_prefix_from_text(addr[1]),
            utils.ip4_from_text(addr[2], true),
            utils.ip_metric_from_text(addr[3])
        ];
    }
    function ip6_address_from_nm(addr) {
        return [ utils.ip6_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip6_to_text(addr[2], true)
        ];
    }

    function ip6_address_to_nm(addr) {
        return [ utils.ip6_from_text(addr[0]),
            parseInt(addr[1], 10) || 64,
            utils.ip6_from_text(addr[2], true)
        ];
    }

    function ip6_route_from_nm(addr) {
        return [ utils.ip6_to_text(addr[0]),
            utils.ip_prefix_to_text(addr[1]),
            utils.ip6_to_text(addr[2], true),
            utils.ip_metric_to_text(addr[1]),
        ];
    }

    function ip6_route_to_nm(addr) {
        return [ utils.ip6_from_text(addr[0]),
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
                autoconnect_slaves:
                                get("connection", "autoconnect-slaves", -1),
                slave_type:     get("connection", "slave-type"),
                master:         get("connection", "master")
            }
        };

        if (!settings.connection.master) {
            result.ipv4 = get_ip("ipv4", ip4_address_from_nm, ip4_route_from_nm, utils.ip4_to_text);
            result.ipv6 = get_ip("ipv6", ip6_address_from_nm, ip6_route_from_nm, utils.ip6_to_text);
        }

        if (settings["802-3-ethernet"]) {
            result.ethernet = { mtu: get("802-3-ethernet", "mtu"),
                                assigned_mac_address: get("802-3-ethernet", "assigned-mac-address")
            };
        }

        if (settings.bond) {
            /* Options are documented as part of the Linux bonding driver.
               https://www.kernel.org/doc/Documentation/networking/bonding.txt
            */
            result.bond = { options:        $.extend({}, get("bond", "options", { })),
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
            result.team = { config:         JSON_parse_carefully(get("team", "config", "{}")),
                            interface_name: get("team", "interface-name")
            };
        }

        if (settings["team-port"] || result.connection.slave_type == "team") {
            result.team_port = { config:       JSON_parse_carefully(get("team-port", "config", "{}")),
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
        set("connection", "autoconnect-slaves", 'i', settings.connection.autoconnect_slaves);
        set("connection", "uuid", 's', settings.connection.uuid);
        set("connection", "interface-name", 's', settings.connection.interface_name);
        set("connection", "type", 's', settings.connection.type);
        set("connection", "slave-type", 's', settings.connection.slave_type);
        set("connection", "master", 's', settings.connection.master);

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
                obj.Masters = [ ];
                obj.Slaves = [ ];
                obj.Interfaces = [ ];
            },

            null,

            null,

            // Needs: type_Interface.Connections
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
                    var master_settings = connection_settings(con);
                    var my_settings = connection_settings(obj);
                    if (master_settings.type == my_settings.slave_type) {
                        obj.Masters.push(con);
                        con.Slaves.push(obj);
                    }
                }

                var cs = connection_settings(obj);
                if (cs.slave_type) {
                    master = connections_by_uuid[cs.master];
                    if (master) {
                        obj.Masters.push(master);
                        master.Slaves.push(obj);
                    } else {
                        iface = peek_interface(cs.master);
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
            // See below for "Slaves"
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
        interfaces: [ ],

        exporters: [
            function (obj) {
                obj.Device = null;
                obj._NonDeviceConnections = [ ];
                obj.Connections = [ ];
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

    function compare_versions(a, b) {
        function to_ints(str) {
            return str.split(".").map(function (s) { return s ? parseInt(s, 10) : 0 });
        }

        var a_ints = to_ints(a);
        var b_ints = to_ints(b);
        var len = Math.min(a_ints.length, b_ints.length);
        var i;

        for (i = 0; i < len; i++) {
            if (a_ints[i] == b_ints[i])
                continue;
            return a_ints[i] - b_ints[i];
        }

        return a_ints.length - b_ints.length;
    }

    self.at_least_version = function at_least_version (version) {
        return compare_versions(self.get_manager().Version, version) >= 0;
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

function render_interface_link(iface) {
    return $('<a tabindex="0">')
            .text(iface)
            .click(function () {
                cockpit.location.go([ iface ]);
            });
}

function device_state_text(dev) {
    if (!dev)
        return _("Inactive");
    if (dev.State == 100 && dev.Carrier === false)
        return _("No carrier");
    if (!dev.Managed) {
        if (!dev.ActiveConnection &&
            (!dev.Ip4Config || dev.Ip4Config.Addresses.length === 0) &&
            (!dev.Ip6Config || dev.Ip6Config.Addresses.length === 0))
            return _("Inactive");
    }
    return dev.StateText;
}

function render_connection_link(con) {
    var res =
        $('<span>').append(
            array_join(
                con.Interfaces.map(function (iface) {
                    return $('<a tabindex="0">')
                            .text(iface.Name)
                            .click(function () {
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
        if (i < elts.length - 1)
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
            (with_link ? render_interface_link(con.Master.Interface) : con.Master.Interface));
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

function network_plot_setup_hook(pl) {
    var axes = pl.getAxes();
    if (axes.yaxis.datamax < 100000)
        axes.yaxis.options.max = 100000;
    else
        axes.yaxis.options.max = null;
    axes.yaxis.options.min = 0;
}

function make_network_plot_post_hook(unit) {
    return function (pl) {
        var axes = pl.getAxes();
        $(unit).text(plot.bits_per_sec_tick_unit(axes.yaxis));
    };
}

var permission = cockpit.permission({ admin: true });
$(permission).on("changed", update_network_privileged);

function update_network_privileged() {
    $(".network-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to modify network settings"),
            permission.user ? permission.user.name : '')
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
                                              metrics: [ { name: "network.interface.rx",
                                                           units: "bytes",
                                                           derive: "rate"
                                              },
                                              { name: "network.interface.tx",
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

function complete_settings(settings, device) {
    if (!device) {
        console.warn("No device to complete settings", JSON.stringify(settings));
        return;
    }

    settings.connection.id = device.Interface;
    settings.connection.uuid = generate_uuid();

    if (device.DeviceType == 'ethernet') {
        settings.connection.type = '802-3-ethernet';
        settings.ethernet = { };
    } else {
        // The remaining types are identical between Device and Settings, see
        // device_type_to_symbol.
        settings.connection.type = device.DeviceType;
    }
}

function settings_applier(model, device, connection) {
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
        $("#networking-add-bond").syn_click(self.model, $.proxy(this, "add_bond"));
        $("#networking-add-team").syn_click(self.model, $.proxy(this, "add_team"));
        $("#networking-add-bridge").syn_click(self.model, $.proxy(this, "add_bridge"));
        $("#networking-add-vlan").syn_click(self.model, $.proxy(this, "add_vlan"));

        /* HACK - hide "Add Team" if it doesn't work due to missing bits
         * https://bugzilla.redhat.com/show_bug.cgi?id=1375967
         */

        $("#networking-add-team").hide();
        // We need both the plugin and teamd
        cockpit.script("test -f /usr/bin/teamd && " +
                       "( test -f /usr/lib*/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib*/NetworkManager/*/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/*/libnm-device-plugin-team.so)",
                       { err: "ignore" })
                .done(function () {
                    $("#networking-add-team").show();
                })
                .always(function () {
                    $("#networking-add-team").attr("data-test-stable", "yes");
                });

        function highlight_netdev_row(event, id) {
            $('#networking-interfaces tr').removeClass('highlight-ct');
            if (id) {
                $('#networking-interfaces tr[data-interface="' + encodeURIComponent(id) + '"]').addClass('highlight-ct');
            }
        }

        var rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.interface.rx",
            units: "bytes",
            derive: "rate",
            threshold: 200
        };

        var rx_plot_options = plot.plot_simple_template();
        $.extend(rx_plot_options.yaxis, { tickFormatter: plot.format_bits_per_sec_tick_no_unit
        });
        $.extend(rx_plot_options.grid, { hoverable: true,
                                         autoHighlight: false
        });
        rx_plot_options.setup_hook = network_plot_setup_hook;
        rx_plot_options.post_hook = make_network_plot_post_hook("#networking-rx-unit");
        this.rx_plot = new plot.Plot($("#networking-rx-graph"), 300);
        this.rx_plot.set_options(rx_plot_options);
        this.rx_series = this.rx_plot.add_metrics_stacked_instances_series(rx_plot_data, { });
        this.rx_plot.start_walking();
        $(this.rx_series).on('hover', highlight_netdev_row);

        var tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.interface.tx",
            units: "bytes",
            derive: "rate",
            threshold: 200
        };

        var tx_plot_options = plot.plot_simple_template();
        $.extend(tx_plot_options.yaxis, { tickFormatter: plot.format_bits_per_sec_tick_no_unit
        });
        $.extend(tx_plot_options.grid, { hoverable: true,
                                         autoHighlight: false
        });
        tx_plot_options.setup_hook = network_plot_setup_hook;
        tx_plot_options.post_hook = make_network_plot_post_hook("#networking-tx-unit");
        this.tx_plot = new plot.Plot($("#networking-tx-graph"), 300);
        this.tx_plot.set_options(tx_plot_options);
        this.tx_series = this.tx_plot.add_metrics_stacked_instances_series(tx_plot_data, { });
        this.tx_plot.start_walking();
        $(this.tx_series).on('hover', highlight_netdev_row);

        $(cockpit).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });

        var plot_controls = plot.setup_plot_controls($('#networking'), $('#networking-graph-toolbar'));
        plot_controls.reset([ this.rx_plot, this.tx_plot ]);

        ensure_usage_monitor();
        $(usage_grid).on('notify', function (event, index, count) {
            handle_usage_samples();
        });

        function handle_usage_samples() {
            // console.log(JSON.stringify(usage_samples));
            for (var iface in usage_samples) {
                var samples = usage_samples[iface];
                var rx = samples[0][0];
                var tx = samples[1][0];
                var row = $('#networking-interfaces tr[data-sample-id="' + encodeURIComponent(iface) + '"]');
                if (rx !== undefined && tx !== undefined && row.length > 0) {
                    row.find('td:nth-child(3)').text(cockpit.format_bits_per_sec(tx * 8));
                    row.find('td:nth-child(4)').text(cockpit.format_bits_per_sec(rx * 8));
                }
            }
        }

        $(window).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });
    },

    enter: function () {
        this.log_box = journal.logbox([ "_SYSTEMD_UNIT=NetworkManager.service",
            "_SYSTEMD_UNIT=firewalld.service" ], 10);
        $('#networking-log').empty()
                .append(this.log_box);

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
        var managed_tbody, unmanaged_tbody;

        managed_tbody = $('#networking-interfaces tbody');
        managed_tbody.empty();

        unmanaged_tbody = $('#networking-unmanaged-interfaces tbody');
        unmanaged_tbody.empty();
        $('#networking-unmanaged-interfaces').hide();

        self.model.list_interfaces().forEach(function (iface) {
            function has_master(iface) {
                return ((iface.Device &&
                         iface.Device.ActiveConnection &&
                         iface.Device.ActiveConnection.Master &&
                         iface.Device.ActiveConnection.Master.Slaves.length > 0) ||
                        (iface.MainConnection &&
                         iface.MainConnection.Masters.length > 0));
            }

            // Skip loopback
            if (iface.Device && iface.Device.DeviceType == 'loopback')
                return;

            // Skip slaves
            if (has_master(iface))
                return;

            var dev = iface.Device;
            var show_traffic = (dev && (dev.State == 100 || dev.State == 10) && dev.Carrier === true);

            self.rx_series.add_instance(iface.Name);
            self.tx_series.add_instance(iface.Name);
            add_usage_monitor(iface.Name);

            var row = $('<tr>', { "data-interface": encodeURIComponent(iface.Name),
                                  "data-sample-id": show_traffic ? encodeURIComponent(iface.Name) : null
            })
                    .append($('<td>').text(iface.Name),
                            $('<td>').html(render_active_connection(dev, false, true)),
                            (show_traffic
                                ? [ $('<td>').text(""), $('<td>').text("") ]
                                : $('<td colspan="2">').text(device_state_text(dev))));

            if (!dev || dev.Managed) {
                managed_tbody.append(row.click(function () {
                    cockpit.location.go([ iface.Name ]);
                }));
            } else {
                unmanaged_tbody.append(row);
                $('#networking-unmanaged-interfaces').show();
            }
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
        PageNetworkBondSettings.apply_settings = settings_applier(this.model);
        PageNetworkBondSettings.ghost_settings =
            {
                connection: {
                    id: iface,
                    autoconnect: true,
                    type: "bond",
                    uuid: uuid,
                    interface_name: iface
                },
                bond: {
                    options: {
                        mode: "active-backup"
                    },
                    interface_name: iface
                }
            };

        $('#network-bond-settings-dialog').modal('show');
    },

    add_team: function () {
        var iface, i, uuid;

        uuid = generate_uuid();
        for (i = 0; i < 100; i++) {
            iface = "team" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        PageNetworkTeamSettings.model = this.model;
        PageNetworkTeamSettings.done = null;
        PageNetworkTeamSettings.connection = null;
        PageNetworkTeamSettings.apply_settings = settings_applier(this.model);
        PageNetworkTeamSettings.ghost_settings =
            {
                connection: {
                    id: iface,
                    autoconnect: true,
                    type: "team",
                    uuid: uuid,
                    interface_name: iface
                },
                team: {
                    config: { },
                    interface_name: iface
                }
            };

        $('#network-team-settings-dialog').modal('show');
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
        PageNetworkBridgeSettings.apply_settings = settings_applier(this.model);
        PageNetworkBridgeSettings.ghost_settings =
            {
                connection: {
                    id: iface,
                    autoconnect: true,
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
        var uuid;

        uuid = generate_uuid();

        PageNetworkVlanSettings.model = this.model;
        PageNetworkVlanSettings.done = null;
        PageNetworkVlanSettings.connection = null;
        PageNetworkVlanSettings.apply_settings = settings_applier(this.model);
        PageNetworkVlanSettings.ghost_settings =
            {
                connection: {
                    id: "",
                    autoconnect: true,
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
        { choice: 'auto', title: _("Automatic (DHCP)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'shared', title: _("Shared") },
        { choice: 'disabled', title: _("Disabled") }
    ];

var ipv6_method_choices =
    [
        { choice: 'auto', title: _("Automatic") },
        { choice: 'dhcp', title: _("Automatic (DHCP only)") },
        { choice: 'link-local', title: _("Link local") },
        { choice: 'manual', title: _("Manual") },
        { choice: 'ignore', title: _("Ignore") }
    ];

var bond_mode_choices =
    [
        { choice: 'balance-rr', title: _("Round Robin") },
        { choice: 'active-backup', title: _("Active Backup") },
        { choice: 'balance-xor', title: _("XOR") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: '802.3ad', title: _("802.3ad") },
        { choice: 'balance-tlb', title: _("Adaptive transmit load balancing") },
        { choice: 'balance-alb', title: _("Adaptive load balancing") }
    ];

var bond_monitoring_choices =
    [
        { choice: 'mii', title: _("MII (Recommended)") },
        { choice: 'arp', title: _("ARP") }
    ];

var team_runner_choices =
    [
        { choice: 'roundrobin', title: _("Round Robin") },
        { choice: 'activebackup', title: _("Active Backup") },
        { choice: 'loadbalance', title: _("Load Balancing") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: 'lacp', title: _("802.3ad LACP") },
    ];

var team_balancer_choices =
    [
        { choice: 'none', title: _("Passive") },
        { choice: 'basic', title: _("Active") }
    ];

var team_watch_choices =
    [
        { choice: 'ethtool', title: _("Ethtool") },
        { choice: 'arp-ping', title: _("ARP Ping") },
        { choice: 'nsna-ping', title: _("NSNA Ping") }
    ];

function choice_title(choices, choice, def) {
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
 * If step 2 breaks the connection, step 3 wont happen and the
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

/* Considerations for chosing the times below
 *
 * curtain_time too short:  Curtain comes up too often for good changes.
 *
 * curtain_time too long:   User is left with a broken UI for a
 *                          significant time in the case of a mistake.
 *
 * settle_time too short:   Some bad changes that take time to have any
 *                          effect will be let through.
 *
 * settle_time too high:    All operations take a long time, and the
 *                          curtain needs to come up to prevent the
 *                          user from interacting with the page.  Thus settle_time
 *                          should be shorter than curtain_time.
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

function with_checkpoint(model, modify, options) {
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
            curtain_testing.show();
            curtain_restoring.hide();
            curtain.show();
        }, curtain_time * 1000);
        curtain_title_timeout = window.setTimeout(function () {
            curtain_title_timeout = null;
            curtain_testing.hide();
            curtain_restoring.show();
        }, rollback_time * 1000);
    }

    function hide_curtain() {
        if (curtain_timeout)
            window.clearTimeout(curtain_timeout);
        curtain_timeout = null;
        if (curtain_title_timeout)
            window.clearTimeout(curtain_title_timeout);
        curtain.hide();
        cockpit.hint("ignore_transport_health_check", { data: false });
    }

    // HACK - Let's not use checkpoints for changes that involve
    // adding or removing connections.
    //
    // https://bugzilla.redhat.com/show_bug.cgi?id=1378393
    // https://bugzilla.redhat.com/show_bug.cgi?id=1398316

    if (options.hack_does_add_or_remove) {
        modify();
        return;
    }

    manager.checkpoint_create(options.devices || [ ], rollback_time)
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
                                            dialog.find('.modal-footer .btn-danger')
                                                    .off('click')
                                                    .text(options.anyway_text)
                                                    .syn_click(model, function () {
                                                        dialog.modal('hide');
                                                        modify();
                                                    });
                                            dialog.modal('show');
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

        $("#networking-firewall-link, #networking-firewall-summary").on("click", function() {
            cockpit.jump("/network/firewall", cockpit.transport.host);
            return false;
        });

        $('#network-interface-delete').syn_click(self.model, $.proxy(this, "delete_connections"));

        function highlight_netdev_row(event, id) {
            $('#network-interface-slaves tr').removeClass('highlight-ct');
            if (id) {
                $('#network-interface-slaves tr[data-interface="' + encodeURIComponent(id) + '"]').addClass('highlight-ct');
            }
        }

        var rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.interface.rx",
            units: "bytes",
            derive: "rate"
        };

        var rx_plot_options = plot.plot_simple_template();
        $.extend(rx_plot_options.yaxis, { tickFormatter: plot.format_bits_per_sec_tick_no_unit
        });
        $.extend(rx_plot_options.grid, { hoverable: true,
                                         autoHighlight: false
        });
        rx_plot_options.setup_hook = network_plot_setup_hook;
        rx_plot_options.post_hook = make_network_plot_post_hook("#network-interface-rx-unit");
        this.rx_plot = new plot.Plot($("#network-interface-rx-graph"), 300);
        this.rx_plot.set_options(rx_plot_options);
        this.rx_series = this.rx_plot.add_metrics_stacked_instances_series(rx_plot_data, { });
        this.rx_plot.start_walking();
        $(this.rx_series).on('hover', highlight_netdev_row);

        var tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.interface.tx",
            units: "bytes",
            derive: "rate"
        };

        var tx_plot_options = plot.plot_simple_template();
        $.extend(tx_plot_options.yaxis, { tickFormatter: plot.format_bits_per_sec_tick_no_unit
        });
        $.extend(tx_plot_options.grid, { hoverable: true,
                                         autoHighlight: false
        });
        tx_plot_options.setup_hook = network_plot_setup_hook;
        tx_plot_options.post_hook = make_network_plot_post_hook("#network-interface-tx-unit");
        this.tx_plot = new plot.Plot($("#network-interface-tx-graph"), 300);
        this.tx_plot.set_options(tx_plot_options);
        this.tx_series = this.tx_plot.add_metrics_stacked_instances_series(tx_plot_data, { });
        this.tx_plot.start_walking();
        $(this.tx_series).on('hover', highlight_netdev_row);

        $(cockpit).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });

        var plot_controls = plot.setup_plot_controls($('#network-interface'), $('#network-interface-graph-toolbar'));
        plot_controls.reset([ this.rx_plot, this.tx_plot ]);

        ensure_usage_monitor();
        $(usage_grid).on('notify', function (event, index, count) {
            handle_usage_samples();
        });

        function handle_usage_samples() {
            // console.log(usage_samples);
            for (var iface in usage_samples) {
                var samples = usage_samples[iface];
                var rx = samples[0][0];
                var tx = samples[1][0];
                var row = $('#network-interface-slaves tr[data-sample-id="' + encodeURIComponent(iface) + '"]');
                if (row.length > 0) {
                    row.find('td:nth-child(2)').text(cockpit.format_bits_per_sec(tx * 8));
                    row.find('td:nth-child(3)').text(cockpit.format_bits_per_sec(rx * 8));
                }
            }
        }

        function renderFirewallState(pending) {
            ReactDOM.render(
                React.createElement(OnOffSwitch, {
                    id: 'networking-firewall-switch',
                    state: firewall.enabled,
                    disabled: pending,
                    onChange: onFirewallSwitchChange }),
                document.querySelector('#networking-firewall .panel-actions')
            );
        }

        function onFirewallSwitchChange(enable) {
            renderFirewallState(true);
            if (enable)
                firewall.enable().then(() => renderFirewallState());
            else
                firewall.disable().then(() => renderFirewallState());
        }

        firewall.addEventListener('changed', function () {
            if (!firewall.installed) {
                $('#networking-firewall').hide();
                return;
            }

            $('#networking-firewall').show();
            renderFirewallState();

            var n = firewall.enabledServices.size;

            /* HACK: use n.toString() here until cockpit.format() handles integer 0 args correctly */
            var summary = cockpit.format(cockpit.ngettext('$0 Active Rule', '$0 Active Rules', n), n.toString());

            $('#networking-firewall-summary').text(summary);
        });

        $(window).on('resize', function () {
            self.rx_plot.resize();
            self.tx_plot.resize();
        });
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

    show_dialog: function(dialog, id) {
        var self = this;
        var con = self.main_connection;
        var dev = self.dev;

        function reactivate_connection() {
            if (con && dev && dev.ActiveConnection && dev.ActiveConnection.Connection === con) {
                if (con.Settings.connection.interface_name &&
                    con.Settings.connection.interface_name != dev.Interface) {
                    return dev.disconnect().then(function () { return con.activate(null, null) })
                            .fail(show_unexpected_error);
                } else {
                    return con.activate(dev, null)
                            .fail(show_unexpected_error);
                }
            }
        }

        dialog.model = self.model;
        dialog.connection = self.main_connection;
        dialog.ghost_settings = self.ghost_settings;
        dialog.apply_settings = settings_applier(self.model, self.dev, con);
        dialog.done = reactivate_connection;
        $(id).modal('show');
    },

    set_mac: function() {
        this.show_dialog(PageNetworkMacSettings, "#network-mac-settings-dialog");
    },

    delete_connections: function() {
        var self = this;

        function delete_connection_and_slaves(con) {
            // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
            // https://github.com/cockpit-project/cockpit/issues/10956
            // eslint-disable-next-line cockpit/no-cockpit-all
            return cockpit.all(con.Slaves.map(s => free_slave_connection(s))).then(() => con.delete_());
        }

        function delete_connections(cons) {
            // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
            // https://github.com/cockpit-project/cockpit/issues/10956
            // eslint-disable-next-line cockpit/no-cockpit-all
            return cockpit.all(cons.map(delete_connection_and_slaves));
        }

        function delete_iface_connections(iface) {
            return delete_connections(iface.Connections);
        }

        var location = cockpit.location;

        function modify () {
            return delete_iface_connections(self.iface)
                    .then(function () {
                        location.go("/");
                    })
                    .catch(show_unexpected_error);
        }

        if (self.iface) {
            with_checkpoint(self.model, modify,
                            {
                                devices: self.dev ? [ self.dev ] : [ ],
                                fail_text: cockpit.format(_("Deleting <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), self.dev_name),
                                anyway_text: cockpit.format(_("Delete $0"), self.dev_name),
                                hack_does_add_or_remove: true,
                                rollback_on_failure: true
                            });
        }
    },

    connect: function() {
        var self = this;

        if (!self.main_connection && !(self.dev && self.ghost_settings)) {
            self.update();
            return;
        }

        function fail(error) {
            show_unexpected_error(error);
            self.update();
        }

        function modify() {
            if (self.main_connection) {
                return self.main_connection.activate(self.dev, null).fail(fail);
            } else {
                return self.dev.activate_with_settings(self.ghost_settings, null).fail(fail);
            }
        }

        with_checkpoint(self.model, modify,
                        {
                            devices: self.dev ? [ self.dev ] : [ ],
                            fail_text: cockpit.format(_("Switching on <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), self.dev_name),
                            anyway_text: cockpit.format(_("Switch on $0"), self.dev_name)
                        });
    },

    disconnect: function() {
        var self = this;

        if (!self.dev) {
            console.log("Trying to switch off without a device?");
            self.update();
            return;
        }

        function modify () {
            return self.dev.disconnect()
                    .fail(function (error) {
                        show_unexpected_error(error);
                        self.update();
                    });
        }

        with_checkpoint(self.model, modify,
                        {
                            devices: [ self.dev ],
                            fail_text: cockpit.format(_("Switching off <b>$0</b>  will break the connection to the server, and will make the administration UI unavailable."), self.dev_name),
                            anyway_text: cockpit.format(_("Switch off $0"), self.dev_name)
                        });
    },

    update: function() {
        var self = this;
        var iface = self.model.find_interface(self.dev_name);
        var dev = iface && iface.Device;
        var managed = iface && (!dev || dev.Managed);

        self.iface = iface;
        self.dev = dev;

        var desc, cs;
        if (dev) {
            if (dev.DeviceType == 'ethernet' || dev.IdVendor || dev.IdModel) {
                desc = cockpit.format("$IdVendor $IdModel $Driver", dev);
            } else if (dev.DeviceType == 'bond') {
                desc = _("Bond");
            } else if (dev.DeviceType == 'team') {
                desc = _("Team");
            } else if (dev.DeviceType == 'vlan') {
                desc = _("VLAN");
            } else if (dev.DeviceType == 'bridge') {
                desc = _("Bridge");
            } else
                desc = cockpit.format(_("Unknown \"$0\""), dev.DeviceType);
        } else if (iface) {
            cs = connection_settings(iface.Connections[0]);
            if (cs.type == "bond")
                desc = _("Bond");
            else if (cs.type == "team")
                desc = _("Team");
            else if (cs.type == "vlan")
                desc = _("VLAN");
            else if (cs.type == "bridge")
                desc = _("Bridge");
            else if (cs.type)
                desc = cockpit.format(_("Unknown \"$0\""), cs.type);
            else
                desc = _("Unknown");
        } else
            desc = _("Unknown");

        $('#network-interface-name').text(self.dev_name);
        $('#network-interface-hw').text(desc);

        var mac;
        if (dev &&
            dev.HwAddress) {
            mac = dev.HwAddress;
        } else if (iface &&
                   iface.MainConnection &&
                   iface.MainConnection.Settings &&
                   iface.MainConnection.Settings.ethernet &&
                   iface.MainConnection.Settings.ethernet.assigned_mac_address) {
            mac = iface.MainConnection.Settings.ethernet.assigned_mac_address;
        }

        var can_edit_mac = (iface && iface.MainConnection &&
                            ((connection_settings(iface.MainConnection).type == "802-3-ethernet" &&
                              self.model.at_least_version("1.4")) ||
                             (connection_settings(iface.MainConnection).type == "bond" &&
                              self.model.at_least_version("1.6"))));

        $('#network-interface-mac').empty();
        if (can_edit_mac) {
            $('#network-interface-mac').append(
                $('<a tabindex="0">')
                        .text(mac)
                        .syn_click(self.model, function () {
                            self.set_mac();
                        }));
        } else {
            $('#network-interface-mac').text(mac);
        }

        /* Disable the On/Off button for interfaces that we don't know about at all,
           and for devices that NM declares to be unavailable. Neither can be activated.
         */
        var onoff = null;
        if (managed) {
            onoff = React.createElement(OnOffSwitch, {
                state: !!(dev && dev.ActiveConnection),
                disabled: !iface || (dev && dev.State == 20),
                onChange: enable => enable ? self.connect() : self.disconnect() });
        }
        ReactDOM.render(onoff, document.getElementById('network-interface-delete-switch'));

        var is_deletable = (iface && !dev) || (dev && (dev.DeviceType == 'bond' ||
                                                       dev.DeviceType == 'team' ||
                                                       dev.DeviceType == 'vlan' ||
                                                       dev.DeviceType == 'bridge'));
        $('#network-interface-delete').toggle(is_deletable && managed);

        function render_carrier_status_row() {
            if (dev && dev.Carrier !== undefined) {
                return $('<tr>').append(
                    $('<td>').text(_("Carrier")),
                    $('<td>').append(
                        dev.Carrier
                            ? (dev.Speed ? cockpit.format_bits_per_sec(dev.Speed * 1e6) : _("Yes"))
                            : _("No")));
            } else
                return null;
        }

        function render_active_status_row() {
            var state;

            if (self.main_connection && self.main_connection.Masters.length > 0)
                return null;

            if (!dev)
                state = _("Inactive");
            else if (managed && dev.State != 100)
                state = dev.StateText;
            else
                state = null;

            return $('<tr>').append(
                $('<td>').text(_("Status")),
                $('<td>').append(
                    render_active_connection(dev, true, false),
                    " ",
                    state ? $('<span>').text(state) : null));
        }

        function render_connection_settings_rows(con, settings) {
            if (!managed) {
                return $('<tr>').append(
                    $('<td>'),
                    $('<td>').text(_("This device cannot be managed here.")));
            }

            if (!settings)
                return [ ];

            var master_settings = null;
            if (con && con.Masters.length > 0)
                master_settings = con.Masters[0].Settings;

            function render_ip_settings(topic) {
                var params = settings[topic];
                var parts = [];

                if (params.method != "manual")
                    parts.push(choice_title((topic == "ipv4") ? ipv4_method_choices : ipv6_method_choices,
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
                    parts.push(cockpit.format(addr_is_extra ? _("Additional address $val") : _("Address $val"),
                                              { val: addrs.join(", ") }));

                var dns_is_extra = (!params["ignore-auto-dns"] && params.method != "manual");
                if (params.dns.length > 0)
                    parts.push(cockpit.format(dns_is_extra ? _("Additional DNS $val") : _("DNS $val"),
                                              { val: params.dns.join(", ") }));
                if (params.dns_search.length > 0)
                    parts.push(cockpit.format(dns_is_extra ? _("Additional DNS Search Domains $val") : _("DNS Search Domains $val"),
                                              { val: params.dns_search.join(", ") }));

                return parts;
            }

            function configure_ip_settings(topic) {
                PageNetworkIpSettings.topic = topic;
                self.show_dialog(PageNetworkIpSettings, '#network-ip-settings-dialog');
            }

            function configure_bond_settings() {
                self.show_dialog(PageNetworkBondSettings, '#network-bond-settings-dialog');
            }

            function configure_team_settings() {
                self.show_dialog(PageNetworkTeamSettings, '#network-team-settings-dialog');
            }

            function configure_team_port_settings() {
                PageNetworkTeamPortSettings.master_settings = master_settings;
                self.show_dialog(PageNetworkTeamPortSettings, '#network-teamport-settings-dialog');
            }

            function configure_bridge_settings() {
                self.show_dialog(PageNetworkBridgeSettings, '#network-bridge-settings-dialog');
            }

            function configure_bridge_port_settings() {
                self.show_dialog(PageNetworkBridgePortSettings, '#network-bridgeport-settings-dialog');
            }

            function configure_vlan_settings() {
                self.show_dialog(PageNetworkVlanSettings, '#network-vlan-settings-dialog');
            }

            function configure_mtu_settings() {
                self.show_dialog(PageNetworkMtuSettings, '#network-mtu-settings-dialog');
            }

            function render_autoconnect_row() {
                if (settings.connection.autoconnect !== undefined) {
                    return (
                        $('<tr>').append(
                            $('<td>').text(_("General")),
                            $('<td class="networking-controls">').append(
                                $('<label>').append(
                                    $('<input type="checkbox">')
                                            .prop('checked', settings.connection.autoconnect)
                                            .change(function () {
                                                settings.connection.autoconnect = $(this).prop('checked');
                                                settings_applier(self.model, self.dev, con)(settings);
                                            }),
                                    $('<span>').text(_("Connect automatically")))))
                    );
                }
            }

            function render_settings_row(title, rows, configure) {
                var link_text = [ ];
                for (var i = 0; i < rows.length; i++) {
                    link_text.push(rows[i]);
                    if (i < rows.length - 1)
                        link_text.push($('<br>'));
                }
                if (link_text.length === 0)
                    link_text.push(_("Configure"));

                return $('<tr>').append(
                    $('<td>')
                            .text(title)
                            .css('vertical-align', rows.length > 1 ? "top" : "center"),
                    $('<td>').append(
                        $('<a tabindex="0" class="network-privileged">')
                                .append(link_text)
                                .syn_click(self.model, function () { configure() })));
            }

            function render_ip_settings_row(topic, title) {
                if (!settings[topic])
                    return null;

                return render_settings_row(title, render_ip_settings(topic),
                                           function () { configure_ip_settings(topic) });
            }

            function render_mtu_settings_row() {
                var rows = [ ];
                var options = settings.ethernet;

                if (!options)
                    return null;

                function add_row(fmt, args) {
                    rows.push(cockpit.format(fmt, args));
                }

                if (options.mtu)
                    add_row(_("$mtu"), options);
                else
                    add_row(_("Automatic"), options);

                return render_settings_row(_("MTU"), rows, configure_mtu_settings);
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
                    rows.push(parts.join(", "));

                return render_settings_row(_("Bond"), rows, configure_bond_settings);
            }

            function render_team_settings_row() {
                var parts = [ ];
                var rows = [ ];

                if (!settings.team)
                    return null;

                var config = settings.team.config;

                if (config === null)
                    parts.push(_("Broken configuration"));
                else {
                    if (config.runner)
                        parts.push(choice_title(team_runner_choices, config.runner.name, config.runner.name));
                    if (config.link_watch && config.link_watch.name != "ethtool")
                        parts.push(choice_title(team_watch_choices, config.link_watch.name, config.link_watch.name));
                }

                if (parts.length > 0)
                    rows.push(parts.join(", "));
                return render_settings_row(_("Team"), rows, configure_team_settings);
            }

            function render_team_port_settings_row() {
                var parts = [ ];
                var rows = [ ];

                if (!settings.team_port)
                    return null;

                /* Only "activebackup" and "lacp" team ports have
                 * something to configure.
                 */
                if (!master_settings ||
                    !master_settings.team ||
                    !master_settings.team.config ||
                    !master_settings.team.config.runner ||
                    !(master_settings.team.config.runner.name == "activebackup" ||
                      master_settings.team.config.runner.name == "lacp"))
                    return null;

                var config = settings.team_port.config;

                if (config === null)
                    parts.push(_("Broken configuration"));

                if (parts.length > 0)
                    rows.push(parts.join(", "));
                return render_settings_row(_("Team Port"), rows, configure_team_port_settings);
            }

            function render_bridge_settings_row() {
                var rows = [ ];
                var options = settings.bridge;

                if (!options)
                    return null;

                function add_row(fmt, args) {
                    rows.push(cockpit.format(fmt, args));
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
                    rows.push(cockpit.format(fmt, args));
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
                    rows.push(cockpit.format(fmt, args));
                }

                add_row(_("Parent $parent"), options);
                add_row(_("Id $id"), options);

                return render_settings_row(_("VLAN"), rows,
                                           configure_vlan_settings);
            }

            return [ render_master(),
                render_autoconnect_row(),
                render_ip_settings_row("ipv4", _("IPv4")),
                render_ip_settings_row("ipv6", _("IPv6")),
                render_mtu_settings_row(),
                render_vlan_settings_row(),
                render_bridge_settings_row(),
                render_bridge_port_settings_row(),
                render_bond_settings_row(),
                render_team_settings_row(),
                render_team_port_settings_row()
            ];
        }

        function create_ghost_connection_settings() {
            var settings = {
                connection: {
                    interface_name: iface.Name
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
            complete_settings(settings, dev);
            return settings;
        }

        self.ghost_settings = null;
        self.main_connection = null;
        self.connection_settings = null;

        if (iface) {
            self.main_connection = iface.MainConnection;
            if (self.main_connection) {
                self.connection_settings = self.main_connection.Settings;
            } else {
                self.ghost_settings = create_ghost_connection_settings();
                self.connection_settings = self.ghost_settings;
            }
        }

        $('#network-interface-settings')
                .empty()
                .append(render_active_status_row())
                .append(render_carrier_status_row())
                .append(render_connection_settings_rows(self.main_connection, self.connection_settings));
        update_network_privileged();

        function update_connection_slaves(con) {
            var tbody = $('#network-interface-slaves tbody');
            var rows = { };
            var slave_ifaces = { };

            tbody.empty();
            self.rx_series.clear_instances();
            self.tx_series.clear_instances();

            var cs = connection_settings(con);
            if (!con || (cs.type != "bond" && cs.type != "team" && cs.type != "bridge")) {
                self.rx_series.add_instance(self.dev_name);
                self.tx_series.add_instance(self.dev_name);
                return;
            }

            $('#network-interface-slaves thead th:first-child')
                    .text(cs.type == "bond" ? _("Members") : _("Ports"));

            con.Slaves.forEach(function (slave_con) {
                slave_con.Interfaces.forEach(function(iface) {
                    if (iface.MainConnection != slave_con)
                        return;

                    var dev = iface.Device;
                    var is_active = (dev && dev.State == 100 && dev.Carrier === true);

                    /* Unmanaged devices shouldn't show up as slaves
                     * but let's not take any chances.
                     */
                    if (dev && !dev.Managed)
                        return;

                    self.rx_series.add_instance(iface.Name);
                    self.tx_series.add_instance(iface.Name);
                    add_usage_monitor(iface.Name);
                    slave_ifaces[iface.Name] = true;

                    rows[iface.Name] =
                        $('<tr>', { "data-interface": encodeURIComponent(iface.Name),
                                    "data-sample-id": is_active ? encodeURIComponent(iface.Name) : null
                        })
                                .append($('<td>').text(iface.Name),
                                        (is_active
                                            ? [ $('<td>').text(""), $('<td>').text("") ]
                                            : $('<td colspan="2">').text(device_state_text(dev))),
                                        $('<td class="networking-row-configure">').append(
                                            switchbox(!!(dev && dev.ActiveConnection), function(val) {
                                                if (val) {
                                                    with_checkpoint(
                                                        self.model,
                                                        function () {
                                                            return slave_con.activate(dev)
                                                                    .fail(show_unexpected_error);
                                                        },
                                                        {
                                                            devices: dev ? [ dev ] : [ ],
                                                            fail_text: cockpit.format(_("Switching on <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
                                                            anyway_text: cockpit.format(_("Switch on $0"), iface.Name)
                                                        });
                                                } else if (dev) {
                                                    with_checkpoint(
                                                        self.model,
                                                        function () {
                                                            return dev.disconnect()
                                                                    .fail(show_unexpected_error);
                                                        },
                                                        {
                                                            devices: [ dev ],
                                                            fail_text: cockpit.format(_("Switching off <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
                                                            anyway_text: cockpit.format(_("Switch off $0"), iface.Name)
                                                        });
                                                }
                                            }, "network-privileged")),
                                        $('<td width="28px">').append(
                                            $('<button class="btn btn-default btn-control-ct network-privileged fa fa-minus">')
                                                    .syn_click(self.model, function () {
                                                        with_checkpoint(
                                                            self.model,
                                                            function () {
                                                                return (free_slave_connection(slave_con)
                                                                        .fail(show_unexpected_error));
                                                            },
                                                            {
                                                                devices: dev ? [ dev ] : [ ],
                                                                fail_text: cockpit.format(_("Removing <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
                                                                anyway_text: cockpit.format(_("Remove $0"), iface.Name),
                                                                hack_does_add_or_remove: true
                                                            });
                                                        return false;
                                                    })))
                                .click(function (event) {
                                    // Somehow the clicks on the switchbox
                                    // bubble up to here.  Let's catch them.
                                    if ($(event.target).hasClass("btn"))
                                        return;
                                    cockpit.location.go([ iface.Name ]);
                                });
                });
            });

            Object.keys(rows).sort()
                    .forEach(function(name) {
                        tbody.append(rows[name]);
                    });

            var add_btn =
                $('<div>', { 'class': 'dropdown' }).append(
                    $('<button>', { 'class': 'network-privileged btn btn-default btn-control-ct dropdown-toggle fa fa-plus',
                                    'data-toggle': 'dropdown'
                    }),
                    $('<ul>', { 'class': 'dropdown-menu add-button',
                                'role': 'menu'
                    })
                            .append(
                                self.model.list_interfaces().map(function (iface) {
                                    if (is_interesting_interface(iface) &&
                                    !slave_ifaces[iface.Name] &&
                                    iface != self.iface) {
                                        return $('<li role="presentation">').append(
                                            $('<a tabindex="0" role="menuitem" class="network-privileged">')
                                                    .text(iface.Name)
                                                    .syn_click(self.model, function () {
                                                        with_checkpoint(
                                                            self.model,
                                                            function () {
                                                                var cs = connection_settings(con);
                                                                return set_slave(self.model, con, con.Settings,
                                                                                 cs.type, iface.Name, true)
                                                                        .fail(show_unexpected_error);
                                                            },
                                                            {
                                                                devices: iface.Device ? [ iface.Device ] : [ ],
                                                                fail_text: cockpit.format(_("Adding <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
                                                                anyway_text: cockpit.format(_("Add $0"), iface.Name),
                                                                hack_does_add_or_remove: true
                                                            });
                                                    }));
                                    }
                                    return null;
                                })));

            $('#network-interface-slaves thead th:nth-child(5)').html(add_btn);

            $('#network-interface-slaves').show();
            update_network_privileged();
        }

        $('#network-interface-slaves').hide();
        if (self.main_connection)
            update_connection_slaves(self.main_connection);
    }

};

function PageNetworkInterface(model) {
    this._init(model);
}

function switchbox(val, callback) {
    var onoff = $('<span>');
    var enabled = true;
    function render () {
        ReactDOM.render(
            React.createElement(OnOffSwitch, {
                state: val,
                enabled: enabled,
                onChange: callback
            }),
            onoff[0]);
    }
    onoff.enable = function (val) {
        enabled = val;
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
    $(error_id).show()
            .find('span')
            .text(msg);
}

function connection_devices(con) {
    var devices = [ ];

    if (con)
        con.Interfaces.forEach(function (iface) { if (iface.Device) devices.push(iface.Device); });

    return devices;
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
        $('#network-ip-settings-error').hide();
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
                            add_btn = $('<button class="btn btn-default fa fa-plus">')
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
                                    $('<button class="btn btn-default fa fa-minus">')
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
            var prefix_text = (topic == "ipv4") ? _("Prefix length or Netmask") : _("Prefix length");
            var body =
                $('<div>').append(
                    addresses_table = tablebox(_("Addresses"), "addresses", [ "Address", prefix_text, "Gateway" ],
                                               [ "", "", "" ],
                                               choicebox("method", (topic == "ipv4")
                                                   ? ipv4_method_choices : ipv6_method_choices)
                                                       .css('display', 'inline-block')),
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
            (topic == "ipv4") ? _("IPv4 Settings") : _("IPv6 Settings"));
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
        $('#network-ip-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;

        function modify() {
            return PageNetworkIpSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-ip-settings-dialog').modal('hide');
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

function PageNetworkIpSettings() {
    this._init();
}

function is_interface_connection(iface, connection) {
    return connection && connection.Interfaces.indexOf(iface) != -1;
}

function is_interesting_interface(iface) {
    return !iface.Device || iface.Device.Managed;
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
    return $('<ul class="list-group dialog-list-ct">').append(
        slave_interface_choices(model, master).map(function (iface) {
            return $('<li class="list-group-item">').append(
                $('<div class="checkbox">')
                        .css('margin', "0px")
                        .append(
                            $('<label>').append(
                                $('<input>', { 'type': "checkbox",
                                               'data-iface': iface.Name })
                                        .prop('checked', !!slave_connection_for_interface(master, iface)),
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
    return select_btn(change, choices, "form-control");
}

function free_slave_connection(con) {
    var cs = connection_settings(con);
    if (cs.slave_type) {
        delete cs.slave_type;
        delete cs.master;
        delete con.Settings.team_port;
        delete con.Settings.bridge_port;
        return con.apply_settings(con.Settings).then(() => { con.activate(null, null) });
    }
}

function set_slave(model, master_connection, master_settings, slave_type,
    iface_name, val) {
    var iface;
    var main_connection;

    iface = model.find_interface(iface_name);
    if (!iface)
        return false;

    main_connection = iface.MainConnection;

    if (val) {
        /* Turn the main_connection into a slave for master.
         */

        var master_iface;
        if (master_connection) {
            master_iface = master_connection.Interfaces[0].Name;
        } else {
            master_iface = master_settings.connection.interface_name;
        }

        if (!master_iface)
            return false;

        var slave_settings;
        if (main_connection) {
            slave_settings = main_connection.Settings;

            if (slave_settings.connection.master == master_settings.connection.uuid ||
                slave_settings.connection.master == master_settings.connection.id ||
                slave_settings.connection.master == master_iface)
                return cockpit.resolve();

            slave_settings.connection.slave_type = slave_type;
            slave_settings.connection.master = master_iface;
            slave_settings.connection.autoconnect = true;
            delete slave_settings.ipv4;
            delete slave_settings.ipv6;
            delete slave_settings.team_port;
            delete slave_settings.bridge_port;
        } else {
            slave_settings = { connection:
                               { autoconnect: true,
                                 interface_name: iface.Name,
                                 slave_type: slave_type,
                                 master: master_iface
                               }
            };
            complete_settings(slave_settings, iface.Device);
        }

        return settings_applier(model, iface.Device, main_connection)(slave_settings).then(function () {
            // If the master already exists, activate or deactivate the slave immediatly so that
            // the settings actually apply and the interface becomes a slave.  Otherwise we
            // activate it later when the master is created.
            if (master_connection) {
                var master_dev = master_connection.Interfaces[0].Device;
                if (master_dev && master_dev.ActiveConnection)
                    return main_connection.activate(iface.Device);
                else if (iface.Device.ActiveConnection)
                    return iface.Device.ActiveConnection.deactivate();
            }
        });
    } else {
        /* Free the main_connection from being a slave if it is our slave.  If there is
         * no main_connection, we don't need to do anything.
         */
        if (main_connection && main_connection.Masters.indexOf(master_connection) != -1) {
            free_slave_connection(main_connection);
        }
    }

    return true;
}

function apply_master_slave(choices, model, apply_master, master_connection, master_settings, slave_type) {
    var active_settings = [ ];
    var iface;

    if (!master_connection) {
        if (master_settings.bond &&
            master_settings.bond.options &&
            master_settings.bond.options.primary) {
            iface = model.find_interface(master_settings.bond.options.primary);
            if (iface && iface.MainConnection)
                active_settings.push(iface.MainConnection.Settings);
        } else {
            choices.find('input[data-iface]').map(function (i, elt) {
                var iface;
                if ($(elt).prop('checked')) {
                    iface = model.find_interface($(elt).attr("data-iface"));
                    if (iface.Device && iface.Device.ActiveConnection && iface.Device.ActiveConnection.Connection) {
                        active_settings.push(iface.Device.ActiveConnection.Connection.Settings);
                    }
                }
            });
        }

        if (active_settings.length == 1) {
            master_settings.ipv4 = $.extend(true, { }, active_settings[0].ipv4);
            master_settings.ipv6 = $.extend(true, { }, active_settings[0].ipv6);
        }

        master_settings.connection.autoconnect_slaves = 1;
    }

    /* For bonds, the order in which slaves are added to their master matters since the first slaves gets to
     * set the MAC address of the bond, which matters for DHCP.  We leave it to NetworkManager to determine
     * the order in which slaves are added so that the order is consistent with what happens when the bond is
     * activated the next time, such as after a reboot.
     */

    function set_all_slaves() {
        var deferreds = choices.find('input[data-iface]').map(function (i, elt) {
            return model.synchronize().then(function () {
                return set_slave(model, master_connection, master_settings, slave_type,
                                 $(elt).attr("data-iface"), $(elt).prop('checked'));
            });
        });
        return Promise.all(deferreds.get());
    }

    return set_all_slaves().then(function () {
        return apply_master(master_settings);
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
        $('#network-bond-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bond-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bond-settings-error').hide();
        this.settings = PageNetworkBondSettings.ghost_settings || PageNetworkBondSettings.connection.copy_settings();
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
        var master = PageNetworkBondSettings.connection;
        var options = self.settings.bond.options;

        var slaves_element;
        var mac_input, mode_btn, primary_btn;
        var monitoring_btn, interval_input, targets_input, updelay_input, downdelay_input;

        function change_slaves() {
            var btn = slave_chooser_btn(change_mode, slaves_element);
            primary_btn.replaceWith(btn);
            primary_btn = btn;
            select_btn_select(primary_btn, options.primary);
            change_mode();
            self.slaves_changed = true;
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
            monitoring_targets: options.arp_ip_targets,
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
                .replaceWith(slaves_element = render_slave_interface_choices(model, master)
                        .change(change_slaves));
        fill_mac_menu(body.find('#network-bond-settings-mac-menu'),
                      mac_input = body.find('#network-bond-settings-mac-input'),
                      model);
        mac_input.change(change_mac);
        body.find('#network-bond-settings-mode-select')
                .replaceWith(mode_btn = select_btn(change_mode, bond_mode_choices, "form-control"));
        body.find('#network-bond-settings-primary-select')
                .replaceWith(primary_btn = slave_chooser_btn(change_mode, slaves_element, "form-control"));
        body.find('#network-bond-settings-link-monitoring-select')
                .replaceWith(monitoring_btn = select_btn(change_monitoring, bond_monitoring_choices, "form-control"));

        interval_input = body.find('#network-bond-settings-monitoring-interval-input');
        interval_input.change(change_monitoring);
        targets_input = body.find('#network-bond-settings-monitoring-targets-input');
        targets_input.change(change_monitoring);
        updelay_input = body.find('#network-bond-settings-link-up-delay-input');
        updelay_input.change(change_monitoring);
        downdelay_input = body.find('#network-bond-settings-link-down-delay-input');
        downdelay_input.change(change_monitoring);

        body.find('#network-bond-settings-mac-row').toggle(model.at_least_version("1.6"));

        select_btn_select(mode_btn, options.mode);
        select_btn_select(monitoring_btn, (options.miimon !== 0) ? "mii" : "arp");
        change_slaves();
        change_mode();
        change_monitoring();

        self.slaves_changed = false;

        $('#network-bond-settings-body').html(body);
    },

    cancel: function() {
        $('#network-bond-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;

        function modify() {
            return apply_master_slave($('#network-bond-settings-body'),
                                      PageNetworkBondSettings.model,
                                      PageNetworkBondSettings.apply_settings,
                                      PageNetworkBondSettings.connection,
                                      self.settings,
                                      "bond")
                    .then(function() {
                        $('#network-bond-settings-dialog').modal('hide');
                        if (PageNetworkBondSettings.connection)
                            cockpit.location.go([ self.settings.connection.interface_name ]);
                        if (PageNetworkBondSettings.done)
                            return PageNetworkBondSettings.done();
                    })
                    .catch(function (error) {
                        show_dialog_error('#network-bond-settings-error', error);
                    });
        }

        if (PageNetworkBondSettings.connection) {
            with_settings_checkpoint(PageNetworkBondSettings.model, modify,
                                     { devices: (self.slaves_changed
                                         ? [ ] : connection_devices(PageNetworkBondSettings.connection)),
                                       hack_does_add_or_remove: self.slaves_changed,
                                       rollback_on_failure: self.slaves_changed
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

function PageNetworkBondSettings() {
    this._init();
}

PageNetworkTeamSettings.prototype = {
    _init: function () {
        this.id = "network-team-settings-dialog";
        this.team_settings_template = $("#network-team-settings-template").html();
        mustache.parse(this.team_settings_template);
    },

    setup: function () {
        $('#network-team-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-team-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-team-settings-error').hide();
        this.settings = PageNetworkTeamSettings.ghost_settings || PageNetworkTeamSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    find_slave_con: function(iface) {
        if (!PageNetworkTeamSettings.connection)
            return null;

        return array_find(PageNetworkTeamSettings.connection.Slaves, function (s) {
            return s.Interfaces.indexOf(iface) >= 0;
        }) || null;
    },

    update: function() {
        var self = this;
        var model = PageNetworkTeamSettings.model;
        var master = PageNetworkTeamSettings.connection;
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

        function change_slaves() {
            self.slaves_changed = true;
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

            config.link_watch = { "name": name };

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
                .replaceWith(render_slave_interface_choices(model, master).change(change_slaves));
        body.find('#network-team-settings-runner-select')
                .replaceWith(runner_btn = select_btn(change_runner, team_runner_choices, "form-control"));
        body.find('#network-team-settings-balancer-select')
                .replaceWith(balancer_btn = select_btn(change_balancer, team_balancer_choices, "form-control"));
        body.find('#network-team-settings-link-watch-select')
                .replaceWith(watch_btn = select_btn(change_watch, team_watch_choices, "form-control"));

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

        self.slaves_changed = false;

        $('#network-team-settings-body').html(body);
    },

    cancel: function() {
        $('#network-team-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;

        function modify () {
            return apply_master_slave($('#network-team-settings-body'),
                                      PageNetworkTeamSettings.model,
                                      PageNetworkTeamSettings.apply_settings,
                                      PageNetworkTeamSettings.connection,
                                      self.settings,
                                      "team")
                    .then(function() {
                        $('#network-team-settings-dialog').modal('hide');
                        if (PageNetworkTeamSettings.connection)
                            cockpit.location.go([ self.settings.connection.interface_name ]);
                        if (PageNetworkTeamSettings.done)
                            return PageNetworkTeamSettings.done();
                    })
                    .catch(function (error) {
                        show_dialog_error('#network-team-settings-error', error);
                    });
        }

        if (PageNetworkTeamSettings.connection) {
            with_settings_checkpoint(PageNetworkTeamSettings.model, modify,
                                     { devices: (self.slaves_changed
                                         ? [ ] : connection_devices(PageNetworkTeamSettings.connection)),
                                       hack_does_add_or_remove: self.slaves_changed,
                                       rollback_on_failure: self.slaves_changed
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

function PageNetworkTeamSettings() {
    this._init();
}

PageNetworkTeamPortSettings.prototype = {
    _init: function () {
        this.id = "network-teamport-settings-dialog";
        this.team_port_settings_template = $("#network-team-port-settings-template").html();
        mustache.parse(this.team_port_settings_template);
    },

    setup: function () {
        $('#network-teamport-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-teamport-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-teamport-settings-error').hide();
        this.settings = PageNetworkTeamPortSettings.ghost_settings || PageNetworkTeamPortSettings.connection.copy_settings();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var self = this;
        var master_config = PageNetworkTeamPortSettings.master_settings.team.config;
        var config = self.settings.team_port.config;

        var ab_prio_input, ab_sticky_input, lacp_prio_input, lacp_key_input;

        if (!config)
            self.settings.team_port.config = config = { };

        function change() {
            // XXX - handle parse errors
            if (master_config.runner.name == "activebackup") {
                config.prio = parseInt(ab_prio_input.val(), 10);
                config.sticky = ab_sticky_input.prop('checked');
            } else if (master_config.runner.name == "lacp") {
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

        ab_prio_input.toggle(master_config.runner.name == "activebackup");
        ab_prio_input.prev().toggle(master_config.runner.name == "activebackup");
        ab_sticky_input.toggle(master_config.runner.name == "activebackup");
        ab_sticky_input
                .parent()
                .prev()
                .toggle(master_config.runner.name == "activebackup");
        lacp_prio_input.toggle(master_config.runner.name == "lacp");
        lacp_prio_input.prev().toggle(master_config.runner.name == "lacp");
        lacp_key_input.toggle(master_config.runner.name == "lacp");
        lacp_key_input.prev().toggle(master_config.runner.name == "lacp");

        $('#network-teamport-settings-body').html(body);
    },

    cancel: function() {
        $('#network-teamport-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkTeamPortSettings.model;

        function modify () {
            return PageNetworkTeamPortSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-teamport-settings-dialog').modal('hide');
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

function PageNetworkTeamPortSettings() {
    this._init();
}

PageNetworkBridgeSettings.prototype = {
    _init: function () {
        this.id = "network-bridge-settings-dialog";
        this.bridge_settings_template = $("#network-bridge-settings-template").html();
        mustache.parse(this.bridge_settings_template);
    },

    setup: function () {
        $('#network-bridge-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridge-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridge-settings-error').hide();
        this.settings = PageNetworkBridgeSettings.ghost_settings || PageNetworkBridgeSettings.connection.copy_settings();
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
        var con = PageNetworkBridgeSettings.connection;
        var options = self.settings.bridge;

        var stp_input, priority_input, forward_delay_input, hello_time_input, max_age_input;

        function change_slaves() {
            self.slaves_changed = true;
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
        var slave_interfaces = body.find('#network-bridge-settings-slave-interfaces')
                .replaceWith(render_slave_interface_choices(model, con).change(change_slaves));
        slave_interfaces.toggle(!con);
        slave_interfaces.prev().toggle(!con);

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

        self.slaves_changed = false;

        $('#network-bridge-settings-body').html(body);
    },

    cancel: function() {
        $('#network-bridge-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;

        function modify () {
            return apply_master_slave($('#network-bridge-settings-body'),
                                      PageNetworkBridgeSettings.model,
                                      PageNetworkBridgeSettings.apply_settings,
                                      PageNetworkBridgeSettings.connection,
                                      self.settings,
                                      "bridge")
                    .then(function() {
                        $('#network-bridge-settings-dialog').modal('hide');
                        if (PageNetworkBridgeSettings.connection)
                            cockpit.location.go([ self.settings.connection.interface_name ]);
                        if (PageNetworkBridgeSettings.done)
                            return PageNetworkBridgeSettings.done();
                    })
                    .catch(function (error) {
                        $('#network-bridge-settings-error').show()
                                .find('span')
                                .text(error.message || error.toString());
                    });
        }

        if (PageNetworkBridgeSettings.connection) {
            with_settings_checkpoint(PageNetworkBridgeSettings.model, modify,
                                     { devices: (self.slaves_changed
                                         ? [ ] : connection_devices(PageNetworkBridgeSettings.connection)),
                                       hack_does_add_or_remove: self.slaves_changed,
                                       rollback_on_failure: self.slaves_changed
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

function PageNetworkBridgeSettings() {
    this._init();
}

PageNetworkBridgePortSettings.prototype = {
    _init: function () {
        this.id = "network-bridgeport-settings-dialog";
        this.bridge_port_settings_template = $("#network-bridge-port-settings-template").html();
        mustache.parse(this.bridge_port_settings_template);
    },

    setup: function () {
        $('#network-bridgeport-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-bridgeport-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-bridgeport-settings-error').hide();
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
        $('#network-bridgeport-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkBridgePortSettings.model;

        function modify () {
            return PageNetworkBridgePortSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-bridgeport-settings-dialog').modal('hide');
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

function PageNetworkBridgePortSettings() {
    this._init();
}

PageNetworkVlanSettings.prototype = {
    _init: function () {
        this.id = "network-vlan-settings-dialog";
        this.vlan_settings_template = $("#network-vlan-settings-template").html();
        mustache.parse(this.vlan_settings_template);
    },

    setup: function () {
        $('#network-vlan-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-vlan-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-vlan-settings-error').hide();
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
            $("#network-vlan-settings-apply").toggleClass("disabled", !options.parent);

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
        $('#network-vlan-settings-dialog').modal('hide');
    },

    apply: function() {
        var self = this;
        var model = PageNetworkVlanSettings.model;

        function modify () {
            return PageNetworkVlanSettings.apply_settings(self.settings)
                    .then(function () {
                        $('#network-vlan-settings-dialog').modal('hide');
                        if (PageNetworkVlanSettings.connection)
                            cockpit.location.go([ self.settings.connection.interface_name ]);
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

function PageNetworkVlanSettings() {
    this._init();
}

PageNetworkMtuSettings.prototype = {
    _init: function () {
        this.id = "network-mtu-settings-dialog";
        this.ethernet_settings_template = $("#network-mtu-settings-template").html();
        mustache.parse(this.ethernet_settings_template);
    },

    setup: function () {
        $('#network-mtu-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-mtu-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-mtu-settings-error').hide();
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
        $('#network-mtu-settings-dialog').modal('hide');
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
                        $('#network-mtu-settings-dialog').modal('hide');
                        if (PageNetworkMtuSettings.done)
                            return PageNetworkMtuSettings.done();
                    })
                    .fail(show_error);
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkMtuSettings.connection) });
    }

};

function PageNetworkMtuSettings() {
    this._init();
}

PageNetworkMacSettings.prototype = {
    _init: function () {
        this.id = "network-mac-settings-dialog";
        this.ethernet_settings_template = $("#network-mac-settings-template").html();
        mustache.parse(this.ethernet_settings_template);
    },

    setup: function () {
        $('#network-mac-settings-cancel').click($.proxy(this, "cancel"));
        $('#network-mac-settings-apply').click($.proxy(this, "apply"));
    },

    enter: function () {
        $('#network-mac-settings-error').hide();
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
        $('#network-mac-settings-dialog').modal('hide');
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
                        $('#network-mac-settings-dialog').modal('hide');
                        if (PageNetworkMacSettings.done)
                            return PageNetworkMacSettings.done();
                    })
                    .fail(show_error);
        }

        with_settings_checkpoint(model, modify,
                                 { devices: connection_devices(PageNetworkMacSettings.connection) });
    }

};

function PageNetworkMacSettings() {
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
    $('#' + d.id)
            .on('show.bs.modal', function () { d.enter() })
            .on('shown.bs.modal', function () { d.show() })
            .on('hidden.bs.modal', function () { d.leave() });
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

        model.synchronize().then(function() {
            if (path.length === 0) {
                page_hide(interface_page);
                page_show(overview_page);
            } else if (path.length === 1) {
                page_hide(overview_page);
                page_show(interface_page, path[0]);
            } else { /* redirect */
                console.warn("not a networking location: " + path);
                cockpit.location = '';
            }

            $("body").show();
        });
    }

    cockpit.translate();

    model = new NetworkManagerModel();

    overview_page = new PageNetworking(model);
    overview_page.setup();

    interface_page = new PageNetworkInterface(model);
    interface_page.setup();

    dialog_setup(new PageNetworkIpSettings());
    dialog_setup(new PageNetworkBondSettings());
    dialog_setup(new PageNetworkTeamSettings());
    dialog_setup(new PageNetworkTeamPortSettings());
    dialog_setup(new PageNetworkBridgeSettings());
    dialog_setup(new PageNetworkBridgePortSettings());
    dialog_setup(new PageNetworkVlanSettings());
    dialog_setup(new PageNetworkMtuSettings());
    dialog_setup(new PageNetworkMacSettings());

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

$(init);
