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

/* D-BUS CLIENT

   - client = new DBusClient(address, options)

   Creates a new D-Bus client for a service at the given host address
   and options.

   Available options are:

   * "service": A service name of the DBus service to communicate
     with.

   * "object-manager": The object path of a o.f.DBus.ObjectManager
     whose interfaces and properties will be relayed.

   * "object-paths": An array of object paths to start monitoring in
     the case of a non o.f.DBus.ObjectManager based service.

   A DBusClient has a local data structure that describes (a subset
   of) the objects of the service that it represents, the interfaces
   of those objects, and the properties of those interfaces.  This is
   called the "object tree".

   A client immediately starts to connect to the service in the
   background and lazily populates its object tree.  While that
   happens, the client emits the appropriate notification signals.

   - $(client).on('objectAdded', function (event, obj) { })
   - $(client).on('objectRemoved', function (event, obj) { })
   - $(client).on('interfaceAdded', function (event, obj, iface) { })
   - $(client).on('interfaceRemoved', function (event, obj, iface) { })
   - $(client).on('propertiesChanged', function (event, obj, iface) { })

   For monitoring changes to the object tree of the client.

   The 'objectAdded' signal announces that a new object, complete with
   all its interfaces and their properties, has appeared in the object
   tree.  You wont receive 'interfaceAdded' signals for the interfaces
   that are already attached to that object, for example.

   Likewise, the 'interfaceAdded' signal announces a new interface,
   complete with all its properties.

   There is no guarantee in what order these signals are emitted.  In
   particular, if a new object path appears in some property, that
   corresponding object might or might not yet be part of the object
   tree.

   - $(client).on('signalEmitted', function (event, iface, signal_name, ...) { })

   For monitoring all signals that are emitted on the object tree.

   - iface = client.lookup(obj_path, iface_name)

   If the object tree contains a object at 'objpath' with the given
   interface name, it will be returned.  Otherwise, 'null' is
   returned.

   - iface = client.get(obj_path, iface_name)

   Make sure that the object tree contains an object with the given
   object path and that the object has an interface with the given
   name.

   This will never return 'null', but the returned proxy might not
   have any properties.  It will be populated with properties in the
   background, and the usual change notification signals will be
   emitted as that happens.

   Calling 'get' will always create a valid proxy and add it to the
   client, regardless of whether the service really exports a object
   at 'objpath' with the given interface.  Subsequent calls to
   'lookup' will be able to find it, and 'objectAdded' or
   'interfaceAdded' signals will be emitted, as appropriate.

   You can use 'iface.call' even on an empty proxy and the call will
   be delayed until the proxy (and its client) are ready to carry it
   out.

   - iface.propertiesChanged(dict)

   Inform the interface that some of its properties have changed.
   Interfaces automatically listen to the normal
   org.freedesktop.DBus.Properties.PropertiesChanged signal, and you
   only need to use this function for interfaces that don't support
   that signal.

   - client.byteorder

   Indicates the byte order of the machine that the service runs on.
   The value is one of the strings "le" (for little endian) or "be"
   (for big endian).

 */

var phantom_checkpoint = function () { };

var cockpit = cockpit || { };

function dbus_debug() {
    if (cockpit.debugging == "all" || cockpit.debugging == "dbus")
        console.debug.apply(console, arguments);
}

function dbus_log(str) {
    console.debug("LOG: " + str);
}

function dbus_warning(str) {
    console.debug("WARNING: " + str);
}

// ----------------------------------------------------------------------------------------------------

function DBusVariant(signature, value) {
    this._init(signature, value);
}

DBusVariant.prototype = {
    _init: function(type, value) {
        this.sig = type;
        this.val = value;
    }
};

// ----------------------------------------------------------------------------------------------------

function DBusError(name, message) {
    this._init(name, message);
}

DBusError.prototype = {
    _init: function(name, message) {
        this.name = name;
        this.message = message;
    }
};

// ----------------------------------------------------------------------------------------------------

function DBusInterface(json, iface_name, enclosing_object, client) {
    this._init(json, iface_name, enclosing_object, client);
}

DBusInterface.prototype = {
    _init: function(json, iface_name, enclosing_object, client) {

        this._iface_name = iface_name;
        this._enclosing_object = enclosing_object;
        this._client = client;

        this._set_props(json, "dbus_prop_", false);
    },

    _set_props: function(props, prefix, emit_signals) {
        var some_changed = false;
        for (var prop_name in props) {
            if (prop_name.startsWith(prefix)) {
                var name = prop_name.substr(prefix.length);
                if (!this.hasOwnProperty(name) || this[name] != props[prop_name]) {
                    this[name] = props[prop_name];
                    if (emit_signals)
                        $(this).trigger("notify:" + name, this[name]);
                    some_changed = true;
                }
            }
        }

        if (some_changed && emit_signals) {
            $(this).trigger("notify");
            $(this._client).trigger("propertiesChanged", [ this._enclosing_object, this ]);
        }
    },

    _reseed: function(json) {
        this._set_props(json, "dbus_prop_", true);
    },

    call: function() {
        var args = [];
        var dbus_method_name = arguments[0];
        for (var n = 1; n < arguments.length - 1; n++) {
            args.push(arguments[n]);
        }
        var callback = arguments[n];

        if (this._client._channel.valid) {
            var cookie = this._client._register_call_reply(callback);

            var call_obj = {command: "call",
                            objpath: this._enclosing_object.objectPath,
                            iface: this._iface_name,
                            method: dbus_method_name,
                            cookie: cookie,
                            args: args
            };
            try {
                this._client._channel.send(JSON.stringify(call_obj));
            }
            catch (e) {
                delete this._client._call_reply_map[cookie];
                var error = new DBusError ('NotConnected', "Can't send.");
                callback.apply(null, [error]);
            }
        } else {
            var err = new DBusError('NotConnected', "Not connected to server.");
            callback.apply(null, [err]);
        }

    },

    propertiesChanged: function(dict) {
        this._set_props(dict, "", true);
    },

    getObject: function() {
        return this._enclosing_object;
    },

    toString : function() {
        return "[DBusInterface name=" + this._iface_name + " objectPath=" + this._enclosing_object.objectPath + "]" ;
    }
};

// ----------------------------------------------------------------------------------------------------

function DBusObject(json, client) {
    this._init(json, client);
}

DBusObject.prototype = {
    _init: function(json, client) {
        this.objectPath = json.objpath;

        this._ifaces = {};
        for (var iface_name in json.ifaces) {
            this._ifaces[iface_name] = new DBusInterface(json.ifaces[iface_name], iface_name, this, client);
        }
    },

    _reseed: function(json, client) {
        var iface_name;
        var iface;
        for (iface_name in json.ifaces) {
            if (iface_name in this._ifaces) {
                this._ifaces[iface_name]._reseed(json.ifaces[iface_name]);
            } else {
                iface = new DBusInterface(json.ifaces[iface_name], iface_name, this, client);
                this._ifaces[iface_name] = iface;
                $(this).trigger("interfaceAdded", iface);
                $(client).trigger("interfaceAdded", [this, iface]);
            }
        }

        for (iface_name in this._ifaces) {
            if (!(iface_name in json.ifaces)) {
                iface = this._ifaces[iface_name];
                delete this._ifaces[iface_name];
                $(this).trigger("interfaceRemoved", iface);
                $(client).trigger("interfaceRemoved", [this, iface]);
            }
        }

    },

    lookup: function(iface_name) {
        return this._ifaces[iface_name];
    },

    getInterfaces: function() {
        var ret = [];
        for (var i in this._ifaces)
            ret.push(this._ifaces[i]);
        return ret;
    }
};

// ----------------------------------------------------------------------------------------------------

function DBusClient(target, options) {
    this._init(target, options);
}

DBusClient.prototype = {
    _init: function(target, options) {
        this.target = target;
        this.options = options;
        this.error = null;
        this.state = null;
        this._channel = null;
        this._objmap = {};
        this._cookie_counter = 0;
        this._call_reply_map = {};
        this._last_error = null;
        this.error_details = {};
        this.byteorder = null;
        this.connect();
    },

    connect: function() {
        var channel_opts = {
            "host" : this.target,
            "payload" : "dbus-json2"
        };
        $.extend(channel_opts, this.options);

        if (!channel_opts["service"])
            channel_opts["service"] = "com.redhat.Cockpit";
        if (channel_opts["object-manager"] == undefined &&
            channel_opts["object-paths"] == undefined)
            channel_opts["object-manager"] = "/com/redhat/Cockpit";

        dbus_debug("Connecting DBusClient to " + channel_opts["service"] + " on " + this.target);

        /* Open a channel */
        var channel = new Channel(channel_opts);

        var client = this;
        client._channel = channel;

        this._last_error = null;

        if (this.state !== null) {
            this.state = null;
            this.error = null;
            client._state_change ();
        }

        $(client._channel).on("message", function(event, payload) {
            var decoded = JSON.parse(payload);
            dbus_debug("got message command=" + decoded.command);

            if (decoded.command == "seed") {
                client._handle_seed(decoded.data, decoded.options);
            } else if (decoded.command == "interface-properties-changed") {
                client._handle_properties_changed(decoded.data);
            } else if (decoded.command == "object-added") {
                client._handle_object_added(decoded.data);
            } else if (decoded.command == "object-removed") {
                client._handle_object_removed(decoded.data);
            } else if (decoded.command == "interface-added") {
                client._handle_interface_added(decoded.data);
            } else if (decoded.command == "interface-removed") {
                client._handle_interface_removed(decoded.data);
            } else if (decoded.command == "call-reply") {
                client._handle_call_reply(decoded.data);
            } else if (decoded.command == "interface-signal") {
                client._handle_interface_signal(decoded.data);
            } else if (decoded.command == "error") {
                client._handle_error(decoded.data);
            } else {
                dbus_warning("Unhandled command '" + decoded.command + "'");
            }
        });

        $(client._channel).on("close", function(event, options) {
            client.error = options.reason;
            client.error_details = options;
            client.state = "closed";
            client._state_change();

            for (var cookie in client._call_reply_map) {
                var callback = client._call_reply_map[cookie];
                if (callback) {
                    var error = new DBusError('NotConnected', "Not connected to server.");
                    callback.apply(null, [error]);
                }
            }
            client._call_reply_map = { };
            phantom_checkpoint();
        });
    },

    _state_change: function() {
        $(this).trigger("state-change");
        phantom_checkpoint ();
    },

    _handle_error: function(data) {
        this._last_error = data;
    },

    _handle_seed : function(data, options) {
        if (options && options.byteorder)
            this.byteorder = options.byteorder;
        for (var objpath in data) {
            if (objpath in this._objmap) {
                this._objmap[objpath]._reseed(data[objpath], this);
            } else {
                this._objmap[objpath] = new DBusObject(data[objpath], this);
                $(this).trigger("objectAdded", this._objmap[objpath]);
            }
        }

        for (objpath in this._objmap) {
            if (!(objpath in data)) {
                var obj = this._objmap[objpath];
                delete this._objmap[objpath];
                $(this).trigger("objectRemoved", obj);
            }
        }

        this.state = "ready";
        this.error = null;
        this._state_change();
    },

    _handle_properties_changed : function(data) {
        var objpath = data.objpath;
        var iface_name = data.iface_name;
        var existing_obj = this._objmap[objpath];
        if (!existing_obj) {
            dbus_warning("Received interface-properties-changed for non-existing object path " + objpath);
        } else {
            var existing_iface = existing_obj._ifaces[iface_name];
            if (!existing_iface) {
                dbus_warning("Received interface-properties-changed for existing object path " + objpath + " but non-existant interface " + iface_name);
            } else {
                var changed_properties = data.iface[iface_name];
                for (var key in changed_properties) {
                    // Update the property on the existing object
                    existing_iface[key] = changed_properties[key];
                    $(existing_iface).trigger("notify:" + key, changed_properties[key]);

                }
                $(existing_iface).trigger("notify");
                $(this).trigger("propertiesChanged", [ existing_obj, existing_iface ]);
            }
        }
    },

    _handle_object_added : function(data) {
        var objpath = data.object.objpath;
        var existing_obj = this._objmap[objpath];
        if (existing_obj) {
            dbus_warning("Received object-added for already-existing object path " + objpath);
        }
        var obj = new DBusObject(data.object, this);
        this._objmap[objpath] = obj;
        $(this).trigger("objectAdded", obj);
    },

    _handle_object_removed : function(data) {
        var objpath = data[0];
        var existing_obj = this._objmap[objpath];
        if (!existing_obj) {
            dbus_warning("Received object-added for non-existing object path " + objpath);
        } else {
            var obj = this._objmap[objpath];
            delete this._objmap[objpath];
            $(this).trigger("objectRemoved", obj);
        }
    },

    _handle_interface_added : function(data) {
        var objpath = data.objpath;
        var iface_name = data.iface_name;
        var existing_obj = this._objmap[objpath];
        if (!existing_obj) {
            dbus_warning("Received interface-added for non-existing object path " + objpath);
        } else {
            var existing_iface = existing_obj._ifaces[iface_name];
            if (existing_iface) {
                dbus_warning("Received interface-added for existing object path " + objpath + " and existing interface " + iface_name);
            } else {
                var iface = new DBusInterface(data.iface[iface_name],
                                              iface_name, existing_obj, this);
                existing_obj._ifaces[iface_name] = iface;
                $(existing_obj).trigger("interfaceAdded", iface);
                $(this).trigger("interfaceAdded", [existing_obj, iface]);
            }
        }
    },

    _handle_interface_removed : function(data) {
        var objpath = data.objpath;
        var iface_name = data.iface_name;
        var existing_obj = this._objmap[objpath];
        if (!existing_obj) {
            dbus_warning("Received interface-removed for non-existing object path " + objpath);
        } else {
            var existing_iface = existing_obj._ifaces[iface_name];
            if (!existing_iface) {
                dbus_warning("Received interface-removed for existing object path " + objpath + " and non-existing interface " + iface_name);
            } else {
                var iface = existing_obj._ifaces[iface_name];
                delete existing_obj._ifaces[iface_name];
                $(existing_obj).trigger("interfaceRemoved", iface);
                $(this).trigger("interfaceRemoved", [existing_obj, iface]);
            }
        }
    },

    _register_call_reply : function(callback) {
        var cookie = "cookie" + this._cookie_counter;
        this._cookie_counter++;
        this._call_reply_map[cookie] = callback;
        return cookie;
    },

    _handle_call_reply : function(data) {
        var cookie = data.cookie;
        var callback = this._call_reply_map[cookie];
        delete this._call_reply_map[cookie];
        if (!callback) {
            // don't warn if null, it's fine to pass a null callback
            if (callback !== null) {
                dbus_warning("Received call-reply for non-existing cookie " + cookie);
            }
        } else {
            var result = data.result;
            if (result) {
                var na = [null];
                callback.apply(null, na.concat(result));
            } else {
                var error = new DBusError (data.error_name, data.error_message);
                callback.apply(null, [error]);
            }
        }
    },

    _handle_interface_signal : function(data) {
        var objpath = data.objpath;
        var iface_name = data.iface_name;
        var signal_name = data.signal_name;
        var signal_args = data.args;

        var existing_obj = this._objmap[objpath];
        if (!existing_obj) {
            dbus_warning("Received interface-signal for non-existing object path " + objpath);
        } else {
            var existing_iface = existing_obj._ifaces[iface_name];
            if (!existing_iface) {
                dbus_warning("Received interface-signal for existing object path " + objpath + " and non-existing interface " + iface_name);
            } else {
                // Emit the signal to listeners
                $(existing_iface).trigger(signal_name, signal_args);
                $(this).trigger('signalEmitted', [ existing_iface, signal_name, signal_args ]);
            }
        }
    },

    // ----------------------------------------------------------------------------------------------------

    close : function(reason) {
        var chan = this._channel;
        this._channel = null;
        if (chan)
            chan.close();
    },

    lookup : function(objpath, iface_name) {
        if (iface_name) {
            var obj = this._objmap[objpath];
            if (obj)
                return obj._ifaces[iface_name];
            else
                return null;
        } else {
            return this._objmap[objpath];
        }
    },

    get : function(objpath, iface_name) {
        var obj = this._objmap[objpath];
        if (!obj) {
            obj = new DBusObject({'objpath': objpath, ifaces: {}}, this);
            this._objmap[objpath] = obj;
            $(this).trigger("objectAdded", obj);
        }
        if (iface_name) {
            var iface = obj._ifaces[iface_name];
            if (!iface) {
                iface = new DBusInterface({}, iface_name, obj, this);
                obj._ifaces[iface_name] = iface;
                $(obj).trigger("interfaceAdded", iface);
                $(this).trigger("interfaceAdded", [obj, iface]);
            }
            return iface;
        } else {
            return obj;
        }
    },

    getInterfacesFrom: function(path_prefix, iface_name) {
        var result = [];
        var obj, objpath, obj_iface;
        for (objpath in this._objmap) {
            if (objpath.indexOf(path_prefix) !== 0)
                continue;

            obj = this._objmap[objpath];
            obj_iface = obj._ifaces[iface_name];
            if (obj_iface)
                result.push(obj_iface);
        }

        return result;
    },

    getObjectsFrom: function(path_prefix) {
        var result = [];
        var obj, objpath;
        for (objpath in this._objmap) {
            if (objpath.indexOf(path_prefix) !== 0)
                continue;
            result.push(this._objmap[objpath]);
        }
        return result;
    },

    toString : function() {
        return "[DBusClient]";
    }
};
