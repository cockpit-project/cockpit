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
import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, ResolveError, InstallProgressType } from './packagemanager-abstract';

let _dbus_client: cockpit.DBusClient | null = null;

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
            console.warn("dnf5daemon went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => {
    if (_dbus_client)
        _dbus_client.close();
    _dbus_client = null;
});

async function open_session(): Promise<string> {
    const [session] = await call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                                 "open_session", [{}]) as string[];
    return session;
}

function close_session(session: string) {
    return call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                "close_session", [session]);
}

interface ListPackage {
    arch: { t: "s", v: string }
    download_size: { t: "t", "v": number }
    id: { t: "i"; v: number };
    is_installed: { t: "b"; v: boolean };
    name: { t: "s"; v: string };
    release: { t: "s"; v: string };
    version: { t: "s"; v: string };
}

interface ResolvePackage {
    arch: { t: "s"; v: string };
    download_size: { t: "t"; v: number };
    epoch: { t: "s"; v: string };
    evr: { t: "s"; v: string };
    from_repo_id: { t: "s"; v: string };
    full_nevra: { t: "s"; v: string };
    id: { t: "i"; v: number };
    install_size: { t: "t"; v: number };
    name: { t: "s"; v: string };
    reason: { t: "s"; v: string };
    release: { t: "s"; v: string };
    repo_id: { t: "s"; v: string };
    version: { t: "s"; v: string };
}

// TransactionItemType
type object_type = "Package" | "Group" | "Environment" | "Module" | "Skipped";
// TransactionItemAction
type action = "Install" | "Upgrade" | "Downgrade" | "Reinstall" | "Remove" | "Replaced" | "Reset" | "Enable" | "Disable" | "Reason Change" | "Switch"
// TransactionItemReason
type reason = "User" | "Dependency" | "Clean" | "Group" | "None" | "Weak Dependency" | "External User"
type TransactionItem = [
    object_type,
    action,
    reason,
    unknown,
    ResolvePackage
]

type InstallResolveResult = [TransactionItem[], number]

/**
 * Call a dnf5daemon method
 */
function call(objectPath: string, iface: string, method: string, args?: unknown[], opts?: cockpit.DBusCallOptions) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

export class Dnf5DaemonManager implements PackageManager {
    name: string;

    constructor() {
        this.name = 'dnf5daemon';
    }

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        const data: MissingPackages = {
            extra_names: [],
            missing_ids: [],
            missing_names: [],
            unavailable_names: [],
            remove_names: [],
            download_size: 0,
        };

        if (pkgnames.length === 0)
            return data;

        async function refresh(session: string) {
            // refresh dnf5daemon state
            await call(session, "org.rpm.dnf.v0.Base", "read_all_repos", []);
            const [, resolve_result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as [unknown[], number];
            if (resolve_result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving read_all_repos failed with result=${resolve_result} - ${problem}`);
            }

            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        }

        async function resolve(session: string) {
            const installed_names = new Set();
            const seen_names = new Set();
            const package_attrs = ["name", "is_installed"];

            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [
                {
                    package_attrs: { t: 'as', v: package_attrs },
                    scope: { t: 's', v: "all" },
                    patterns: { t: 'as', v: pkgnames }
                }
            ]) as ListPackage[][];

            for (const pkg of results) {
                if (seen_names.has(pkg.name.v))
                    continue;

                if (pkg.is_installed.v) {
                    installed_names.add(pkg.name.v);
                } else {
                    data.missing_ids.push(pkg.id.v);
                    data.missing_names.push(pkg.name.v);
                }

                seen_names.add(pkg.name.v);
            }

            pkgnames.forEach((name: string) => {
                if (!installed_names.has(name) && data.missing_names.indexOf(name) == -1)
                    data.unavailable_names.push(name);
            });
        }

        async function simulate(session: string) {
            if (data.missing_ids.length === 0 || data.unavailable_names.length > 0) {
                return null;
            }

            await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [pkgnames, {}]);
            const [transaction_items, result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as InstallResolveResult;
            if (result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving install failed with result=${result}. ${problem}`);
            }

            for (const transaction_item of transaction_items) {
                const [object_type, action, reason, _transaction_item_attributes, pkg] = transaction_item;
                const name = pkg.name.v;

                if (object_type !== "Package") {
                    console.error(`Simulated install for ${pkgnames} resolved an unexpected object_type=${object_type}`);
                    continue;
                }

                data.download_size += pkg.download_size.v;

                if (reason == "Dependency") {
                    if (data.missing_names.indexOf(name) == -1)
                        data.extra_names.push(name);
                }

                if (action == "Replaced") {
                    if (data.remove_names.indexOf(name) == -1)
                        data.remove_names.push(name);
                }
            }

            // Call reset() as we don't intend to complete the transaction using `do_transaction`
            await call(session, "org.rpm.dnf.v0.Goal", "reset", []);
        }

        function signal_emitted(_path: string, _iface: string, _signal: string, _args: unknown[]) {
            // HACK: dnf5daemon doesn't give us an useful progress indicator so the progress percentage is hardcoded to 0.
            if (progress_cb) {
                progress_cb({
                    waiting: false,
                    percentage: 0,
                    cancel: null,
                });
            }
        }

        let session: string | null = null;
        const client = dbus_client();
        const subscription = client.subscribe({}, signal_emitted);

        try {
            session = await open_session();
            await refresh(session);
            await resolve(session);
            await simulate(session);
        } catch (err) {
            console.warn(err);
            throw err;
        } finally {
            if (session)
                await close_session(session);
        }

        subscription.remove();
        // HACK: close the client so subscribe matches are actually dropped. https://github.com/cockpit-project/cockpit/issues/21905
        client.close();

        return data;
    }

    async install_missing_packages(data: MissingPackages, progress_cb?: InstallProgressCB): Promise<void> {
        if (!data || data.missing_ids.length === 0)
            return;

        let last_info: number;
        let last_progress = 0;
        let last_name: string;
        let total_packages: number;

        function signal_emitted(_path: string, _iface: string, signal: string, args: unknown[]) {
            switch (signal) {
            // download_add_new(o session_object_path, s download_id, s description, x total_to_download)
            case 'download_add_new': {
                last_info = InstallProgressType.DOWNLOADING;
                last_name = args[2] as string;
                break;
            }
            // download_progress(o session_object_path, s download_id, x total_to_download, x downloaded)
            case 'download_progress': {
                last_info = InstallProgressType.DOWNLOADING;
                break;
            }
            // download_end(o session_object_path, s download_id, u transfer_status, s message)
            case 'download_end':
                last_info = 0;
                last_name = "";
                break;
            // transaction_before_begin(o session_object_path, t total)
            case 'transaction_before_begin':
                [, total_packages] = args as [string, number];
                last_info = InstallProgressType.INSTALLING;
                break;
            // transaction_elem_progress(o session_object_path, s nevra, t processed, t total)
            case 'transaction_elem_progress': {
                let processed = 0;
                [, last_name, processed,] = args as [string, string, number, number];
                last_progress = processed / total_packages * 100;
                break;
            }
            }

            if (progress_cb)
                progress_cb({
                    cancel: null,
                    info: last_info,
                    package: last_name,
                    percentage: last_progress,
                    waiting: false,
                });
        }

        const client = dbus_client();
        const subscription = client.subscribe({}, signal_emitted);
        let session: string | null = null;

        try {
            session = await open_session();
            await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [data.missing_names, {}]);
            const [, resolve_result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);

            if (resolve_result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving install failed with result=${resolve_result} ${problem}`);
            }
            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        } catch (err) {
            console.warn("install error", err);
        } finally {
            if (session)
                await close_session(session);
        }

        subscription.remove();
        client.close();
    }
}
