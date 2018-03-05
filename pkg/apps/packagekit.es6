/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import * as PK from "packagekit.es6";

function transaction(method, args, progress_cb, package_cb) {
    return new Promise((resolve, reject) => {
        let cancelled = false;
        let status;
        let allow_wait_status = false;
        let progress_data = {
            waiting: false,
            percentage: 0,
            cancel: null
        };

        function changed(props, transaction_path) { // notify handler
            function cancel() {
                PK.dbus_client.call(transaction_path, PK.transactionInterface, "Cancel", []);
                cancelled = true;
            }

            if (progress_cb) {
                if ("Status" in props)
                    status = props.Status;
                progress_data.waiting = allow_wait_status && (status === PK.Enum.STATUS_WAIT || status === PK.Enum.STATUS_WAITING_FOR_LOCK);
                if ("Percentage" in props && props.Percentage <= 100)
                    progress_data.percentage = props.Percentage;
                if ("AllowCancel" in props)
                    progress_data.cancel = props.AllowCancel ? cancel : null;

                progress_cb(progress_data);
            }
        }

        // We ignore PK.Enum.STATUS_WAIT and friends during
        // the first second of a transaction.  They are always
        // reported briefly even when a transaction doesn't
        // really need to wait.
        window.setTimeout(() => {
            allow_wait_status = true;
            changed({});
        }, 1000);

        PK.transaction(method, args,
            {
                // avoid calling progress_cb after ending the transaction, to avoid flickering cancel buttons
                ErrorCode: (code, detail) => {
                    progress_cb = null;
                    reject({ detail, code: cancelled ? "cancelled" : code });
                },

                Finished: (exit, runtime) => {
                    progress_cb = null;
                    resolve(exit);
                },

                Package: (info, package_id, summary) => {
                    if (package_cb)
                        package_cb(info, package_id, summary);
                },

            },
            changed).
            catch(reject);
    });
}

function progress_reporter(base, range, callback) {
    if (callback) {
        return function (data) {
            if (data.percentage >= 0)
                data.percentage = base + data.percentage/100*range;
            callback(data);
        };
    }
}

function resolve_many(method, filter, names, progress_cb) {
    var ids = [ ];

    return transaction(method, [ filter, names ], progress_cb,
                       (info, package_id) => ids.push(package_id)).
        then(() => ids);
}

function resolve(method, filter, name, progress_cb) {
    return resolve_many(method, filter, [ name ], progress_cb).
        then(function (ids) {
            if (ids.length === 0)
                return Promise.reject({ detail: "Can't resolve package", code: "not-found" });
            else
                return ids[0];
        });
}

function reload_bridge_packages() {
    return new Promise((resolve, reject) =>
        cockpit.dbus(null, { bus: "internal" }).call("/packages", "cockpit.Packages", "Reload", [ ]).then(resolve, reject)
    );
}

function install(name, progress_cb) {
    return resolve("Resolve", PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST, name,
                   progress_reporter(0, 1, progress_cb)).
        then(function (pkgid) {
            return transaction("InstallPackages", [ 0, [ pkgid ] ], progress_reporter(1, 99, progress_cb)).
                then(reload_bridge_packages);
        });
}

function remove(name, progress_cb) {
    return resolve("SearchFiles", PK.Enum.FILTER_INSTALLED, name, progress_reporter(0, 1, progress_cb)).
        then(function (pkgid) {
            return transaction("RemovePackages", [ 0, [ pkgid ], true, false ], progress_reporter(1, 99, progress_cb)).
                then(reload_bridge_packages);
        });
}

function refresh(origin_files, config_packages, data_packages, progress_cb) {
    var origin_pkgs = { };
    var update_ids = [ ];

    /* In addition to refreshing the repository metadata, we also
     * update all packages that contain AppStream collection metadata.
     *
     * AppStream collection metadata is arguably part of the
     * repository metadata and should be updated during a regular
     * refresh of the repositories.  On some distributions this is
     * what happens, but on others (such as Fedora), the collection
     * metadata is delivered in packages.  We find them and update
     * them explicitly.
     *
     * Also, we have two explicit lists of packages, and we make sure
     * that they are installed.  The first list contains packages that
     * configure the system to retrieve AppStream data as part of
     * repository metadata, and the second list contains packages that
     * contain AppStream data themselves.
     */

    function gather_origin_cb(info, package_id) {
        var pkg = package_id.split(";")[0];
        origin_pkgs[pkg] = true;
    }

    function gather_update_cb(info, package_id) {
        var pkg = package_id.split(";")[0];
        if (pkg in origin_pkgs)
            update_ids.push(package_id);
    }

    function search_origin_file_packages() {
        return transaction("SearchFiles", [ PK.Enum.FILTER_INSTALLED, origin_files ],
                           progress_reporter(5, 1, progress_cb), gather_origin_cb);
    }

    function refresh_cache() {
        return transaction("RefreshCache", [ true ],
                           progress_reporter(6, 69, progress_cb));
    }

    function maybe_update_origin_file_packages() {
        return transaction("GetUpdates", [ 0 ],
                           progress_reporter(75, 5, progress_cb), gather_update_cb).
            then(function () {
                if (update_ids.length > 0)
                    return transaction("UpdatePackages", [ 0, update_ids ],
                                       progress_reporter(80, 15, progress_cb));
            });
    }

    function ensure_packages(pkgs, start_progress) {
        if (pkgs.length > 0) {
            return resolve_many("Resolve",
                                PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST | PK.Enum.FILTER_NOT_INSTALLED,
                                pkgs, progress_reporter(start_progress, 1, progress_cb)).
                then(function (ids) {
                    if (ids.length > 0) {
                        return transaction("InstallPackages", [ 0, ids ],
                                           progress_reporter(start_progress + 1, 4, progress_cb)).
                            catch(ex => {
                                if (ex.code != PK.Enum.ERROR_ALREADY_INSTALLED)
                                    return Promise.reject(ex);
                            });
                    }
                });
        } else {
            return Promise.resolve();
        }
    }

    return ensure_packages(config_packages, 0).
        then(search_origin_file_packages).
        then(refresh_cache).
        then(maybe_update_origin_file_packages).
        then(() => ensure_packages(data_packages, 95));
}

module.exports = {
    install: install,
    remove: remove,
    refresh: refresh
};
