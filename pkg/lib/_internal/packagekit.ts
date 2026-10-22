/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, InstallProgressType, UpdateProgressType, UpdateDetail, Update, ProgressData, History, UpdateProgressHandlers, TransactionExitStatus, UpdateError, UpdateNotify, RunningUpdate, Severity } from './packagemanager-abstract';

import { superuser } from 'superuser';

const _ = cockpit.gettext;

// see https://github.com/PackageKit/PackageKit/blob/main/lib/packagekit-glib2/pk-enum.h
export const Enum = {
    EXIT_SUCCESS: 1,
    EXIT_FAILED: 2,
    EXIT_CANCELLED: 3,
    ROLE_REFRESH_CACHE: 13,
    ROLE_UPDATE_PACKAGES: 22,
    INFO_UNKNOWN: -1,
    INFO_LOW: 3,
    INFO_ENHANCEMENT: 4,
    INFO_NORMAL: 5,
    INFO_BUGFIX: 6,
    INFO_IMPORTANT: 7,
    INFO_SECURITY: 8,
    INFO_DOWNLOADING: 10,
    INFO_UPDATING: 11,
    INFO_INSTALLING: 12,
    INFO_REMOVING: 13,
    INFO_REINSTALLING: 19,
    INFO_DOWNGRADING: 20,
    STATUS_WAIT: 1,
    STATUS_DOWNLOAD: 8,
    STATUS_INSTALL: 9,
    STATUS_UPDATE: 10,
    STATUS_CLEANUP: 11,
    STATUS_SIGCHECK: 14,
    STATUS_WAITING_FOR_LOCK: 30,
    FILTER_INSTALLED: (1 << 2),
    FILTER_NOT_INSTALLED: (1 << 3),
    FILTER_NEWEST: (1 << 16),
    FILTER_ARCH: (1 << 18),
    FILTER_NOT_SOURCE: (1 << 21),
    ERROR_ALREADY_INSTALLED: 9,
    TRANSACTION_FLAG_SIMULATE: (1 << 2),
};

const UpdateProgressMap: Record<number, UpdateProgressType> = {
    [Enum.STATUS_DOWNLOAD]: UpdateProgressType.DOWNLOADING,
    [Enum.STATUS_INSTALL]: UpdateProgressType.INSTALLING,
    [Enum.STATUS_UPDATE]: UpdateProgressType.UPDATING,
    [Enum.STATUS_CLEANUP]: UpdateProgressType.CLEANUP,
    [Enum.STATUS_SIGCHECK]: UpdateProgressType.SIGCHECK,
};

const InstallProgressMap = {
    [Enum.INFO_DOWNLOADING]: InstallProgressType.DOWNLOADING,
    [Enum.INFO_UPDATING]: InstallProgressType.UPDATING,
    [Enum.INFO_REMOVING]: InstallProgressType.REMOVING,
    [Enum.INFO_INSTALLING]: InstallProgressType.INSTALLING,
    [Enum.INFO_REINSTALLING]: InstallProgressType.REINSTALLING,
    [Enum.INFO_DOWNGRADING]: InstallProgressType.DOWNGRADING,
};

function debug(...args: unknown[]) {
    if (window.debugging === 'all' || window.debugging?.includes('packagekit'))
        console.debug(...args);
}

interface SignalHandlers {
    Package?: (info: number, packageId: string, summary: string) => void;
    UpdateDetail?: (packageId: string, updates: unknown, obsoletes: unknown,
        vendor_urls: string[], bug_urls: string[], cve_urls: string[],
        restart: boolean, update_text: string, changelog: string) => void;
    ErrorCode?: (code: string, detail: string) => void;
    Finished?: (exit: number) => void;
    Details?: (details: { size: { v: number, t: string } }) => void;
    Transaction?: (objPath: string, timeSpec: string, succeeded: string,
        role: number, duration: string, data: string) => void;
}

const transactionInterface = "org.freedesktop.PackageKit.Transaction";

let _dbus_client: cockpit.DBusClient | null = null;
/**
 * Get PackageKit D-Bus client
 *
 * This will get lazily initialized and re-initialized after PackageKit
 * disconnects (due to a crash or idle timeout).
 */
function dbus_client() {
    if (_dbus_client === null) {
        _dbus_client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try", track: true });
        _dbus_client.addEventListener("close", () => {
            console.log("PackageKit went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => { _dbus_client = null });

/**
 * Call a PackageKit method
 */
export function call(objectPath: string, iface: string, method: string, args?: unknown[] | null, opts?: cockpit.DBusCallOptions) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

/**
 * Watch a running PackageKit transaction
 *
 * transactionPath (string): D-Bus object path of the PackageKit transaction
 * signalHandlers, notifyHandler: As in method #transaction
 * Returns: If notifyHandler is set, Cockpit promise that resolves when the watch got set up
 */
export function watchTransaction(transactionPath: string, signalHandlers: SignalHandlers, notifyHandler?: (props: Record<string, unknown>, path: string) => void) {
    const subscriptions: { remove: () => void }[] = [];
    let notifyReturn: cockpit.DeferredPromise<void> | undefined;
    const client = dbus_client();

    // Listen for PackageKit crashes while the transaction runs
    function onClose(_event: unknown, ex: unknown) {
        console.warn("PackageKit went away during transaction", transactionPath, ":", JSON.stringify(ex));
        if (signalHandlers.ErrorCode)
            signalHandlers.ErrorCode("close", _("PackageKit crashed"));
        if (signalHandlers.Finished)
            signalHandlers.Finished(Enum.EXIT_FAILED);
    }
    client.addEventListener("close", onClose);

    if (signalHandlers) {
        for (const [member, handler] of Object.entries(signalHandlers)) {
            if (handler) {
                subscriptions.push(
                    client.subscribe({ interface: transactionInterface, path: transactionPath, member },
                                     (_path, _iface, _signal, args) => handler(...args))
                );
            }
        }
    }

    if (notifyHandler) {
        notifyReturn = client.watch(transactionPath);
        subscriptions.push(notifyReturn as unknown as { remove: () => void });
        client.addEventListener("notify", (event: CustomEvent) => {
            const data = event.detail as Record<string, Record<string, unknown>>;
            const iface = data?.[transactionPath]?.[transactionInterface];
            if (iface)
                notifyHandler(iface as Record<string, unknown>, transactionPath);
        });
    }

    // unsubscribe when transaction finished
    subscriptions.push(client.subscribe(
        { interface: transactionInterface, path: transactionPath, member: "Finished" },
        () => {
            subscriptions.map(s => s.remove());
            client.removeEventListener("close", onClose);
        })
    );

    return notifyReturn;
}

/**
 * Run a PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 *                  If undefined, only a transaction will be created without calling a method on it
 * arglist (array): "in" arguments of @method
 * signalHandlers (object): maps PackageKit.Transaction signal names to handlers
 * notifyHandler (function): handler for https://docs.cockpit-project.org/cockpit-guide/latest/guide/cockpit-dbus.html#cockpit-dbus-onnotify
 *                           signals, called on property changes with (changed_properties, transaction_path)
 * Returns: Promise that resolves with transaction path on success, or rejects on an error
 *
 * Note that most often you don't really need the transaction path, but want to
 * listen to the "Finished" signal.
 *
 * Example:
 *     transaction("GetUpdates", [0], {
 *             Package: (info, packageId, _summary) => { ... },
 *             ErrorCode: (code, details) => { ... },
 *         },
 *         changedProps => { ... }  // notify handler
 *     )
 *        .then(transactionPath => { ... })
 *        .catch(ex => { handle exception });
 */
export function transaction(method: string, arglist: unknown[], signalHandlers?: SignalHandlers, notifyHandler?: (props: Record<string, unknown>, path: string) => void): Promise<unknown> {
    return call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [])
            .then(([transactionPath]) => {
                if (!signalHandlers && !notifyHandler)
                    return transactionPath;

                const watchPromise = watchTransaction(transactionPath as string, signalHandlers!, notifyHandler) || Promise.resolve();
                return watchPromise.then(() => {
                    if (method) {
                        return call(transactionPath as string, transactionInterface, method, arglist)
                                .then(() => transactionPath);
                    } else {
                        return transactionPath;
                    }
                });
            });
}

export class TransactionError extends Error {
    detail: string;
    code: string;

    constructor(code: string, detail: string) {
        super(detail);
        this.detail = detail;
        this.code = code;
    }
}

/**
 * Run a long cancellable PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 * arglist (array): "in" arguments of @method
 * progress_cb: Callback that receives a {waiting, percentage, cancel} object regularly; if cancel is not null, it can
 *              be called to cancel the current transaction. if wait is true, PackageKit is waiting for its lock (i. e.
 *              on another package operation)
 * signalHandlers, notifyHandler: As in method #transaction, but ErrorCode and Finished are handled internally
 * Returns: Promise that resolves when the transaction finished successfully, or rejects with TransactionError
 *          on failure.
 */
export function cancellableTransaction(method: string, arglist: unknown[], progress_cb: ProgressCB | null | undefined, signalHandlers?: SignalHandlers): Promise<void> {
    if (signalHandlers?.ErrorCode || signalHandlers?.Finished)
        throw Error("cancellableTransaction handles ErrorCode and Finished signals internally");

    return new Promise((resolve, reject) => {
        let cancelled = false;
        let status: number | undefined;
        let allow_wait_status = false;
        const progress_data: ProgressData = {
            waiting: false,
            percentage: 0,
            cancel: null
        };

        function changed(props: Record<string, unknown>, transaction_path: string) {
            function cancel() {
                call(transaction_path, transactionInterface, "Cancel", []);
                cancelled = true;
            }

            if (progress_cb) {
                if ("Status" in props)
                    status = props.Status as number;
                progress_data.waiting = allow_wait_status && (status === Enum.STATUS_WAIT || status === Enum.STATUS_WAITING_FOR_LOCK);
                if ("AllowCancel" in props)
                    progress_data.cancel = props.AllowCancel ? cancel : null;
                if ("Percentage" in props && (props.Percentage as number) <= 100)
                    progress_data.percentage = props.Percentage as number;

                progress_cb(progress_data);
            }
        }

        // We ignore STATUS_WAIT and friends during the first second of a transaction.  They
        // are always reported briefly even when a transaction doesn't really need to wait.
        window.setTimeout(() => {
            allow_wait_status = true;
            changed({}, "");
        }, 1000);

        transaction(method, arglist,
                    Object.assign({
                        // avoid calling progress_cb after ending the transaction, to avoid flickering cancel buttons
                        ErrorCode: (code: string, detail: string) => {
                            progress_cb = null;
                            reject(new TransactionError(cancelled ? "cancelled" : code, detail));
                        },
                        Finished: (_exit: number) => {
                            progress_cb = null;
                            resolve();
                        },
                    }, signalHandlers || {}),
                    changed)
                .catch(ex => {
                    progress_cb = null;
                    reject(ex);
                });
    });
}

/**
 * On Debian the update_text starts with "== version ==" which is
 * redundant; we don't want Markdown headings in the table
 *
 * @param {string} text - update_text to filter
 */
function removeHeading(text: string) {
    if (text)
        return text.trim().replace(/^== .* ==\n/, "")
                .trim();
    return text;
}

// parse CVEs from an arbitrary text (changelog) and return URL array
function parseCVEs(text: string) {
    if (!text)
        return [];

    const cves = text.match(/CVE-\d{4}-\d+/g);
    if (!cves)
        return [];
    return cves.map(n => "https://www.cve.org/CVERecord?id=" + n);
}

function deduplicate<T>(list: T[]): T[] {
    return [...new Set(list)].sort();
}

function loadUpdateDetailsBatch(pkg_ids: string[], update_details: Record<string, Partial<UpdateDetail> & Update>, progress_cb?: ProgressCB) {
    return cancellableTransaction("GetUpdateDetail", [pkg_ids], progress_cb, {
        UpdateDetail: (packageId: string, _updates: unknown, _obsoletes: unknown,
            vendor_urls: string[], bug_urls: string[], cve_urls: string[],
            _restart: boolean, update_text: string, changelog: string /* state, issued, updated */) => {
            const u = update_details[packageId];
            if (!u) {
                console.warn("Mismatching update:", packageId);
                return;
            }

            u.vendor_urls = vendor_urls;
            u.description = removeHeading(update_text) || changelog;
            if (update_text)
                u.markdown = true;

            u.bug_urls = deduplicate(bug_urls);
            // many backends don't support proper severities; parse CVEs from description as a fallback
            u.cve_urls = deduplicate(cve_urls && cve_urls.length > 0 ? cve_urls : parseCVEs(u.description));
            if (u.cve_urls && u.cve_urls.length > 0)
                u.severity = Severity.CRITICAL;
            u.vendor_urls = vendor_urls || [];
            // u.restart = restart; // broken (always "1") at least in Fedora
            debug("UpdateDetail:", u);
        }
    });
}

export class PackageKitManager implements PackageManager {
    name: string;

    constructor() {
        this.name = "packagekit";
    }

    /* Support for installing missing packages.
     *
     * First call check_missing_packages to determine whether something
     * needs to be installed, then call install_missing_packages to
     * actually install them.
     *
     * check_missing_packages resolves to an object that can be passed to
     * install_missing_packages.  It contains these fields:
     *
     * - missing_names:     Packages that were requested, are currently not installed,
     *                      and can be installed.
     *
     * - missing_ids:       The full PackageKit IDs corresponding to missing_names
     *
     * - unavailable_names: Packages that were requested, are currently not installed,
     *                      but can't be found in any repository.
     *
     * If unavailable_names is empty, a simulated installation of the missing packages
     * is done and the result also contains these fields:
     *
     * - extra_names:       Packages that need to be installed as dependencies of
     *                      missing_names.
     *
     * - remove_names:      Packages that need to be removed.
     *
     * - download_size:     Bytes that need to be downloaded.
     */
    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        const install_ids: string[] = [];
        const installed_names = new Set();
        const data: MissingPackages = {
            download_size: 0,
            missing_ids: [],
            missing_names: [],
            unavailable_names: [],
            extra_names: [],
            remove_names: [],
        };

        if (pkgnames.length === 0)
            return data;

        await this.refresh(false, progress_cb);

        await cancellableTransaction("Resolve",
                                     [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_NEWEST, pkgnames],
                                     progress_cb,
                                     {
                                         Package: (_info: number, package_id: string) => {
                                             const parts = package_id.split(";");
                                             const repos = parts[3].split(":");
                                             if (repos.indexOf("installed") >= 0) {
                                                 installed_names.add(parts[0]);
                                             } else {
                                                 data.missing_ids.push(package_id);
                                                 data.missing_names.push(parts[0]);
                                             }
                                         },
                                     });
        pkgnames.forEach(name => {
            if (!installed_names.has(name) && data.missing_names.indexOf(name) === -1)
                data.unavailable_names.push(name);
        });

        if (data.missing_ids.length > 0 && data.unavailable_names.length === 0) {
            await cancellableTransaction("InstallPackages",
                                         [Enum.TRANSACTION_FLAG_SIMULATE, data.missing_ids],
                                         progress_cb,
                                         {
                                             Package: (info: number, package_id: string) => {
                                                 const name = package_id.split(";")[0];
                                                 if (info === Enum.INFO_REMOVING) {
                                                     data.remove_names.push(name);
                                                 } else if (info === Enum.INFO_INSTALLING ||
                                                             info === Enum.INFO_UPDATING) {
                                                     install_ids.push(package_id);
                                                     if (data.missing_names.indexOf(name) === -1)
                                                         data.extra_names.push(name);
                                                 }
                                             }
                                         });
            data.missing_names.sort();
            data.extra_names.sort();
            data.remove_names.sort();
        }

        if (install_ids.length > 0) {
            await cancellableTransaction("GetDetails",
                                         [install_ids],
                                         progress_cb,
                                         {
                                             Details: (details: { size: { v: number, t: string } }) => {
                                                 if (details.size)
                                                     data.download_size += details.size.v;
                                             }
                                         });
        }

        return data;
    }

    /* Carry out what check_missing_packages has planned.
     *
     * In addition to the usual "waiting", "percentage", and "cancel"
     * fields, the object reported by progress_cb also includes "info" and
     * "package" from the "Package" signal.
     */
    async install_missing_packages(data: MissingPackages, progress_cb?: InstallProgressCB): Promise<void> {
        if (!data || data.missing_ids.length === 0)
            return;

        let last_progress: ProgressData | null = null;
        let last_info = 0;
        let last_name = "";

        function report_progress() {
            if (progress_cb && last_progress !== null)
                progress_cb({
                    waiting: last_progress.waiting,
                    percentage: last_progress.percentage,
                    cancel: last_progress.cancel,
                    info: InstallProgressMap[last_info],
                    // Maps PackageKit state to our own PackageManager state temporary
                    // until all pkg/lib/packagekit use cases are supported by the PackageManager abstraction.
                    package: last_name
                });
        }

        await cancellableTransaction("InstallPackages", [0, data.missing_ids],
                                     (p: ProgressData) => {
                                         last_progress = p;
                                         report_progress();
                                     },
                                     {
                                         Package: (info: number, id: string) => {
                                             last_info = info;
                                             last_name = id.split(";")[0];
                                             report_progress();
                                         }
                                     });
    }

    async refresh(force: boolean, progress_cb?: ProgressCB): Promise<void> {
        return cancellableTransaction("RefreshCache", [force], progress_cb);
    }

    async is_installed(pkgnames: string[]): Promise<boolean> {
        const uninstalled = new Set(pkgnames);

        if (uninstalled.size === 0)
            return true;

        await cancellableTransaction("Resolve",
                                     [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_INSTALLED, pkgnames],
                                     null,
                                     {
                                         Package: (_info: unknown, package_id: string) => {
                                             const parts = package_id.split(";");
                                             uninstalled.delete(parts[0]);
                                         },
                                     });

        return uninstalled.size === 0;
    }

    async install_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void> {
        const flags = Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_NEWEST;
        const ids: string[] = [];

        await cancellableTransaction("Resolve", [flags | Enum.FILTER_NOT_INSTALLED, Array.from(pkgnames)], null,
                                     {
                                         Package: (_info: unknown, package_id: string) => ids.push(package_id),
                                     });

        if (ids.length === 0)
            return Promise.reject(new TransactionError("not-found", "Can't resolve package(s)"));
        else
            return cancellableTransaction("InstallPackages", [0, ids], progress_cb)
                    .catch(ex => {
                        if (ex.code !== Enum.ERROR_ALREADY_INSTALLED)
                            return Promise.reject(ex);
                    });
    }

    async remove_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void> {
        const ids: string[] = [];

        await cancellableTransaction("Resolve", [Enum.FILTER_NOT_SOURCE | Enum.FILTER_INSTALLED | Enum.FILTER_NOT_SOURCE, pkgnames], null,
                                     {
                                         Package: (_info: unknown, package_id: string) => ids.push(package_id),
                                     });

        if (ids.length === 0)
            return Promise.resolve();

        return cancellableTransaction("RemovePackages", [0, ids, true, false], progress_cb);
    }

    async find_file_packages(files: string[], progress_cb?: ProgressCB): Promise<string[]> {
        const installed: string[] = [];
        await cancellableTransaction("SearchFiles",
                                     [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_INSTALLED, files],
                                     progress_cb,
                                     {
                                         Package: (_info: unknown, package_id: string) => {
                                             const pkg = package_id.split(";")[0];
                                             installed.push(pkg);
                                         },
                                     });

        return installed;
    }

    /**
     * Get Updates
     * updates = { id, name, version, arch }
     * with details
     * updates = { id, name, version, arch, severity, bug_urls, cve_urls, vendor_urls, description, markdown }
     * @param {boolean} details - fetch detailed package information (security information)
     */
    async get_updates<T extends boolean>(details: T, progress_cb?: ProgressCB): Promise<T extends true ? UpdateDetail[] : Update[]> {
        const updates: Record<string, Partial<UpdateDetail> & Update> = {};

        await cancellableTransaction(
            "GetUpdates", [0],
            progress_cb,
            {
                Package: (info: number, packageId: string, summary: string) => {
                    // HACK: security updates have 0x50008 with PackageKit 1.2.8, so just consider the lower 8 bits
                    info = info & 0xff;
                    const id_fields = packageId.split(";");
                    // HACK: dnf backend yields wrong severity with PK < 1.2.4 (https://github.com/PackageKit/PackageKit/issues/268)
                    if (info < Enum.INFO_LOW || info > Enum.INFO_SECURITY)
                        info = Enum.INFO_NORMAL;

                    if (info === Enum.INFO_LOW)
                        info = Severity.LOW;
                    else if (info === Enum.INFO_ENHANCEMENT)
                        info = Severity.MODERATE;
                    else if (info === Enum.INFO_SECURITY)
                        info = Severity.CRITICAL;
                    else if (info >= Enum.INFO_NORMAL)
                        info = Severity.IMPORTANT;
                    else
                        info = Severity.MODERATE;

                    updates[packageId] = { id: packageId, name: id_fields[0], version: id_fields[1], severity: info, arch: id_fields[2], summary };
                }
            });

        const pkg_ids = Object.keys(updates);

        if (details && pkg_ids.length > 0) {
            const processBatch = async (remaining_ids: string[], current_batch_size: number) => {
                if (remaining_ids.length === 0) {
                    return;
                }

                const batch = remaining_ids.slice(0, current_batch_size);
                const next_ids = remaining_ids.slice(current_batch_size);

                try {
                    await loadUpdateDetailsBatch(batch, updates, progress_cb);
                    // continue with next batch using same batch size
                    await processBatch(next_ids, current_batch_size);
                } catch (ex) {
                    console.warn("GetUpdateDetail failed with batch size", current_batch_size, ":", JSON.stringify(ex));

                    if (current_batch_size > 1) {
                        // Reduce batch size to 1 and retry
                        console.log("Reducing GetUpdateDetail batch size to 1 and retrying");
                        await processBatch(remaining_ids, 1);
                    } else {
                        // Even batch size 1 failed, skip this batch and continue
                        console.warn("Failed to load update details for package:", batch[0]);
                        await processBatch(next_ids, 1);
                    }
                }
            };

            // Avoid exceeding cockpit-ws frame size, so batch the loading of details
            // if we run into https://issues.redhat.com/browse/RHEL-109779 then we need to fall back to load packages
            // individually
            await processBatch(pkg_ids, 500);
        }

        return Object.entries(updates).map(([key, u]) => ({ ...u, id: key })) as unknown as T extends true ? UpdateDetail[] : Update[];
    }

    async update_packages(updates: Update[] | UpdateDetail[], handlers: UpdateProgressHandlers): Promise<TransactionExitStatus> {
        const update_ids = updates.map(u => u.id);
        let transactionPath: string | null = null;
        const errorMessages: string[] = [];

        return new Promise<TransactionExitStatus>((resolve, reject) => {
            transaction("UpdatePackages", [0, update_ids],
                        {
                            ErrorCode: (_code: string, details: string) => errorMessages.push(details),
                            Finished: (exit: number) => {
                                if (exit === Enum.EXIT_SUCCESS) {
                                    resolve(TransactionExitStatus.SUCCESS);
                                } else if (exit === Enum.EXIT_CANCELLED) {
                                    resolve(TransactionExitStatus.CANCELLED);
                                } else {
                                    if (exit !== Enum.EXIT_FAILED)
                                        errorMessages.push(cockpit.format(cockpit.gettext("PackageKit reported error code $0"), exit));
                                    reject(new UpdateError(errorMessages));
                                }
                            },
                            Package: (status: number, packageId: string) => {
                                if (status in UpdateProgressMap)
                                    handlers.on_package(UpdateProgressMap[status], packageId);
                            },
                        },
                        (notify: Record<string, unknown>, path: string) => {
                            transactionPath = path;
                            const props: UpdateNotify = {
                                cancel: notify.AllowCancel
                                    ? () => call(transactionPath!, transactionInterface, "Cancel", [])
                                    : null,
                            };
                            if (notify.Percentage !== undefined)
                                props.percentage = notify.Percentage as number;
                            if (notify.RemainingTime !== undefined)
                                props.remaining_time = notify.RemainingTime as number;
                            if (notify.LastPackage !== undefined)
                                props.last_package = notify.LastPackage as string;
                            handlers.on_notify(props);
                        },
            ).catch(reject);
        });
    }

    async get_running_update(handlers: UpdateProgressHandlers): Promise<RunningUpdate | null> {
        let transactions: string[];
        let roles: unknown[];

        try {
            [transactions] = await call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", []) as [string[]];
            roles = await Promise.all(transactions.map(path => call(path, "org.freedesktop.DBus.Properties",
                                                                    "Get", [transactionInterface, "Role"])));
        } catch (ex) {
            console.warn("GetTransactionList: failed to read PackageKit transaction roles:", String(ex));
            return null;
        }

        for (let idx = 0; idx < roles.length; ++idx) {
            const [role] = roles[idx] as [{ v: number }];

            if (role.v !== Enum.ROLE_UPDATE_PACKAGES) {
                continue;
            }

            const transactionPath = transactions[idx];
            const errorMessages: string[] = [];
            const promise = new Promise<TransactionExitStatus>((resolve, reject) => {
                watchTransaction(transactionPath,
                                 {
                                     ErrorCode: (_code: string, details: string) => errorMessages.push(details),
                                     Finished: (exit: number) => {
                                         if (exit === Enum.EXIT_SUCCESS) {
                                             resolve(TransactionExitStatus.SUCCESS);
                                         } else if (exit === Enum.EXIT_CANCELLED) {
                                             resolve(TransactionExitStatus.CANCELLED);
                                         } else {
                                             if (exit !== Enum.EXIT_FAILED)
                                                 errorMessages.push(cockpit.format(cockpit.gettext("PackageKit reported error code $0"), exit));
                                             reject(new UpdateError(errorMessages));
                                         }
                                     },
                                     Package: (status: number, packageId: string) => {
                                         if (status in UpdateProgressMap)
                                             handlers.on_package(UpdateProgressMap[status], packageId);
                                     },
                                 },
                                 (notify: Record<string, unknown>) => {
                                     const props: UpdateNotify = {
                                         cancel: notify.AllowCancel ? () => call(transactionPath, transactionInterface, "Cancel", []) : null,
                                     };

                                     if (notify.Percentage !== undefined)
                                         props.percentage = notify.Percentage as number;
                                     if (notify.RemainingTime !== undefined)
                                         props.remaining_time = notify.RemainingTime as number;
                                     if (notify.LastPackage !== undefined)
                                         props.last_package = notify.LastPackage as string;

                                     handlers.on_notify(props);
                                 },
                );
            });

            return { promise };
        }

        return null;
    }

    async get_backend(): Promise<string> {
        const [result] = await call("/org/freedesktop/PackageKit",
                                    "org.freedesktop.DBus.Properties",
                                    "Get", ["org.freedesktop.PackageKit", "BackendName"]) as [{ v: string, t: string }];
        return result.v;
    }

    async get_last_refresh_time(): Promise<number> {
        const [seconds] = await call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction", [Enum.ROLE_REFRESH_CACHE]) as [number];
        return seconds;
    }

    async get_history(): Promise<History[]> {
        const history = [] as History[];

        // would be nice to filter only for "update-packages" role, but can't here
        await transaction("GetOldTransactions", [0], {
            Transaction: (_objPath: string, timeSpec: string, _succeeded: string, role: number, _duration: string, data: string) => {
                if (role !== Enum.ROLE_UPDATE_PACKAGES)
                    return;

                /**
                 * data looks like:
                 * downloading\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                 * updating\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                 * timeSpec will be one of:
                 * 2026-01-29T12:57:49.112827-08
                 * 2026-01-29T19:27:49.112827-01:30
                 * 2026-01-29T20:57:49.112827Z
                 * depending on timezone and PackageKit version
                 */
                let timestamp = Date.parse(timeSpec);
                if (isNaN(timestamp)) {
                    /*
                    * Neither Firefox's nor Chromium's parsers handle the short offset
                    * format (first one) as of 2026-01:
                    * https://bugzilla.mozilla.org/show_bug.cgi?id=2013444
                    * https://issues.chromium.org/issues/479862357
                    * so we hack around it by adding the :00
                    */
                    const shortoff_regex = /[-+]\d\d$/;
                    if (shortoff_regex.exec(timeSpec)) {
                        const fixed_timeSpec = timeSpec + ":00";
                        // console.debug(`Transaction has an invalid timeSpec=${timeSpec}, trying fixed=${fixed_timeSpec}`);
                        timestamp = Date.parse(fixed_timeSpec);
                    }
                }

                if (isNaN(timestamp)) {
                    console.warn(`Transaction has an invalid timeSpec=${timeSpec}, skipping`);
                    return;
                }

                const pkgs = { timestamp, packages: {} } as History;
                let empty = true;
                data.split("\n").forEach(line => {
                    const fields = line.trim().split("\t");
                    if (fields.length >= 2) {
                        const pkgId = fields[1].split(";");
                        pkgs.packages[pkgId[0]] = pkgId[1];
                        empty = false;
                    }
                });

                if (!empty)
                    history.unshift(pkgs); // PK reports in time-ascending order, but we want the latest first
            },
        });

        return history;
    }

    /**
     * Check a list of packages whether they are available.
     *
     * @param {string[]} pkgnames - names of packages which should be available in the repositories
     * @return {Promise<boolean>} true if packages are available
     */
    async is_available(pkgnames: string[]): Promise<boolean> {
        const available = new Set();

        if (pkgnames && pkgnames.length === 0)
            return true;

        await cancellableTransaction("Resolve",
                                     [Enum.FILTER_ARCH | Enum.FILTER_NEWEST | Enum.FILTER_NOT_INSTALLED, pkgnames],
                                     null,
                                     {
                                         Package: (_info: unknown, package_id: string) => {
                                             const pkgname = package_id.split(";")[0];
                                             available.add(pkgname);
                                         },
                                     });

        return available.size === new Set(pkgnames).size;
    }
}
