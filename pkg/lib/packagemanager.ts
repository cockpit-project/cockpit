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

import cockpit from 'cockpit';

import { PackageManager, InstallProgressType, UnsupportedError, NotFoundError } from './_internal/packagemanager-abstract';
import { Dnf5DaemonManager } from './_internal/dnf5daemon';
import { PackageKitManager } from './_internal/packagekit';

let package_manager: PackageManager | null = null;

function debug(...args: unknown[]) {
    if (window.debugging == 'all' || window.debugging?.includes('packagemanager'))
        console.debug('packagemanager', ...args);
}

async function is_immutable_os() {
    try {
        const options = await cockpit.spawn(["findmnt", "-T", "/usr", "-n", "-o", "VFS-OPTIONS"]);
        return options.split(",").indexOf("ro") >= 0;
    } catch (err) {
        debug("Unable to detect immutable OS", err);
        return false;
    }
}

async function detect_dnf5daemon() {
    try {
        const client = cockpit.dbus("org.rpm.dnf.v0", { superuser: "try" });
        await client.call("/org/rpm/dnf/v0", "org.freedesktop.DBus.Peer", "Ping", []);
        return true;
    } catch (err) {
        debug("dnf5daemon not supported", err);
        return false;
    }
}

async function detect_packagekit() {
    try {
        const client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try" });
        await client.call("/org/freedesktop/PackageKit", "org.freedesktop.DBus.Properties",
                          "Get", ["org.freedesktop.PackageKit", "VersionMajor"]);
        return true;
    } catch (err) {
        debug("PackageKit not supported", err);
        return false;
    }
}

// Cache result for a session
export async function getPackageManager(): Promise<PackageManager> {
    if (package_manager !== null)
        return Promise.resolve(package_manager);

    const [unsupported, has_dnf5daemon, has_packagekit] = await Promise.all([is_immutable_os(), detect_dnf5daemon(), detect_packagekit()]);

    if (unsupported)
        throw new UnsupportedError("Cockpit does not support installing additional packages on immutable operating systems");

    if (has_dnf5daemon) {
        debug("constructing dnf5daemon");
        package_manager = new Dnf5DaemonManager();
        return Promise.resolve(package_manager);
    }

    if (has_packagekit) {
        debug("constructing packagekit");
        package_manager = new PackageKitManager();
        return Promise.resolve(package_manager);
    }

    throw new NotFoundError("No package manager found");
}

export { InstallProgressType };
