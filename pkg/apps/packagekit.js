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

var cockpit = require("cockpit");

var client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try" });

var PK_STATUS_ENUM_WAIT = 1;
var PK_STATUS_ENUM_WAITING_FOR_LOCK = 30;

var PK_FILTER_INSTALLED     = (1 << 2);
var PK_FILTER_NOT_INSTALLED = (1 << 3);
var PK_FILTER_NEWEST        = (1 << 16);
var PK_FILTER_ARCH          = (1 << 18);
var PK_FILTER_NOT_SOURCE    = (1 << 21);

var PK_ERROR_ALREADY_INSTALLED = 9;

function transaction(method, args, progress_cb, package_cb) {
    var defer = cockpit.defer();

    client.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [ ]).
        done(function(path_result) {
            var tr = client.proxy("org.freedesktop.PackageKit.Transaction", path_result[0]);
            var cancelled = false;
            var allow_wait_status = false;

            function cancel() {
                tr.Cancel();
                cancelled = true;
            }

            function changed() {
                if (progress_cb && defer.promise().state() == "pending") {
                    var data = {
                        waiting: false,
                        percentage: 0,
                        cancel: null
                    };

                    if (allow_wait_status &&
                        (tr.Status == PK_STATUS_ENUM_WAIT || tr.Status == PK_STATUS_ENUM_WAITING_FOR_LOCK))
                        data.waiting = true;
                    if (tr.Percentage !== undefined && tr.Percentage !== 101)
                        data.percentage = tr.Percentage;
                    if (tr.AllowCancel)
                        data.cancel = cancel;

                    progress_cb(data);
                }
            }

            changed();
            tr.addEventListener("changed", changed);

            // We ignore PK_STATUS_ENUM_WAIT and friends during
            // the first second of a transaction.  They are always
            // reported briefly even when a transaction doesn't
            // really need to wait.
            window.setTimeout(function () {
                allow_wait_status = true;
                changed();
            }, 1000);

            tr.addEventListener("ErrorCode", function (event, code, details) {
                defer.reject(details, cancelled ? "cancelled" : code);
            });
            tr.addEventListener("Package", function (event, info, package_id, summary) {
                if (package_cb && defer.promise().state() == "pending")
                    package_cb(info, package_id, summary);
            });
            tr.addEventListener("Finished", function (event, exit, runtime) {
                defer.resolve(exit);
            });
            tr.call(method, args).fail(function (error) {
                console.log("Error", error);
                defer.reject(error, null);
            });
        }).
        fail(function (error) {
            defer.reject(error, null);
        });

    return defer.promise();
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
    var defer = cockpit.defer();
    var ids = [ ];

    function gather_package_cb(info, package_id) {
        ids.push(package_id);
    }

    transaction(method, [ filter, names ], progress_cb, gather_package_cb).
        done(function () {
            defer.resolve(ids);
        }).
        fail(function (error) {
            defer.reject(error, null);
        });

    return defer.promise();
}

function resolve(method, filter, name, progress_cb) {
    return resolve_many(method, filter, [ name ], progress_cb).
        then(function (ids) {
            if (ids.length === 0)
                return cockpit.reject("Can't resolve package", "not-found");
            else
                return ids[0];
        });
}

function reload_bridge_packages() {
    return cockpit.dbus(null, { bus: "internal" }).call("/packages", "cockpit.Packages", "Reload", [ ]);
}

function install(name, progress_cb) {
    return resolve("Resolve", PK_FILTER_ARCH | PK_FILTER_NOT_SOURCE | PK_FILTER_NEWEST, name,
                   progress_reporter(0, 1, progress_cb)).
        then(function (pkgid) {
            return transaction("InstallPackages", [ 0, [ pkgid ] ], progress_reporter(1, 99, progress_cb)).
                then(reload_bridge_packages);
        });
}

function remove(name, progress_cb) {
    return resolve("SearchFiles", PK_FILTER_INSTALLED, name, progress_reporter(0, 1, progress_cb)).
        then(function (pkgid) {
            return transaction("RemovePackages", [ 0, [ pkgid ], true, false ], progress_reporter(1, 99, progress_cb)).
                then(reload_bridge_packages);
        });
}

function refresh(origin_files, collection_packages, progress_cb) {
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
     * Also, we have an explicit list of packages with collection
     * metadata, and we make sure that they are installed.  This
     * allows us to install them on demand when the user actually uses
     * the Applications tool, and not always.
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
        return transaction("SearchFiles", [ PK_FILTER_INSTALLED, origin_files ],
                           progress_reporter(0, 5, progress_cb), gather_origin_cb);
    }

    function refresh_cache() {
        return transaction("RefreshCache", [ true ],
                           progress_reporter(5, 70, progress_cb));
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

    function ensure_collection_packages() {
        if (collection_packages.length > 0) {
            return resolve_many("Resolve",
                                PK_FILTER_ARCH | PK_FILTER_NOT_SOURCE | PK_FILTER_NEWEST | PK_FILTER_NOT_INSTALLED,
                                collection_packages, progress_reporter(95, 1, progress_cb)).
                then(function (ids) {
                    if (ids.length > 0) {
                        return transaction("InstallPackages", [ 0, ids ], progress_reporter(96, 4, progress_cb)).
                            catch(function (error, code) {
                                if (code != PK_ERROR_ALREADY_INSTALLED)
                                    return cockpit.reject(error, code);
                            });
                    }
                });
        }
    }

    return search_origin_file_packages().
        then(refresh_cache).
        then(maybe_update_origin_file_packages).
        then(ensure_collection_packages);
}

module.exports = {
    install: install,
    remove: remove,
    refresh: refresh
};
