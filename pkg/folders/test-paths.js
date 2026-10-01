/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import QUnit from "qunit-tests";
import {
    extension, fileName, formatMode, formatOwner, joinPath, pathSegments, resolveUserPath
} from "./paths.js";

QUnit.test("joinPath", function (assert) {
    assert.strictEqual(joinPath("/", "home"), "/home");
    assert.strictEqual(joinPath("/home/admin", "docs"), "/home/admin/docs");
});

QUnit.test("fileName", function (assert) {
    assert.strictEqual(fileName("/home/admin/readme.txt"), "readme.txt");
    assert.strictEqual(fileName("/"), "/");
    assert.strictEqual(fileName("/tmp/"), "tmp");
});

QUnit.test("extension", function (assert) {
    assert.strictEqual(extension("/a/photo.PNG"), "png");
    assert.strictEqual(extension("/a/.bashrc"), "");
    assert.strictEqual(extension("/a/Makefile"), "");
    assert.strictEqual(extension("/a/archive.tar.gz"), "gz");
});

QUnit.test("formatMode", function (assert) {
    assert.strictEqual(formatMode(undefined), "—");
    assert.strictEqual(formatMode(0o644), "0644");
    assert.strictEqual(formatMode(0o100755), "0755");
});

QUnit.test("formatOwner", function (assert) {
    assert.strictEqual(formatOwner({ user: "admin", group: "admin" }), "admin:admin");
    assert.strictEqual(formatOwner({}), "?:?");
});

QUnit.test("pathSegments", function (assert) {
    assert.deepEqual(pathSegments("/"), [{ name: "/", path: "/" }]);
    assert.deepEqual(pathSegments("/home/admin"), [
        { name: "/", path: "/" },
        { name: "home", path: "/home" },
        { name: "admin", path: "/home/admin" },
    ]);
});

QUnit.test("resolveUserPath", function (assert) {
    const home = "/home/admin";
    assert.deepEqual(resolveUserPath("  ", home), { empty: true });
    assert.deepEqual(resolveUserPath("~", home), { path: "/home/admin" });
    assert.deepEqual(resolveUserPath("~/docs", home), { path: "/home/admin/docs" });
    assert.deepEqual(resolveUserPath("/tmp//foo/", home), { path: "/tmp/foo" });
    assert.deepEqual(resolveUserPath("relative", home), { error: "relative" });
});

QUnit.start();
