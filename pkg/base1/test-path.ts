/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { dirname, basename } from "cockpit-path";
import QUnit from "qunit-tests";

QUnit.test("dirname", function (assert) {
    const checks = [
        ["foo", "."],
        ["/", "/"],
        ["foo/bar", "foo"],
        ["/foo", "/"],
        ["foo///", "."],
        ["/foo///", "/"],
        ["////", "/"],
        ["//foo///", "/"],
        ["///foo///bar///", "///foo"],
        ["/foo/../", "/foo"],
        ["/home/admin/../user/", "/home/admin/.."],
        ["/../../user/", "/../.."],
        ["/home/admin/../../../", "/home/admin/../.."],
    ];

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.strictEqual(dirname(checks[i][0]), checks[i][1],
                           "dirname(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.test("basename", function (assert) {
    const checks = [
        ["foo", "foo"],
        ["bar/foo/", "foo"],
        ["//bar//foo///", "foo"],
        ["/home/admin/", "admin"],
        ["/home/", "home"],
        ["/home", "home"],
        ["/", "/"],
    ];

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.strictEqual(basename(checks[i][0]), checks[i][1],
                           "basename(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.start();
