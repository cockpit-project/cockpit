/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import { superuser } from 'superuser';

const _ = cockpit.gettext;

let _dbus_client = null;

/**
 * Get dnf5daemon D-Bus client
 *
 * This will get lazily initialized and re-initialized after dnf5daemon
 * disconnects (due to a crash or idle timeout).
 */
function dbus_client() {
    if (_dbus_client === null) {
        _dbus_client = cockpit.dbus("org.rpm.dnf.v0", { superuser: "try", track: true });
        _dbus_client.addEventListener("close", () => {
            console.log("dnf5daemon went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => { _dbus_client = null });

/**
 * Call a dnf5daemon method
 */
export function call(objectPath, iface, method, args, opts) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

/**
 * Figure out whether dnf5daemon is available and usable
 */
export function detect() {
    function dbus_detect() {
        return call("/org/rpm/dnf/v0", "org.freedesktop.DBus.Peer",
                    "Ping", [])
                .then(() => true,
                      () => false);
    }

    return cockpit.spawn(["findmnt", "-T", "/usr", "-n", "-o", "VFS-OPTIONS"])
            .then(options => {
                if (options.split(",").indexOf("ro") >= 0)
                    return false;
                else
                    return dbus_detect();
            })
            .catch(dbus_detect);
}

// TODO: close_session needs to be handled
// handle
// Cannot open new session - maximal number of simultaneously opened sessions achieved
export async function check_missing_packages(names, progress_cb) {
    const data = {
        missing_ids: [],
        missing_names: [],
        unavailable_names: [],
    };

    if (names.length === 0)
        return data;

    function open_session() {
        return call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                    "open_session", [{}]);
    }

    function close_session(session) {
        return call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                    "close_session", [session]);
    }

    function refresh() {
        // refresh dnf5daemon state
    }

    function list() {
        // const package_attrs = ["name", "version", "release", "arch"];
        // await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [{ package_attrs, scope: "installed", patterns: ["bash"] }]);
    }

    function signal_emitted(path, iface, signal, args) {
        if (progress_cb)
            progress_cb(signal);
        console.log("signal_emitted", path, iface, signal, args);
    }

    // TODO: decorator / helper for opening a session?
    let session;
    const client = dbus_client();
    const subscription = client.subscribe({}, signal_emitted);

    try {
        [session] = await open_session();
        console.log(session);

        await call(session, "org.rpm.dnf.v0.Base", "read_all_repos", []);
        const resolve_results = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);
        console.log(resolve_results);
        const transaction_results = await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        console.log(transaction_results);
        await close_session(session);
    } catch (err) {
        if (session)
            await close_session(session);
        console.warn(err);
    }

    console.log(subscription);
    subscription.remove();

    return data;
}
