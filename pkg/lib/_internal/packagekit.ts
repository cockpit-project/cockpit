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

import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB, InstallProgressType, InstallProgressData } from './packagemanager-abstract';
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

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        return PK.check_missing_packages(pkgnames, progress_cb);
    }

    async install_missing_packages(data: MissingPackages, progress_cb?: InstallProgressCB): Promise<void> {
        // Maps PackageKit state to our own PackageManager state temporary
        // until all pkg/lib/packagekit use cases are supported by the PackageManager abstraction.
        function convert_progress_cb(data: InstallProgressData) {
            data.info = InstallProgressMap[data.info];
            if (progress_cb)
                progress_cb(data);
        }

        return PK.install_missing_packages(data, convert_progress_cb);
    }
}
