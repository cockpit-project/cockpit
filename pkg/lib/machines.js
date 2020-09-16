import $ from "jquery";
import cockpit from "cockpit";

/* Machines

   [ user, port, host ] = parse_address(str)
   str = unparse_address(user, port, host)

   parse_color(color)

   machines = new Machines()

   machines.close()

   machines.entries
   machines.set(address, values)
   m = machines.get(address)
   machines.addEventListener("changed", ...)

   color = machines.unused_color()
   list = machines.complete(address_prefix)

   A "machine" is identified by its "address".  The address is what is
   used with SSH to make the connection, such as "user@host:1234".
   Use parse_address and unparse_address to work with those.

   The value for a machine is a arbitrary JSON object. The following
   fields are in use:

   - address (string, readonly): The address for the machine.
   - visible (boolean): Whether the machine should be shown in the navigation.
   - color (string): The color to use for this machine in the UI.
   - last_used (number): Time of last use.

   The "machines.list" is a list of all visible machines in a nice,
   stable order.

   Calling "machines.set" will update the entry for the given address.
   The new values will be merged with the old values.  To remove a
   field, set it to "undefined".

   To add a new machine, just call "machine.set" for it with the first
   values.

   Entries are not really removed from the database.  When removing a
   machine from the UI, set its "visible" field to false.

   The database will forget some old entries in order to prevent
   growing too large.
*/


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

export function get_host_superuser_value(host) {
    const key = host_superuser_storage_key(host);
    if (key)
        return window.localStorage.getItem(key);
    else
        return null;
}

export const machine_colors = [
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

export function parse_color(input) {
    var div = document.createElement('div');
    div.style.color = input;
    var style = window.getComputedStyle(div, null);
    return style.getPropertyValue("color") || div.style.color;
}

export function unparse_address(user, port, host) {
    var address = host;
    if (user)
        address = user + "@" + address;

    if (port)
        address = address + ":" + port;

    return address;
}

export function parse_address(address) {
    var user = null;
    var port = null;
    var host = null;

    var user_spot = -1;
    var port_spot = -1;

    if (conn_address) {
        user_spot = address.lastIndexOf('@');
        port_spot = address.lastIndexOf(':');
    }

    if (user_spot > 0) {
        user = address.substring(0, user_spot);
        address = address.substring(user_spot + 1);
        port_spot = address.lastIndexOf(':');
    }

    if (port_spot > -1) {
        var port = parseInt(address.substring(port_spot + 1), 10);
        if (!isNaN(port))
            address = address.substring(0, port_spot);
        else
            port = null;
    }

    return [ user, port, address ];
}

const database_key = cockpit.localStorage.prefixedKey("machines.v3.json");

export class Machines {
    constructor() {
        cockpit.event_target(this);
        window.addEventListener("storage", ev => {
            if (ev.storageArea === window.localStorage && ev.key == database_key)
                this.refresh();
        });
        this.refresh();
    }

    refresh() {
        let entries = { };
        try {
            const db = window.localStorage.getItem(database_key);
            if (db)
                entries = JSON.parse(db);
        }
        catch (ex) {
            console.warn("Can't parse machines database", ex.toString());
        }

        entries.localhost = { address: "localhost", visible: true, color: "" };

        console.log("DB", entries);

        this.entries = entries;
        this.dispatchEvent("changed");
    }

    set(address, values) {
        this.entries[address] = Object.assign(this.entries[address] || { }, values);
        this.entries[address].address = address;
        window.localStorage.setItem(database_key, JSON.stringify(this.entries));
        this.dispatchEvent("changed");
    }

    touch(address) {
    }

    get(address) {
        return this.entries[address];
    }

    unused_color() {
        function color_in_use(color) {
            var key, machine;
            var norm = parse_color(color);
            for (key in this.entries) {
                machine = this.entries[key];
                if (machine.color && parse_color(machine.color) == norm)
                    return true;
            }
            return false;
        }

        var i;
        var len = machine_colors.length;
        for (i = 0; i < len; i++) {
            if (!color_in_use(machine_colors[i]))
                return machine_colors[i];
        }
        return "gray";
    }

    complete(partial_address) {
        return [ ];
    }
}

export const allow_connection_string = true;
export const has_auth_results = true;
