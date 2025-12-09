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

import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, InstallProgressType, UpdateDetail, Update, ProgressData } from './packagemanager-abstract';
import * as PK from "packagekit.js";

const InstallProgressMap = {
    [PK.Enum.INFO_DOWNLOADING]: InstallProgressType.DOWNLOADING,
    [PK.Enum.INFO_UPDATING]: InstallProgressType.UPDATING,
    [PK.Enum.INFO_REMOVING]: InstallProgressType.REMOVING,
    [PK.Enum.INFO_INSTALLING]: InstallProgressType.INSTALLING,
    [PK.Enum.INFO_REINSTALLING]: InstallProgressType.REINSTALLING,
    [PK.Enum.INFO_DOWNGRADING]: InstallProgressType.DOWNGRADING,
};

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

        await PK.cancellableTransaction("Resolve",
                                        [PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST, pkgnames],
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
            if (!installed_names.has(name) && data.missing_names.indexOf(name) == -1)
                data.unavailable_names.push(name);
        });

        if (data.missing_ids.length > 0 && data.unavailable_names.length === 0) {
            await PK.cancellableTransaction("InstallPackages",
                                            [PK.Enum.TRANSACTION_FLAG_SIMULATE, data.missing_ids],
                                            progress_cb,
                                            {
                                                Package: (info: number, package_id: string) => {
                                                    const name = package_id.split(";")[0];
                                                    if (info == PK.Enum.INFO_REMOVING) {
                                                        data.remove_names.push(name);
                                                    } else if (info == PK.Enum.INFO_INSTALLING ||
                                                             info == PK.Enum.INFO_UPDATING) {
                                                        install_ids.push(package_id);
                                                        if (data.missing_names.indexOf(name) == -1)
                                                            data.extra_names.push(name);
                                                    }
                                                }
                                            });
            data.missing_names.sort();
            data.extra_names.sort();
            data.remove_names.sort();
        }

        if (install_ids.length > 0) {
            await PK.cancellableTransaction("GetDetails",
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

    async update_packages(updates: Update[] | UpdateDetail[], progress_cb?: ProgressCB, transaction_path?: string): Promise<void> {
        return PK.update_packages(updates, progress_cb, transaction_path);
    }

    async get_backend(): Promise<string> {
        const [result] = await PK.call("/org/freedesktop/PackageKit",
                                       "org.freedesktop.DBus.Properties",
                                       "Get", ["org.freedesktop.PackageKit", "BackendName"]) as [{ v: string, t: string }];
        return result.v;
    }
}
