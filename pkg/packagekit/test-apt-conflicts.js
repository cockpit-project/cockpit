/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import QUnit from "qunit-tests";
import { parseAptConflictPackages } from "./apt-conflicts.js";

QUnit.test("parses Breaks from the Raspberry Pi pcmanfm error", function (assert) {
    const messages = [
        "The following packages have unmet dependencies:\n  pcmanfm-pi: Breaks: pcmanfm but 1.4.0-1+rpt9 is to be installed"
    ];
    assert.deepEqual(parseAptConflictPackages(messages), ["pcmanfm-pi"]);
});

QUnit.test("parses Replaces and Conflicts and keeps unique names", function (assert) {
    const text = [
        "foo-new: Replaces: foo-old",
        "bar: Conflicts: bar-legacy",
        "foo-new: Breaks: foo-old",
    ].join("\n");
    assert.deepEqual(parseAptConflictPackages([text]).sort(), ["bar", "foo-new"]);
});

QUnit.test("reads detail/message from error objects", function (assert) {
    assert.deepEqual(
        parseAptConflictPackages([{ detail: "libfoo2: Breaks: libfoo1" }]),
        ["libfoo2"]);
    assert.deepEqual(
        parseAptConflictPackages([{ message: "pkg+ext: Replaces: pkg" }]),
        ["pkg+ext"]);
});

QUnit.test("ignores unrelated errors", function (assert) {
    assert.deepEqual(parseAptConflictPackages([]), []);
    assert.deepEqual(parseAptConflictPackages(["Applying updates failed"]), []);
    assert.deepEqual(parseAptConflictPackages([null, undefined]), []);
});

QUnit.start();
