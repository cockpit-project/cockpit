/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';

import { PackageManager, InstallProgressType, UnsupportedError, NotFoundError } from './_internal/packagemanager-abstract';
import { Dnf5DaemonManager } from './_internal/dnf5daemon';
import { PackageKitManager } from './_internal/packagekit';
import { read_os_release } from 'os-release';

let package_manager: PackageManager | null = null;

function debug(...args: unknown[]) {
    if (window.debugging === 'all' || window.debugging?.includes('packagemanager'))
        console.debug('packagemanager', ...args);
}

/*
 * Only enable dnf5daemon on RHEL > 10 and ELN. Fedora can be enabled once it
 * there has been a Fedora proposal to switch to dnf5daemon instead of PackageKit.
 */
async function is_dnf5daemon_os() {
    try {
        await cockpit.init();
    } catch (exp) {
        /* Remove this when every beiboot scenario has Cockpit 336 */
        if (exp instanceof cockpit.BasicError && exp.problem === 'not-supported') {
            const os_release = await read_os_release();
            cockpit.info.os_release = os_release;
        }
    }

    const os_id = cockpit.info.os_release?.ID;
    const os_version = Number.parseInt(cockpit.info.os_release?.VERSION || "");
    return (os_id === "rhel" && os_version >= 11) || os_id === "eln";
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
    const client = cockpit.dbus("org.rpm.dnf.v0", { superuser: "try" });
    let detected = false;
    try {
        await client.call("/org/rpm/dnf/v0", "org.freedesktop.DBus.Peer", "Ping", []);
        detected = true;
    } catch (err) {
        debug("dnf5daemon not supported", err);
    }

    client.close();
    return detected;
}

async function detect_packagekit() {
    const client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try" });
    let detected = false;
    try {
        await client.call("/org/freedesktop/PackageKit", "org.freedesktop.DBus.Properties",
                          "Get", ["org.freedesktop.PackageKit", "VersionMajor"]);
        detected = true;
    } catch (err) {
        debug("PackageKit not supported", err);
    }

    client.close();
    return detected;
}

// Cache result for a session
export async function getPackageManager(): Promise<PackageManager> {
    if (package_manager !== null)
        return Promise.resolve(package_manager);

    const [unsupported, uses_dnf5daemon, has_dnf5daemon, has_packagekit] = await Promise.all([is_immutable_os(), is_dnf5daemon_os(), detect_dnf5daemon(), detect_packagekit()]);

    if (unsupported)
        throw new UnsupportedError("Cockpit does not support installing additional packages on immutable operating systems");

    if (uses_dnf5daemon) {
        if (has_dnf5daemon) {
            debug("constructing dnf5daemon");
            package_manager = new Dnf5DaemonManager();
            return Promise.resolve(package_manager);
        } else {
            console.warn("OS prefers dnf5daemon-server but it is not installed, falling back to PackageKit");
        }
    }

    if (has_packagekit) {
        debug("constructing packagekit");
        package_manager = new PackageKitManager();
        return Promise.resolve(package_manager);
    }

    throw new NotFoundError("No package manager found");
}

export { InstallProgressType };
