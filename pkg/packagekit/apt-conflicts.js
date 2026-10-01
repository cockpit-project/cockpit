/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* On apt-based systems (Debian, Raspberry Pi OS) some upgrades require *replacing* a
 * package: the new package declares "Breaks"/"Replaces"/"Conflicts" against an older
 * one (e.g. Raspberry Pi OS moving from "pcmanfm" to "pcmanfm-pi"). PackageKit update
 * transactions are not allowed to remove packages, so they fail with an "unmet
 * dependencies" error. Installing the replacement package with apt is allowed to remove
 * the old one, which resolves the conflict.
 *
 * Parse the failing PackageKit/apt error text and return the replacement package names
 * (the ones on the left of the "Breaks/Replaces/Conflicts:" relation) so we can offer to
 * install them directly. */
export function parseAptConflictPackages(errorMessages) {
    const packages = new Set();
    const re = /(?:^|\n)\s*([a-z0-9][a-z0-9+.-]*)\s*:\s*(?:Breaks|Replaces|Conflicts)\s*:/gi;
    for (const message of errorMessages) {
        const text = typeof message === "string"
            ? message
            : (message?.detail || message?.message || String(message ?? ""));
        let m;
        while ((m = re.exec(text)) !== null)
            packages.add(m[1]);
    }
    return Array.from(packages);
}
