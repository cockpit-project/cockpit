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

import { ProgressReporter } from "./utils";
import { getPackageManager } from "packagemanager";

export async function refresh(origin_files, config_packages, data_packages, progress_cb) {
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
    const packagemanager = await getPackageManager();
    const progress = new ProgressReporter(0, 1, progress_cb);

    if (config_packages.length > 0) {
        progress.base = 0;
        progress.range = 5;

        await packagemanager.install_packages(config_packages, progress.progress_reporter);
    }

    const origin_pkgs = new Set(await packagemanager.find_file_packages(origin_files, progress.progress_reporter));

    progress.base = 6;
    progress.range = 69;
    await packagemanager.refresh(true, progress.progress_reporter);

    progress.base = 75;
    progress.range = 5;

    const updates = await packagemanager.get_updates(false, progress.progress_reporter);
    const filtered_updates = [];

    for (const update of updates) {
        if (origin_pkgs.has(update.name))
            filtered_updates.push(update);
    }

    progress.base = 80;
    progress.range = 15;

    if (filtered_updates.length > 0)
        return packagemanager.update_packages(filtered_updates, progress.progress_reporter, null);

    if (data_packages.length > 0) {
        progress.range = 95;
        await packagemanager.install_packages(data_packages, progress.progress_reporter);
    }
}
