/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { JsonObject } from 'cockpit';

import { collect_overview_health_pages } from 'overview-health';

import QUnit from 'qunit-tests';

type Manifests = { [pkg: string]: JsonObject | undefined };

QUnit.test("undefined manifests", function(assert) {
    assert.deepEqual(collect_overview_health_pages(undefined), []);
});

QUnit.test("null manifests", function(assert) {
    assert.deepEqual(collect_overview_health_pages(null), []);
});

QUnit.test("empty manifests", function(assert) {
    assert.deepEqual(collect_overview_health_pages({}), []);
});

QUnit.test("single manifest with one page", function(assert) {
    const m: Manifests = {
        foo: { "overview-health": ["foo/bar"] }
    };
    assert.deepEqual(collect_overview_health_pages(m), ["foo/bar"]);
});

QUnit.test("sorted output regardless of iteration order", function(assert) {
    const m: Manifests = {
        zebra: { "overview-health": ["zebra/z"] },
        apple: { "overview-health": ["apple/a"] }
    };
    assert.deepEqual(
        collect_overview_health_pages(m),
        ["apple/a", "zebra/z"]
    );
});

QUnit.test("manifest without the field is skipped", function(assert) {
    const m: Manifests = {
        foo: { "overview-health": ["foo/bar"] },
        quiet: { menu: { index: { label: "Quiet" } } }
    };
    assert.deepEqual(collect_overview_health_pages(m), ["foo/bar"]);
});

QUnit.test("non-array overview-health values are ignored", function(assert) {
    const m: Manifests = {
        a: { "overview-health": "not-an-array" },
        b: { "overview-health": 42 },
        c: { "overview-health": null },
        d: { "overview-health": { nope: true } },
        e: { "overview-health": ["kept"] }
    };
    assert.deepEqual(collect_overview_health_pages(m), ["kept"]);
});

QUnit.test("non-string array elements are filtered out", function(assert) {
    const m: Manifests = {
        a: { "overview-health": [1, "kept1", null, { k: 1 }, "kept2", true] }
    };
    assert.deepEqual(collect_overview_health_pages(m), ["kept1", "kept2"]);
});

QUnit.test("duplicate page keys across manifests are deduped", function(assert) {
    const m: Manifests = {
        one: { "overview-health": ["shared", "one-only"] },
        two: { "overview-health": ["shared", "two-only"] }
    };
    assert.deepEqual(
        collect_overview_health_pages(m),
        ["one-only", "shared", "two-only"]
    );
});

QUnit.test("realistic cockpit fixture", function(assert) {
    const m: Manifests = {
        system: {
            name: "system",
            "overview-health": ["system/services"]
        },
        updates: {
            name: "updates",
            "overview-health": ["updates"]
        },
        shell: { name: "shell" }
    };
    assert.deepEqual(
        collect_overview_health_pages(m),
        ["system/services", "updates"]
    );
});

QUnit.start();
