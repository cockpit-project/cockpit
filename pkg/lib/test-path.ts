/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

import { dirname, basename } from "./cockpit-path";
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
    ];

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.strictEqual(basename(checks[i][0]), checks[i][1],
                           "basename(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.start();
