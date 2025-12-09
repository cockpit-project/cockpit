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

export interface ProgressData {
    // PackageManager waits on a lock or another operation to finish
    waiting: boolean
    // If not null, the operation can be cancelled
    cancel: (() => void) | null
    // Transaction percentage
    percentage: number
}

export type ProgressCB = (data: ProgressData) => void;
export interface InstallProgressData extends ProgressData {
    // One of the Enum states
    info: number
    // Package being downloaded or installed
    package: string
}

export type InstallProgressCB = (data: InstallProgressData) => void;

export interface MissingPackages {
    // Packages that were requested, are currently not installed, and can be installed
    missing_names: string[]
    // The full package IDs corresponding to missing_names (the ID format is backend specific)
    missing_ids: string[]
    // Packages that were requested, are currently not installed, but can't be found in any repository
    unavailable_names: string[]

    // If unavailable_names is empty, a simulated installation of the missing packages
    // is done and the result also contains these fields:

    // Packages that need to be installed as dependencies of missing_names
    extra_names: string[]
    // Packages that need to be removed
    remove_names: string[]
    // Bytes that need to be downloaded
    download_size: number
}

export enum InstallProgressType {
    DOWNLOADING,
    UPDATING,
    INSTALLING,
    REMOVING,
    REINSTALLING,
    DOWNGRADING,
}

export enum Severity {
    NONE,
    LOW,
    MODERATE,
    IMPORTANT,
    CRITICAL,
}

export interface Update {
    id: string
    name: string
    version: string
    arch: string
}

export interface UpdateDetail extends Update {
  severity: Severity
  description: string
  markdown: boolean
  bug_urls: string[]
  cve_urls: string[]
  vendor_urls: string[]
}

export interface PackageManager {
  name: string
  check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages>;
  install_missing_packages(data: MissingPackages, progress_cb?: InstallProgressCB): Promise<void>;
  refresh(force: boolean, progress_cb?: ProgressCB): Promise<void>;
  is_installed(pkgnames: string[]): Promise<boolean>;
  install_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void>;
  remove_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<void>;
  find_file_packages(files: string[], progress_cb?: ProgressCB): Promise<string[]>;
  get_updates<T extends boolean>(detail: T, progress_cb?: ProgressCB): Promise<T extends true ? UpdateDetail[] : Update[]>;
  update_packages(updates: Update[] | UpdateDetail[], progress_cb?: ProgressCB, transaction_path?: string): Promise<void>;
  get_backend(): Promise<string>;
  get_last_refresh_time(): Promise<number>;
}

export class UnsupportedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsupportedError";
    }
}

export class NotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NotFoundError";
    }
}

export class ResolveError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResolveError";
    }
}
