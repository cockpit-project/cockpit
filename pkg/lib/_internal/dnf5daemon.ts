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
import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, ResolveError, InstallProgressType, UpdateDetail, Update, Severity } from './packagemanager-abstract';

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
    nevra?: { t: "s"; v: string };
}

interface CollectionPackage {
    // arch
    a: { t: "s"; v: string };
    // epoch
    e: { t: "s"; v: string };
    // name
    n: { t: "s"; v: string };
    nevra: { t: "s"; v: string };
    // release
    r: { t: "s"; v: string };
    // version
    v: { t: "s"; v: string };
}

type AdvisoryType = "bugfix" | "enhancement" | "security" | "newpackage";

interface ListAdvisory {
    advisoryid: { t: "i", v: number };
    name: { t: "s", v: string };
    description: { t: "s", v: string };
    status: { t: "s", v: string };
    severity: { t: "s", v: Severity };
    type: { t: "s", v: AdvisoryType };
    collections: { t: "aa{sv}", v: [ { packages: { t: "aa{sv}", v: CollectionPackage[] } } ] }
    // Array of id, type, title, url
    references: { t: "a(ssss)", v: [string, string, string, string] }
}

interface ResolvePackage {
    arch: { t: "s"; v: string };
    download_size: { t: "t"; v: number };
    epoch: { t: "s"; v: string };
    evr: { t: "s"; v: string };
    from_repo_id: { t: "s"; v: string };
    id: { t: "i"; v: number };
    install_size: { t: "t"; v: number };
    name: { t: "s"; v: string };
    reason: { t: "s"; v: string };
    release: { t: "s"; v: string };
    repo_id: { t: "s"; v: string };
    version: { t: "s"; v: string };
}

interface TransactionProblem {
    action: { t: "u", v: number };
    additional_data: { t: "as", "v": string[] };
    goal_job_settings: { t: "a{vs}", "v": { to_repo_ids: { t: "as", v: string[] } } };
    problem: { t: "u", v: number };
    spec: { t: "s", v: "appstream-data" };
}

interface RepoListResult {
    cache_updated: { t: "x", "v": number };
}

enum GoalProblem {
    ALREADY_INSTALLED = (1 << 12)
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
type RemoveResolveResult = [TransactionItem[], number]
type UpgradeResolveResult = [TransactionItem[], number]

type SignalCB = (_path: string, _iface: string, signal: string, args: unknown[]) => void

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

    private async with_session(executor: (session: string) => Promise<void>, signal_handler?: SignalCB): Promise<void> {
        let session: string | null = null;
        let subscription: { remove: () => void } | null = null;

        const client = dbus_client();
        if (signal_handler)
            subscription = client.subscribe({}, signal_handler);

        try {
            session = await open_session();
            await executor(session);
        } finally {
            if (session)
                await close_session(session);
            if (subscription)
                subscription.remove();
        }
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
                    data.missing_ids.push(pkg.name.v);
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

        await this.refresh(false);
        await this.with_session(async (session) => {
            try {
                await resolve(session);
                await simulate(session);
            } catch (err) {
                console.warn("check_missing_packages", err);
                throw err;
            }
        }, signal_emitted);

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

        await this.with_session(async (session) => {
            try {
                await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [data.missing_names, {}]);
                const [, resolve_result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);

                if (resolve_result !== 0) {
                    const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                    throw new ResolveError(`Resolving install failed with result=${resolve_result} ${problem}`);
                }
                await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
            } catch (err) {
                console.warn("install error", err);
            }
        }, signal_emitted);
    }

    async refresh(_force: boolean, _progress_cb?: ProgressCB): Promise<void> {
        await this.with_session(async (session) => {
            // refresh dnf5daemon state
            await call(session, "org.rpm.dnf.v0.Base", "read_all_repos", []);
            const [, resolve_result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as [unknown[], number];
            if (resolve_result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving read_all_repos failed with result=${resolve_result} - ${problem}`);
            }

            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        });
    }

    async is_installed(pkgnames: string[]): Promise<boolean> {
        const uninstalled = new Set(pkgnames);

        await this.with_session(async (session) => {
            const package_attrs = ["name", "is_installed"];

            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [
                {
                    package_attrs: { t: 'as', v: package_attrs },
                    scope: { t: 's', v: "all" },
                    patterns: { t: 'as', v: pkgnames }
                }
            ]) as ListPackage[][];

            for (const pkg of results) {
                if (pkg.is_installed.v) {
                    uninstalled.delete(pkg.name.v);
                }
            }
        });

        return uninstalled.size === 0;
    }

    async install_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void> {
        let last_progress = 0;
        let total_packages: number;

        function signal_emitted(_path: string, _iface: string, signal: string, args: unknown[]) {
            switch (signal) {
            case 'transaction_before_begin':
                [, total_packages] = args as [string, number];
                break;
            case 'transaction_elem_progress': {
                const [, _last_name, processed,] = args as [string, string, number, number];
                last_progress = processed / total_packages * 100;
                break;
            }
            }

            if (progress_cb) {
                progress_cb({
                    waiting: false,
                    percentage: last_progress,
                    cancel: null,
                });
            }
        }

        await this.with_session(async (session) => {
            await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [pkgnames, {}]);
            const [_transaction_items, result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as InstallResolveResult;
            if (result !== 0) {
                const [problems] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems", []) as TransactionProblem[][];
                if (problems.every((p: TransactionProblem) => p.problem.v == GoalProblem.ALREADY_INSTALLED)) {
                    await call(session, "org.rpm.dnf.v0.Goal", "reset", []);
                    return;
                }

                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving install failed with result=${result}. ${problem}`);
            }
            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        }, signal_emitted);
    }

    async remove_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void> {
        let last_progress = 0;
        let total_packages: number;

        function signal_emitted(_path: string, _iface: string, signal: string, args: unknown[]) {
            switch (signal) {
            case 'transaction_before_begin':
                [, total_packages] = args as [string, number];
                break;
            case 'transaction_elem_progress': {
                const [, _last_name, processed,] = args as [string, string, number, number];
                last_progress = processed / total_packages * 100;
                break;
            }
            }

            if (progress_cb) {
                progress_cb({
                    waiting: false,
                    percentage: last_progress,
                    cancel: null,
                });
            }
        }

        await this.with_session(async (session) => {
            await call(session, "org.rpm.dnf.v0.rpm.Rpm", "remove", [pkgnames, {}]);
            const [_transaction_items, result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as RemoveResolveResult;
            if (result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving remove failed with result=${result}. ${problem}`);
            }
            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        }, signal_emitted);
    }

    async find_file_packages(files: string[], progress_cb?: ProgressCB): Promise<string[]> {
        const installed: string[] = [];

        await this.with_session(async (session) => {
            const package_attrs = ["name"];

            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [
                {
                    package_attrs: { t: 'as', v: package_attrs },
                    scope: { t: 's', v: "installed" },
                    patterns: { t: 'as', v: files },
                    with_filenames: { t: 'b', v: true },
                }
            ]) as ListPackage[][];
            for (const result of results) {
                installed.push(result.name.v);
            }

            // HACK: no usable progress event, but we need to send something to make refresh work.
            if (progress_cb)
                progress_cb({ percentage: 100, waiting: false, cancel: null });
        });

        return installed;
    }

    async get_updates<T extends boolean>(detail: T, _progress_cb?: ProgressCB): Promise<T extends true ? UpdateDetail[] : Update[]> {
        const update_map = new Map<string, Update | UpdateDetail>();
        const package_attrs = ["name", "version", "arch", "epoch", "nevra"];

        await this.with_session(async (session) => {
            const pkgnames = [];
            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [
                {
                    package_attrs: { t: 'as', v: package_attrs },
                    scope: { t: 's', v: "upgrades" },
                }
            ]) as ListPackage[][];

            for (const result of results) {
                cockpit.assert(result.nevra, "nevra not set");

                pkgnames.push(result.name.v);
                update_map.set(result.nevra.v, {
                    id: result.name.v,
                    name: result.name.v,
                    arch: result.arch.v,
                    version: result.version.v,
                });
            }

            if (detail) {
                const advisory_attrs = ["advisoryid", "name", "title", "type", "severity", "description", "references", "collections", "message"];
                const [advisories] = await call(session, "org.rpm.dnf.v0.Advisory", "list", [
                    {
                        advisory_attrs: { t: 'as', v: advisory_attrs },
                        availability: { t: 's', v: "upgrades" },
                        contains_pkgs: { t: 'as', v: pkgnames },
                    }
                ]) as ListAdvisory[][];

                for (const advisory of advisories) {
                    for (const collection of advisory.collections.v) {
                        for (const pkg of collection.packages.v) {
                            let update = update_map.get(pkg.nevra.v);
                            if (!update)
                                continue;

                            const bug_urls: string[] = [];
                            const cve_urls: string[] = [];
                            const vendor_urls: string[] = [];

                            for (const [, type, _title, url] of advisory.references.v) {
                                switch (type) {
                                case "bugzilla":
                                    bug_urls.push(url);
                                    break;
                                case "cve":
                                    cve_urls.push(url);
                                    break;
                                case "vendor":
                                    vendor_urls.push(url);
                                    break;
                                }
                            }

                            // Map the advisory type to the severity which PackageKit uses
                            // Critical == Security upate
                            // Important == Bug fix
                            // Moderate == Enhancement
                            let severity = Severity.LOW;
                            switch (advisory.type.v) {
                            case "bugfix":
                                severity = Severity.IMPORTANT;
                                break;
                            case "enhancement":
                                severity = Severity.MODERATE;
                                break;
                            case "security":
                                severity = Severity.CRITICAL;
                                break;
                            }

                            update = {
                                ...update,
                                description: advisory.description.v,
                                severity,
                                markdown: false,
                                bug_urls,
                                cve_urls,
                                vendor_urls,
                            };
                            update_map.set(pkg.nevra.v, update);

                            break;
                        }
                    }
                }
            }
        });

        return Array.from(update_map.values()) as T extends true ? UpdateDetail[] : Update[];
    }

    async update_packages(updates: Update[] | UpdateDetail[], progress_cb?: ProgressCB, _transaction_path?: string): Promise<void> {
        const pkgnames = updates.map(update => update.id);
        let last_progress = 0;
        let total_packages: number;

        function signal_emitted(_path: string, _iface: string, signal: string, args: unknown[]) {
            switch (signal) {
            case 'transaction_before_begin':
                [, total_packages] = args as [string, number];
                break;
            case 'transaction_elem_progress': {
                const [, _last_name, processed,] = args as [string, string, number, number];
                last_progress = processed / total_packages * 100;
                break;
            }
            }

            if (progress_cb) {
                progress_cb({
                    waiting: false,
                    percentage: last_progress,
                    cancel: null,
                });
            }
        }

        await this.with_session(async (session) => {
            await call(session, "org.rpm.dnf.v0.rpm.Rpm", "upgrade", [pkgnames, {}]);
            const [_transaction_items, result] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]) as UpgradeResolveResult;
            if (result !== 0) {
                const [problem] = await call(session, "org.rpm.dnf.v0.Goal", "get_transaction_problems_string", []);
                throw new ResolveError(`Resolving upgrade failed with result=${result}. ${problem}`);
            }
            await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
        }, signal_emitted);
    }

    async get_backend(): Promise<string> {
        return "dnf5";
    }

    async get_last_refresh_time(): Promise<number> {
        let last_time = 0;
        await this.with_session(async (session) => {
            // Bug? Does this need load repo? As the result was somehow -1 at one point.
            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Repo", "list", [{ repo_attrs: { t: 'as', v: ['cache_updated'] } }]) as RepoListResult[][];
            for (const result of results) {
                if (result.cache_updated.v > last_time)
                    last_time = result.cache_updated.v;
            }
        });

        const now = parseInt(await cockpit.spawn(["date", "+%s"]), 10);
        return now - last_time;
    }
}
