// SPDX-License-Identifier: LGPL-2.1-or-later
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import cockpit from "cockpit";
import QUnit from "qunit-tests";

import { PageStatusNotifications } from "./page-status";
import { health_status } from "overview";
import { aggregate_notification, reset_notifications, NOTIFICATIONS_KEY } from "_internal/notifications";

let root = null;

QUnit.hooks.beforeEach(reset_notifications);
QUnit.hooks.afterEach(() => flushSync(() => root?.unmount()));

function post(page, notifications, host = cockpit.transport.host) {
    aggregate_notification({ host, page, board: health_status.name, notifications });
}

function render_health() {
    const container = document.createElement("ul");
    root = createRoot(container);
    flushSync(() => root.render(<PageStatusNotifications />));
    return container;
}

QUnit.test("renderer drops an unsafe link, keeps the title as plain text", function (assert) {
    post("evil", [{ type: "error", title: "Hostile", link: "javascript:alert(1)" }]);

    const container = render_health();
    const li = container.querySelector("#page_status_notification_evil");
    assert.ok(li, "entry rendered");
    assert.equal(li.textContent, "Hostile", "title shown");
    assert.strictEqual(container.querySelector("a"), null, "no anchor for an unsafe link");
});

QUnit.test("renderer links a safe page path and jumps to it", function (assert) {
    post("updates", [{ type: "warning", title: "Updates available", link: "updates" }]);

    const orig = cockpit.jump;
    const jumps = [];
    cockpit.jump = path => jumps.push(path);
    try {
        const container = render_health();
        const a = container.querySelector("#page_status_notification_updates a");
        assert.ok(a, "safe link renders an anchor");
        assert.equal(a.textContent, "Updates available", "anchor carries the title");
        a.click();
        assert.deepEqual(jumps, ["/updates"], "click jumps to the page path");
    } finally {
        cockpit.jump = orig;
    }
});

QUnit.test("renderer shows a span for an empty or non-string link", function (assert) {
    post("plain", [{ title: "Empty", link: "" }, { title: "Number", link: 5 }]);

    const container = render_health();
    assert.equal(container.querySelectorAll("li").length, 2, "both entries rendered");
    assert.strictEqual(container.querySelector("a"), null, "no anchors");
});

QUnit.test("renderer escapes a hostile title to text", function (assert) {
    const payload = "<img src=x onerror=alert(1)>";
    post("evil", [{ type: "error", title: payload }]);

    const container = render_health();
    assert.strictEqual(container.querySelector("img"), null, "title markup not parsed into a node");
    assert.equal(container.querySelector("#page_status_notification_evil").textContent, payload, "title rendered as literal text");
});

QUnit.test("renderer drops entries without a string title", function (assert) {
    post("silent", [{ type: "warning" }, { title: "" }, null, "text", 5, ["x"], { title: ["x"] }]);

    const container = render_health();
    assert.strictEqual(container.querySelector("li"), null, "nothing rendered");
});

QUnit.test("renderer ignores entries from other hosts", function (assert) {
    post("remote", [{ type: "info", title: "Elsewhere" }], "other-host");

    const container = render_health();
    assert.strictEqual(container.querySelector("li"), null, "other host's entry not listed");
});

QUnit.test("renderer maps type to a severity icon or an allowlisted pficon", function (assert) {
    post("icons", [
        { type: "warning", title: "Warn" },
        { type: "error", title: "Err" },
        { type: "security", title: "Sec" },
        { type: "evil-class", title: "Weird" },
    ]);

    const container = render_health();
    const items = container.querySelectorAll("li");
    assert.equal(items.length, 4, "all entries rendered");
    assert.ok(items[0].querySelector(".pf-m-warning"), "warning severity icon");
    assert.ok(items[1].querySelector(".pf-m-danger"), "error severity icon");
    assert.equal(items[2].querySelector("[data-pficon]")?.dataset.pficon, "security", "allowlisted pficon honored");
    assert.strictEqual(items[3].querySelector("[data-pficon]"), null, "unknown type not honored as a pficon");
    assert.ok(items[3].querySelector("svg"), "unknown type falls back to the info icon");
});

QUnit.test("renderer derives ids from the page, suffixing later entries", function (assert) {
    post("system/services", [{ type: "error", title: "Failed" }]);
    post("multi", [{ type: "warning", title: "First" }, { type: "info", title: "Second" }]);

    const container = render_health();
    assert.equal(container.querySelector("#page_status_notification_system_services").textContent, "Failed", "slashes become underscores");
    assert.equal(container.querySelector("#page_status_notification_multi").textContent, "First", "first entry keeps the page id");
    assert.equal(container.querySelector('[id="page_status_notification_multi:1"]').textContent, "Second", "second entry gets a suffix");
});

QUnit.test("renderer treats non-string icon types as unknown", function (assert) {
    post("malformed", [
        { type: { toString: null }, title: "Object" },
        { type: ["security"], title: "Array" },
    ]);

    const container = render_health();
    assert.deepEqual(Array.from(container.querySelectorAll("li"), item => item.textContent), ["Object", "Array"],
                     "malformed icon types preserve the health entries");
    assert.strictEqual(container.querySelector("[data-pficon]"), null, "non-string types cannot select an icon");
    assert.equal(container.querySelectorAll(".pf-m-info").length, 2, "unknown types use the info icon");
});

QUnit.test("renderer re-renders on a storage event", function (assert) {
    const container = render_health();
    assert.strictEqual(container.querySelector("li"), null, "empty at mount");

    post("late", [{ type: "info", title: "Arrived" }]);
    flushSync(() => window.dispatchEvent(new StorageEvent("storage", { key: NOTIFICATIONS_KEY })));
    assert.equal(container.querySelector("#page_status_notification_late")?.textContent, "Arrived", "entry appears after the event");
});

QUnit.test("renderer removes entries from pages with overlapping id prefixes", function (assert) {
    post("foo", [{ title: "First" }, { title: "Second" }]);
    post("foo_1", [{ title: "Other page" }]);
    post("foo/bar", [{ title: "Nested page" }]);
    post("foo_bar", [{ title: "Underscore page" }]);

    const container = render_health();
    const ids = Array.from(container.querySelectorAll("li"), item => item.id);
    assert.equal(new Set(ids).size, ids.length, "every entry has a distinct id");

    post("foo", []);
    post("foo/bar", []);
    flushSync(() => window.dispatchEvent(new StorageEvent("storage", { key: NOTIFICATIONS_KEY })));
    assert.deepEqual(Array.from(container.querySelectorAll("li"), item => item.textContent), ["Other page", "Underscore page"],
                     "cleared pages leave only the other pages' entries");

    post("foo_1", []);
    post("foo_bar", []);
    flushSync(() => window.dispatchEvent(new StorageEvent("storage", { key: NOTIFICATIONS_KEY })));
    assert.strictEqual(container.querySelector("li"), null, "clearing every page leaves no stale rows");
});

cockpit.transport.wait(QUnit.start);
