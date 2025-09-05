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

import { InstallProgressCB, MissingPackages, PackageManager, ProgressCB } from './packagemanager-abstract';
import * as PK from "packagekit.js";

export class PackageKitManager implements PackageManager {
    name: string;

    constructor() {
        this.name = "packagekit";
    }

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        return PK.check_missing_packages(pkgnames, progress_cb);
    }

    async install_missing_packages(data: MissingPackages, progress_cb?: InstallProgressCB): Promise<void> {
        return PK.install_missing_packages(data, progress_cb);
    }
}
