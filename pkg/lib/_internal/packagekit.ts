/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, InstallProgressType, UpdateProgressType, UpdateDetail, Update, ProgressData, History, UpdateProgressHandlers, TransactionExitStatus, UpdateError, UpdateNotify, RunningUpdate, Severity } from './packagemanager-abstract';
import * as PK from "packagekit.js";

const UpdateProgressMap: Record<number, UpdateProgressType> = {
    [PK.Enum.STATUS_DOWNLOAD]: UpdateProgressType.DOWNLOADING,
    [PK.Enum.STATUS_INSTALL]: UpdateProgressType.INSTALLING,
    [PK.Enum.STATUS_UPDATE]: UpdateProgressType.UPDATING,
    [PK.Enum.STATUS_CLEANUP]: UpdateProgressType.CLEANUP,
    [PK.Enum.STATUS_SIGCHECK]: UpdateProgressType.SIGCHECK,
};

const InstallProgressMap = {
    [PK.Enum.INFO_DOWNLOADING]: InstallProgressType.DOWNLOADING,
    [PK.Enum.INFO_UPDATING]: InstallProgressType.UPDATING,
    [PK.Enum.INFO_REMOVING]: InstallProgressType.REMOVING,
    [PK.Enum.INFO_INSTALLING]: InstallProgressType.INSTALLING,
    [PK.Enum.INFO_REINSTALLING]: InstallProgressType.REINSTALLING,
    [PK.Enum.INFO_DOWNGRADING]: InstallProgressType.DOWNGRADING,
};

function debug(...args: unknown[]) {
    if (window.debugging == 'all' || window.debugging?.includes('packagekit'))
        console.debug(...args);
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
    return PK.cancellableTransaction("GetUpdateDetail", [pkg_ids], progress_cb, {
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

        await PK.cancellableTransaction("InstallPackages", [0, data.missing_ids],
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
        return PK.cancellableTransaction("RefreshCache", [force], progress_cb);
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

    /**
     * Get Updates
     * updates = { id, name, version, arch }
     * with details
     * updates = { id, name, version, arch, severity, bug_urls, cve_urls, vendor_urls, description, markdown }
     * @param {boolean} details - fetch detailed package information (security information)
     */
    async get_updates<T extends boolean>(details: T, progress_cb?: ProgressCB): Promise<T extends true ? UpdateDetail[] : Update[]> {
        const updates: Record<string, Partial<UpdateDetail> & Update> = {};

        await PK.cancellableTransaction(
            "GetUpdates", [0],
            progress_cb,
            {
                Package: (info: number, packageId: string, summary: string) => {
                    // HACK: security updates have 0x50008 with PackageKit 1.2.8, so just consider the lower 8 bits
                    info = info & 0xff;
                    const id_fields = packageId.split(";");
                    // HACK: dnf backend yields wrong severity with PK < 1.2.4 (https://github.com/PackageKit/PackageKit/issues/268)
                    if (info < PK.Enum.INFO_LOW || info > PK.Enum.INFO_SECURITY)
                        info = PK.Enum.INFO_NORMAL;

                    if (info == PK.Enum.INFO_LOW)
                        info = Severity.LOW;
                    else if (info == PK.Enum.INFO_ENHANCEMENT)
                        info = Severity.MODERATE;
                    else if (info == PK.Enum.INFO_SECURITY)
                        info = Severity.CRITICAL;
                    else if (info >= PK.Enum.INFO_NORMAL)
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
            PK.transaction("UpdatePackages", [0, update_ids],
                           {
                               ErrorCode: (_code: string, details: string) => errorMessages.push(details),
                               Finished: (exit: number) => {
                                   if (exit === PK.Enum.EXIT_SUCCESS) {
                                       resolve(TransactionExitStatus.SUCCESS);
                                   } else if (exit === PK.Enum.EXIT_CANCELLED) {
                                       resolve(TransactionExitStatus.CANCELLED);
                                   } else {
                                       if (exit !== PK.Enum.EXIT_FAILED)
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
                                       ? () => PK.call(transactionPath!, PK.transactionInterface, "Cancel", [])
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
            [transactions] = await PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", []);
            roles = await Promise.all(transactions.map(path => PK.call(path, "org.freedesktop.DBus.Properties",
                                                                       "Get", [PK.transactionInterface, "Role"])));
        } catch (ex) {
            console.warn("GetTransactionList: failed to read PackageKit transaction roles:", String(ex));
            return null;
        }

        for (let idx = 0; idx < roles.length; ++idx) {
            const [role] = roles[idx] as [{ v: number }];

            if (role.v !== PK.Enum.ROLE_UPDATE_PACKAGES) {
                continue;
            }

            const transactionPath = transactions[idx];
            const errorMessages: string[] = [];
            const promise = new Promise<TransactionExitStatus>((resolve, reject) => {
                PK.watchTransaction(transactionPath,
                                    {
                                        ErrorCode: (_code: string, details: string) => errorMessages.push(details),
                                        Finished: (exit: number) => {
                                            if (exit === PK.Enum.EXIT_SUCCESS) {
                                                resolve(TransactionExitStatus.SUCCESS);
                                            } else if (exit === PK.Enum.EXIT_CANCELLED) {
                                                resolve(TransactionExitStatus.CANCELLED);
                                            } else {
                                                if (exit !== PK.Enum.EXIT_FAILED)
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
                                            cancel: notify.AllowCancel ? () => PK.call(transactionPath, PK.transactionInterface, "Cancel", []) : null,
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
        const [result] = await PK.call("/org/freedesktop/PackageKit",
                                       "org.freedesktop.DBus.Properties",
                                       "Get", ["org.freedesktop.PackageKit", "BackendName"]) as [{ v: string, t: string }];
        return result.v;
    }

    async get_last_refresh_time(): Promise<number> {
        const [seconds] = await PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction", [PK.Enum.ROLE_REFRESH_CACHE]);
        return seconds;
    }

    async get_history(): Promise<History[]> {
        const history = [] as History[];

        // would be nice to filter only for "update-packages" role, but can't here
        await PK.transaction("GetOldTransactions", [0], {
            Transaction: (_objPath: string, timeSpec: string, _succeeded: string, role: number, _duration: string, data: string) => {
                if (role !== PK.Enum.ROLE_UPDATE_PACKAGES)
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

        await PK.cancellableTransaction("Resolve",
                                        [PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NEWEST | PK.Enum.FILTER_NOT_INSTALLED, pkgnames],
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
