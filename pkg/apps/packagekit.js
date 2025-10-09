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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import * as PK from "packagekit.js";

class ProgressReporter {
    constructor(base, range, callback) {
        this.base = base;
        this.range = range;
        this.callback = callback;
        this.progress_reporter = this.progress_reporter.bind(this);
    }

    progress_reporter(data) {
        if (data.absolute_percentage >= 0) {
            const newPercentage = this.base + data.absolute_percentage / 100 * this.range;
            // PackageKit with Apt backend reports wrong percentages https://github.com/PackageKit/PackageKit/issues/516
            // Double check here that we have an increasing only progress value
            if (this.percentage == undefined || newPercentage >= this.percentage)
                this.percentage = newPercentage;
        }
        this.callback({ percentage: this.percentage, ...data });
    }
}

function reload_bridge_packages() {
    return cockpit.dbus(null, { bus: "internal" }).call("/packages", "cockpit.Packages", "Reload", []);
}

export function install(name, progress_cb) {
    const progress = new ProgressReporter(0, 1, progress_cb);

    return PK.install_packages([name], progress.progress_reporter).then(reload_bridge_packages);
}

export function remove(name, progress_cb) {
    const progress = new ProgressReporter(0, 1, progress_cb);
    return PK.remove_packages(null, [name], progress.progress_reporter).then(reload_bridge_packages);
}

export function refresh(origin_files, config_packages, data_packages, progress_cb) {
    const origin_pkgs = { };
    const update_ids = [];

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
    const progress = new ProgressReporter(0, 1, progress_cb);

    const search_origin_file_packages = () => {
        return PK.cancellableTransaction("SearchFiles", [PK.Enum.FILTER_INSTALLED, origin_files],
                                         progress.progress_reporter,
                                         {
                                             Package: (info, package_id) => {
                                                 const pkg = package_id.split(";")[0];
                                                 origin_pkgs[pkg] = true;
                                             },
                                         });
    };

    const refresh_cache = () => {
        progress.base = 6;
        progress.range = 69;

        return PK.refresh(true, progress.progress_reporter);
    };

    const maybe_update_origin_file_packages = () => {
        progress.base = 75;
        progress.range = 5;

        return PK.cancellableTransaction("GetUpdates", [0], progress.progress_reporter,
                                         {
                                             Package: (info, package_id) => {
                                                 const pkg = package_id.split(";")[0];
                                                 if (pkg in origin_pkgs)
                                                     update_ids.push(package_id);
                                             },
                                         })
                .then(() => {
                    progress.base = 80;
                    progress.range = 15;

                    if (update_ids.length > 0)
                        return PK.update_packages(update_ids, progress.progress_reporter, null);
                });
    };

    const ensure_packages = (pkgs, start_progress) => {
        if (pkgs.length > 0) {
            progress.base = start_progress;
            progress.range = 1;

            return PK.install_packages(pkgs, progress.progress_reporter);
        } else {
            return Promise.resolve();
        }
    };

    return ensure_packages(config_packages, 0)
            .then(search_origin_file_packages)
            .then(refresh_cache)
            .then(maybe_update_origin_file_packages)
            .then(() => ensure_packages(data_packages, 95));
}
