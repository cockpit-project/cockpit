// SPDX-License-Identifier: LGPL-2.1-or-later
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import cockpit from "cockpit";
import QUnit from "qunit-tests";

import { PageStatusNotifications } from "./page-status";
import { aggregate_notification, reset_notifications } from "_internal/notifications";

const HEALTH_BOARD = "overview:health";

function render_health() {
    const container = document.createElement("div");
    const root = createRoot(container);
    flushSync(() => root.render(<PageStatusNotifications />));
    return { container, cleanup: () => flushSync(() => root.unmount()) };
}

QUnit.test("renderer drops an unsafe link, keeps the title as plain text", function (assert) {
    reset_notifications();
    aggregate_notification({
        host: cockpit.transport.host,
        page: "evil",
        board: HEALTH_BOARD,
        notification: { type: "error", title: "Hostile", link: "javascript:alert(1)" },
    });

    const { container, cleanup } = render_health();
    const li = container.querySelector("#page_status_notification_evil");
    assert.ok(li, "entry rendered");
    assert.equal(li.textContent, "Hostile", "title shown");
    assert.strictEqual(container.querySelector("a"), null, "no anchor for an unsafe link");
    cleanup();

    reset_notifications();
});

QUnit.test("renderer links a safe page path", function (assert) {
    reset_notifications();
    aggregate_notification({
        host: cockpit.transport.host,
        page: "updates",
        board: HEALTH_BOARD,
        notification: { type: "warning", title: "Updates available", link: "updates" },
    });

    const { container, cleanup } = render_health();
    const a = container.querySelector("#page_status_notification_updates a");
    assert.ok(a, "safe link renders an anchor");
    assert.equal(a.textContent, "Updates available", "anchor carries the title");
    cleanup();

    reset_notifications();
});

QUnit.test("renderer escapes a hostile title to text", function (assert) {
    reset_notifications();
    const payload = "<img src=x onerror=alert(1)>";
    aggregate_notification({
        host: cockpit.transport.host,
        page: "evil",
        board: HEALTH_BOARD,
        notification: { type: "error", title: payload },
    });

    const { container, cleanup } = render_health();
    assert.strictEqual(container.querySelector("img"), null, "title markup not parsed into a node");
    assert.equal(container.querySelector("#page_status_notification_evil").textContent, payload, "title rendered as literal text");
    cleanup();

    reset_notifications();
});

QUnit.test("renderer drops an entry without a title", function (assert) {
    reset_notifications();
    aggregate_notification({
        host: cockpit.transport.host,
        page: "silent",
        board: HEALTH_BOARD,
        notification: { type: "warning" },
    });

    const { container, cleanup } = render_health();
    assert.strictEqual(container.querySelector("#page_status_notification_silent"), null, "title-less entry not rendered");
    cleanup();

    reset_notifications();
});

QUnit.test("renderer ignores an arbitrary type as an icon name", function (assert) {
    reset_notifications();
    aggregate_notification({
        host: cockpit.transport.host,
        page: "weird",
        board: HEALTH_BOARD,
        notification: { type: "evil-class", title: "Hi" },
    });

    const { container, cleanup } = render_health();
    assert.ok(container.querySelector("#page_status_notification_weird"), "entry rendered");
    assert.strictEqual(container.querySelector("[data-pficon]"), null, "unknown type not honored as a pficon");
    cleanup();

    reset_notifications();
});

cockpit.transport.wait(QUnit.start);
