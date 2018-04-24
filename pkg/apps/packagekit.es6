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

function progress_reporter(base, range, callback) {
    if (callback) {
        return function (data) {
            if (data.percentage >= 0)
                data.percentage = base + data.percentage / 100 * range;
            callback(data);
        };
    }
}

function resolve_many(method, filter, names, progress_cb) {
    var ids = [ ];

    return PK.cancellableTransaction(method, [ filter, names ], progress_cb,
                                     {
                                         Package: (info, package_id) => ids.push(package_id),
                                     })
            .then(() => ids);
}

function resolve(method, filter, name, progress_cb) {
    return resolve_many(method, filter, [ name ], progress_cb)
            .then(function (ids) {
                if (ids.length === 0)
                    return Promise.reject({ detail: "Can't resolve package", code: "not-found" });
                else
                    return ids[0];
            });
}

function reload_bridge_packages() {
    return cockpit.dbus(null, { bus: "internal" }).call("/packages", "cockpit.Packages", "Reload", [ ]);
}

function install(name, progress_cb) {
    return resolve("Resolve", PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST, name,
                   progress_reporter(0, 1, progress_cb))
            .then(function (pkgid) {
                return PK.cancellableTransaction("InstallPackages", [ 0, [ pkgid ] ], progress_reporter(1, 99, progress_cb))
                        .then(reload_bridge_packages);
            });
}

function remove(name, progress_cb) {
    return resolve("SearchFiles", PK.Enum.FILTER_INSTALLED, name, progress_reporter(0, 1, progress_cb))
            .then(function (pkgid) {
                return PK.cancellableTransaction("RemovePackages", [ 0, [ pkgid ], true, false ], progress_reporter(1, 99, progress_cb))
                        .then(reload_bridge_packages);
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

    function search_origin_file_packages() {
        return PK.cancellableTransaction("SearchFiles", [ PK.Enum.FILTER_INSTALLED, origin_files ],
                                         progress_reporter(5, 1, progress_cb),
                                         {
                                             Package: (info, package_id) => {
                                                 var pkg = package_id.split(";")[0];
                                                 origin_pkgs[pkg] = true;
                                             },
                                         });
    }

    function refresh_cache() {
        return PK.cancellableTransaction("RefreshCache", [ true ], progress_reporter(6, 69, progress_cb));
    }

    function maybe_update_origin_file_packages() {
        return PK.cancellableTransaction("GetUpdates", [ 0 ], progress_reporter(75, 5, progress_cb),
                                         {
                                             Package: (info, package_id) => {
                                                 let pkg = package_id.split(";")[0];
                                                 if (pkg in origin_pkgs)
                                                     update_ids.push(package_id);
                                             },
                                         })
                .then(function () {
                    if (update_ids.length > 0)
                        return PK.cancellableTransaction("UpdatePackages", [ 0, update_ids ],
                                                         progress_reporter(80, 15, progress_cb));
                });
    }

    function ensure_packages(pkgs, start_progress) {
        if (pkgs.length > 0) {
            return resolve_many("Resolve",
                                PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NOT_SOURCE | PK.Enum.FILTER_NEWEST | PK.Enum.FILTER_NOT_INSTALLED,
                                pkgs, progress_reporter(start_progress, 1, progress_cb))
                    .then(function (ids) {
                        if (ids.length > 0) {
                            return PK.cancellableTransaction("InstallPackages", [ 0, ids ],
                                                             progress_reporter(start_progress + 1, 4, progress_cb))
                                    .catch(ex => {
                                        if (ex.code != PK.Enum.ERROR_ALREADY_INSTALLED)
                                            return Promise.reject(ex);
                                    });
                        }
                    });
        } else {
            return Promise.resolve();
        }
    }

    return ensure_packages(config_packages, 0)
            .then(search_origin_file_packages)
            .then(refresh_cache)
            .then(maybe_update_origin_file_packages)
            .then(() => ensure_packages(data_packages, 95));
}

module.exports = {
    install: install,
    remove: remove,
    refresh: refresh
};
