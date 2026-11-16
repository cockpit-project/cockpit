/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import QUnit from "qunit-tests";

import { nevraToPackage } from "_internal/dnf5daemon";
import { packageIdToPackage } from "_internal/packagekit";
import type { Package } from "_internal/packagemanager-abstract";

QUnit.test("nevraToPackage", function (assert) {
    const checks: [string, Package | null][] = [
        // dnf5daemon signals use the full NEVRA, which always includes the epoch
        ["vanilla-0:1.0-2.noarch",
            { name: "vanilla", epoch: "0", version: "1.0", release: "2", arch: "noarch" }],
        ["kernel-core-0:7.3.0-0.rc7.58.fc46.x86_64",
            { name: "kernel-core", epoch: "0", version: "7.3.0", release: "0.rc7.58.fc46", arch: "x86_64" }],
        // non-zero epoch, and a name containing dashes
        ["perl-Foo-Bar-2:1.2-3.fc44.noarch",
            { name: "perl-Foo-Bar", epoch: "2", version: "1.2", release: "3.fc44", arch: "noarch" }],
        // NEVRA without an epoch
        ["glibc-2.40-1.fc41.i686",
            { name: "glibc", epoch: "0", version: "2.40", release: "1.fc41", arch: "i686" }],
        // not a NEVRA, e.g. a repository download description
        ["updates-testing", null],
        ["", null],
    ];

    for (const [nevra, expected] of checks)
        assert.deepEqual(nevraToPackage(nevra), expected, `nevraToPackage("${nevra}")`);
});

QUnit.test("packageIdToPackage", function (assert) {
    const checks: [string, Package][] = [
        // rpm: PackageKit's dnf5 backend omits a zero epoch
        ["vanilla;1.0-2;noarch;updates",
            { name: "vanilla", epoch: "0", version: "1.0", release: "2", arch: "noarch" }],
        ["perl-Foo-Bar;2:1.2-3.fc44;noarch;installed:fedora",
            { name: "perl-Foo-Bar", epoch: "2", version: "1.2", release: "3.fc44", arch: "noarch" }],
        // an explicit zero epoch
        ["vanilla;0:1.0-2;noarch;updates",
            { name: "vanilla", epoch: "0", version: "1.0", release: "2", arch: "noarch" }],
        // Debian: epoch and revision
        ["bash;1:5.2-1ubuntu1;amd64;jammy",
            { name: "bash", epoch: "1", version: "5.2", release: "1ubuntu1", arch: "amd64" }],
        // Debian: hyphens in upstream_version, split at the last hyphen
        ["foo;1.0-beta-3;amd64;unstable",
            { name: "foo", epoch: "0", version: "1.0-beta", release: "3", arch: "amd64" }],
        // Debian native package without a revision
        ["base-files;13build1;amd64;",
            { name: "base-files", epoch: "0", version: "13build1", release: "", arch: "amd64" }],
        // missing data field
        ["vanilla;1.0-2;noarch",
            { name: "vanilla", epoch: "0", version: "1.0", release: "2", arch: "noarch" }],
    ];

    for (const [packageId, expected] of checks)
        assert.deepEqual(packageIdToPackage(packageId), expected, `packageIdToPackage("${packageId}")`);
});

QUnit.start();
