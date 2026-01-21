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

import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, InstallProgressType, UpdateDetail, Update, ProgressData, History, UpdatesNotifyCB, UpdatesPackageCB, UpdatesAbortCB, TransactionStatus } from './packagemanager-abstract';
import * as PK from "packagekit.js";

const _ = cockpit.gettext;

const InstallProgressMap = {
    [PK.Enum.INFO_DOWNLOADING]: InstallProgressType.DOWNLOADING,
    [PK.Enum.INFO_UPDATING]: InstallProgressType.UPDATING,
    [PK.Enum.INFO_REMOVING]: InstallProgressType.REMOVING,
    [PK.Enum.INFO_INSTALLING]: InstallProgressType.INSTALLING,
    [PK.Enum.INFO_REINSTALLING]: InstallProgressType.REINSTALLING,
    [PK.Enum.INFO_DOWNGRADING]: InstallProgressType.DOWNGRADING,
};

const UpdateStatusMap = {
    [PK.Enum.STATUS_CLEANUP]: TransactionStatus.CLEANUP,
    [PK.Enum.STATUS_DOWNLOAD]: TransactionStatus.DOWNLOAD,
    [PK.Enum.STATUS_INSTALL]: TransactionStatus.INSTALL,
    [PK.Enum.STATUS_SIGCHECK]: TransactionStatus.SIGCHECK,
    [PK.Enum.STATUS_UPDATE]: TransactionStatus.UPDATE,
    [PK.Enum.STATUS_WAITING_FOR_LOCK]: TransactionStatus.WAITING_FOR_LOCK,
    [PK.Enum.STATUS_WAIT]: TransactionStatus.WAIT,
};

export class PackageKitManager implements PackageManager {
    name: string;

    constructor() {
        this.name = "packagekit";
    }

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        return PK.check_missing_packages(pkgnames, progress_cb);
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

        function report_progess() {
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

        await PK.cancellableTransaction("InstallPackages", [0, data.missing_ids],
                                        (p: ProgressData) => {
                                            last_progress = p;
                                            report_progess();
                                        },
                                        {
                                            Package: (info: number, id: string) => {
                                                last_info = info;
                                                last_name = id.split(";")[0];
                                                report_progess();
                                            }
                                        });
    }

    async refresh(force: boolean, progress_cb?: ProgressCB): Promise<void> {
        return PK.refresh(force, progress_cb);
    }

    async is_installed(pkgnames: string[]): Promise<boolean> {
        const uninstalled = new Set(pkgnames);

        if (uninstalled.size === 0)
            return true;

        await PK.cancellableTransaction("Resolve",
                                        [PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_INSTALLED, pkgnames],
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
        const flags = PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST;
        const ids: string[] = [];

        await PK.cancellableTransaction("Resolve", [flags | PK.Enum.FILTER_NOT_INSTALLED, Array.from(pkgnames)], null,
                                        {
                                            Package: (_info: unknown, package_id: string) => ids.push(package_id),
                                        });

        if (ids.length === 0)
            return Promise.reject(new PK.TransactionError("not-found", "Can't resolve package(s)"));
        else
            return PK.cancellableTransaction("InstallPackages", [0, ids], progress_cb)
                    .catch(ex => {
                        if (ex.code != PK.Enum.ERROR_ALREADY_INSTALLED)
                            return Promise.reject(ex);
                    });
    }

    async remove_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void> {
        const ids: string[] = [];

        await PK.cancellableTransaction("Resolve", [PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_INSTALLED | PK.Enum.FILTER_NOT_SOURCE, pkgnames], null,
                                        {
                                            Package: (_info: unknown, package_id: string) => ids.push(package_id),
                                        });

        if (ids.length === 0)
            return Promise.resolve();

        return PK.cancellableTransaction("RemovePackages", [0, ids, true, false], progress_cb);
    }

    async find_file_packages(files: string[], progress_cb?: ProgressCB): Promise<string[]> {
        const installed: string[] = [];
        await PK.cancellableTransaction("SearchFiles",
                                        [PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_INSTALLED, files],
                                        progress_cb,
                                        {
                                            Package: (_info: unknown, package_id: string) => {
                                                const pkg = package_id.split(";")[0];
                                                installed.push(pkg);
                                            },
                                        });

        return installed;
    }

    async get_updates<T extends boolean>(detail: T, progress_cb?: ProgressCB): Promise<T extends true ? UpdateDetail[] : Update[]> {
        const updates = await PK.get_updates(detail, progress_cb);
        return updates as unknown as T extends true ? UpdateDetail[] : Update[];
    }

    async update_packages(updates: Update[] | UpdateDetail[], progress_cb?: ProgressCB, package_cb: UpdatesPackageCB, notify_cb: UpdatesNotifyCB, abort_cb: UpdatesAbortCB): Promise<void> {
        const abort = new AbortController();
        const transaction_path = await PK.transaction();
        abort.signal.throwIfAborted(); // early exit
        abort.signal.addEventListener('abort', () => PK.call(transaction_path, PK.transactionInterface, "Cancel", []));
        abort_cb(abort.abort);

        const update_promise = PK.call(transaction_path, PK.transactionInterface, "UpdatePackages", [0, updates.map(update => update.id)]);
        this.watch_updates(transaction_path, package_cb, notify_cb, update_promise);
    }

    async get_backend(): Promise<string> {
        return PK.getBackendName();
    }

    async get_last_refresh_time(): Promise<number> {
        const [seconds] = await PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction", [PK.Enum.ROLE_REFRESH_CACHE]);
        return seconds;
    }

    async get_history(): Promise<History[]> {
        const history = [] as History[];

        // would be nice to filter only for "update-packages" role, but can't here
        try {
            await PK.transaction("GetOldTransactions", [0], {
                Transaction: (_objPath: string, timeSpec: string, _succeeded: string, role: number, _duration: string, data: string) => {
                    if (role !== PK.Enum.ROLE_UPDATE_PACKAGES)
                        return;

                    // data looks like:
                    // downloading\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                    // updating\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                    const timestamp = Date.parse(timeSpec);
                    if (isNaN(timestamp)) {
                        console.debug(`Transaction has an invalid timespec=${timeSpec}`);
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
        } catch (exc) {
            console.warn("Failed to load old transactions:", exc);
        }

        return history;
    }

    async watch_active_transactions(package_cb: UpdatesPackageCB, notify_cb: UpdatesNotifyCB, abort_cb: UpdatesAbortCB): Promise<WatchResult> {
        const abort = new AbortController();
        console.log("watch active transactions");

        // check if there is an upgrade in progress already; if so, switch to "applying" state right away
        const [transactions] = await PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", []) as string[][];
        console.log(transactions);

        if (transactions.length === 0)
            return;

        const promises = transactions.map((transaction_path: string) => PK.call(transaction_path, "org.freedesktop.DBus.Properties", "Get", [PK.transactionInterface, "Role"]));
        const [roles] = await Promise.all(promises);

        for (let idx = 0; idx < roles.length; ++idx) {
            if (roles[idx].v === PK.Enum.ROLE_UPDATE_PACKAGES) {
                const transaction_path = transactions[idx];

                abort.signal.throwIfAborted(); // early exit
                abort.signal.addEventListener('abort', () => PK.call(transaction_path, PK.transactionInterface, "Cancel", []));
                abort_cb(abort.abort);

                return await this.watch_updates(transactions[idx], package_cb, notify_cb, null);
            }
        }
    }

    private async watch_updates(transaction_path: string, package_cb: UpdatesPackageCB, notify_cb: UpdatesNotifyCB, wait_promise?: Promise<void> | null): Promise<WatchResult> {
        const errors: string[] = [];
        let ret: number = 0;
        let resolve, reject;
        console.log("wait promise", wait_promise);

        if (wait_promise) {
            wait_promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
        }

        try {
            await PK.watchTransaction(transaction_path,
                                      {
                                          ErrorCode: (_code: number, details: string) => errors.push(details),

                                          Finished: (exit: number) => {
                                              ret = exit;
                                              // normally we get FAILED here with ErrorCodes; handle unexpected errors to allow for some debugging
                                              if (exit !== PK.Enum.EXIT_FAILED)
                                                  errors.push(cockpit.format(_("PackageKit reported error code $0"), exit));
                                              if (resolve)
                                                  resolve();
                                          },

                                          // not working/being used in at least Fedora
                                          RequireRestart: (type: number, packageId: string) => console.log("update RequireRestart", type, packageId),

                                          Package: (status: number, packageId: string) => {
                                              const id_fields = packageId.split(";");
                                              // TODO: handle unknown statuses
                                              package_cb({ id: packageId, name: id_fields[0], version: id_fields[1], arch: id_fields[2], status: UpdateStatusMap[status] });
                                          },
                                      },
                                      notify => {
                                          console.log("notify call back", notify);
                                          notify_cb(notify);
                                      }
            );
        } catch (exc) {
            cockpit.assert(exc instanceof Error, "Unknown exception type");
            errors.push(exc.toString());
        }

        console.log("wait_promise", wait_promise);
        await wait_promise;

        return {
            errors,
            exit_code: ret,
        };
    }
}
