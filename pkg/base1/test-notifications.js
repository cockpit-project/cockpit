// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import {
    board, NOTIFICATIONS_KEY, BOARD_KEY_RE,
    aggregate_notification, aggregate_notification_control, board_hosts, reset_notifications,
} from "_internal/notifications";
import { SAFE_LINK_RE } from "overview";
import { page_status, PAGE_STATUS_BOARD } from "shell";
import QUnit from "qunit-tests";

/** @param {object} data */
function planRegistry(data) {
    sessionStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(data));
}

function captureControl() {
    /** @type {{ command: string, options: any }[]} */
    const calls = [];
    const orig = cockpit.transport.control;
    cockpit.transport.control = (command, options) => {
        calls.push({ command, options });
    };
    return { calls, restore: () => { cockpit.transport.control = orig } };
}

QUnit.test("valid flips and changed fires after transport ready", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const b = board("test:valid");
    let fired = false;
    // The board's "changed" can fire during construction (transport already
    // ready), before this listener attaches, so also check once directly.
    const check = () => {
        if (b.valid && !fired) {
            fired = true;
            assert.true(b.valid, "valid is true after transport ready");
            assert.deepEqual(b.list(), [], "list returns [] when registry empty");
            done();
        }
    };
    b.addEventListener("changed", check);
    check();
});

QUnit.test("list reads board slice for current host", function (assert) {
    sessionStorage.removeItem(NOTIFICATIONS_KEY);
    const b = board("test:read");
    const host = cockpit.transport.host;

    planRegistry({
        "test:read": {
            [host]: {
                "page-a": { type: "info", title: "Hello" },
            },
            "other-host": {
                "page-a": { type: "warning", title: "Other" },
            },
        },
        "test:other": {
            [host]: {
                "page-b": { type: "info", title: "Wrong board" },
            },
        },
    });

    const list = b.list();
    assert.equal(list.length, 1, "one entry for current host on this board");
    assert.equal(list[0].title, "Hello", "got the right entry");
    assert.equal(list[0].publisher, "page-a", "publisher is the posting page");

    assert.equal(b.list("other-host").length, 1, "host scoping: explicit host returns its slice");
    assert.equal(b.list("nonexistent-host").length, 0, "unknown host returns empty");

    assert.equal(board("test:other").list().length, 1, "other board returns its own slice");
});

QUnit.test("list returns [] when sessionStorage holds malformed JSON", function (assert) {
    const b = board("test:malformed");
    sessionStorage.setItem(NOTIFICATIONS_KEY, "{not valid json");
    assert.deepEqual(b.list(), [], "JSON.parse failure swallowed, empty list");
    sessionStorage.removeItem(NOTIFICATIONS_KEY);
});

QUnit.test("changed event fires only for the registry key", function (assert) {
    const b = board("test:storage-event");

    let fired = 0;
    const handler = () => { fired++ };
    b.addEventListener("changed", handler);

    window.dispatchEvent(new StorageEvent("storage", { key: "cockpit:page_status" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    window.dispatchEvent(new StorageEvent("storage", { key: NOTIFICATIONS_KEY }));

    b.removeEventListener("changed", handler);
    assert.equal(fired, 1, "only the notifications key fires changed");
});

QUnit.test("publish sends control message with expected shape", function (assert) {
    const b = board("test:publish");
    const cap = captureControl();

    b.publish({ type: "warning", title: "Hi", link: "x" });

    assert.equal(cap.calls.length, 1, "one control message sent");
    assert.equal(cap.calls[0].command, "notify", "command is notify");
    assert.equal(cap.calls[0].options.board, "test:publish", "board name in payload");
    assert.equal(cap.calls[0].options.notification.title, "Hi", "title preserved");
    assert.equal(cap.calls[0].options.notification.type, "warning", "type preserved");
    assert.equal(cap.calls[0].options.notification.link, "x", "link preserved");

    cap.restore();
});

QUnit.test("page_status.publish sends legacy and board payloads", function (assert) {
    page_status.publish(null);
    const cap = captureControl();

    try {
        page_status.publish({ type: "warning" });

        assert.equal(cap.calls.length, 1, "one control message sent");
        assert.equal(cap.calls[0].command, "notify", "command is notify");
        assert.deepEqual(cap.calls[0].options.page_status, { type: "warning" }, "legacy payload preserved");
        assert.equal(cap.calls[0].options.board, PAGE_STATUS_BOARD, "board name in payload");
        assert.deepEqual(cap.calls[0].options.notification, { type: "warning" }, "board payload preserved");
    } finally {
        page_status.publish(null);
        cap.restore();
    }
});

QUnit.test("publish dedups identical payload", function (assert) {
    const b = board("test:dedup");
    const cap = captureControl();

    b.publish({ type: "info", title: "Same" });
    b.publish({ type: "info", title: "Same" });
    assert.equal(cap.calls.length, 1, "second publish skipped via dequal");

    b.publish({ type: "info", title: "Different" });
    assert.equal(cap.calls.length, 2, "different title broadcasts");

    cap.restore();
});

QUnit.test("clear sends control message with notification:null", function (assert) {
    const b = board("test:clear");
    const cap = captureControl();

    b.publish({ type: "info", title: "T" });
    assert.equal(cap.calls.length, 1, "publish first");

    b.clear();
    assert.equal(cap.calls.length, 2, "clear sent");
    assert.equal(cap.calls[1].options.board, "test:clear", "clear targets the board");
    assert.strictEqual(cap.calls[1].options.notification, null, "notification is null on clear");

    b.clear();
    assert.equal(cap.calls.length, 2, "second clear deduped");

    cap.restore();
});

QUnit.test("clear from a fresh instance still sends (stale entry after reload)", function (assert) {
    const b = board("test:clear-fresh");
    const cap = captureControl();

    b.clear();
    assert.equal(cap.calls.length, 1, "first clear sends even without a prior publish");
    assert.strictEqual(cap.calls[0].options.notification, null, "notification is null");

    b.clear();
    assert.equal(cap.calls.length, 1, "second clear deduped");

    cap.restore();
});

QUnit.test("board() is memoized", function (assert) {
    const a = board("test:memo");
    const b = board("test:memo");
    assert.strictEqual(a, b, "same instance for same name");
    assert.notStrictEqual(board("test:memo-other"), a, "different name yields different instance");
});

QUnit.test("board() warns on a name that fails BOARD_KEY_RE", function (assert) {
    const orig = console.warn;
    let warned = "";
    console.warn = msg => { warned = String(msg) };
    try {
        const b = board("bad name");
        assert.ok(b, "still returns a board instance for an invalid name");
        assert.ok(warned.includes("bad name"), "warns that the Shell will drop posts to it");
    } finally {
        console.warn = orig;
    }
});

QUnit.test("BOARD_KEY_RE accepts board names, rejects hostile input", function (assert) {
    // "__proto__" matches the pattern; the null-prototype registry is the
    // actual defense (see the aggregate_notification inertness test below).
    for (const ok of ["overview:health", "shell:page-status", "playground:demo", "a/b", "A_b.c-1", "__proto__"])
        assert.true(BOARD_KEY_RE.test(ok), `accepts ${ok}`);
    for (const bad of ["", "a b", "a<b", "a;b", "a\nb", "x".repeat(129)])
        assert.false(BOARD_KEY_RE.test(bad), `rejects ${JSON.stringify(bad)}`);
});

QUnit.test("SAFE_LINK_RE accepts page paths, rejects cross-host and traversal", function (assert) {
    for (const ok of ["updates", "system/services"])
        assert.true(SAFE_LINK_RE.test(ok), `accepts ${ok}`);
    for (const bad of ["@host", "/system/log", "../x", "a/../b", "http://x", "javascript:alert(1)", "a b", "a?b", "//x"])
        assert.false(SAFE_LINK_RE.test(bad), `rejects ${bad}`);
});

QUnit.test("aggregate_notification stores, reads back via board_hosts, and clears", function (assert) {
    reset_notifications();

    assert.true(aggregate_notification({ host: "h1", page: "p1", board: "test:agg", notification: { type: "info", title: "Hi" } }),
                "valid post accepted");
    assert.deepEqual(board_hosts("test:agg").h1.p1, { type: "info", title: "Hi" }, "stored under host/page");
    assert.deepEqual(board_hosts("test:agg").h2, undefined, "other host empty");

    assert.true(aggregate_notification({ host: "h1", page: "p1", board: "test:agg", notification: null }),
                "clear accepted");
    assert.strictEqual(board_hosts("test:agg").h1.p1, undefined, "entry gone after clear");

    reset_notifications();
    assert.deepEqual(board_hosts("test:agg"), { }, "reset empties the board");
});

QUnit.test("aggregate_notification accepts title-less legacy status", function (assert) {
    reset_notifications();

    assert.true(aggregate_notification({ host: "h", page: "p", board: PAGE_STATUS_BOARD, notification: { type: "warning" } }),
                "title-less page status accepted");
    assert.deepEqual(board_hosts(PAGE_STATUS_BOARD).h.p, { type: "warning" }, "title-less status stored");

    reset_notifications();
});

QUnit.test("aggregate_notification_control routes board and legacy posts", function (assert) {
    reset_notifications();

    assert.true(aggregate_notification_control({
        host: "h",
        page: "p",
        page_status_board: PAGE_STATUS_BOARD,
        data: { board: "test:route", notification: { title: "Board" }, page_status: { type: "warning" } },
    }), "board post accepted");
    assert.deepEqual(board_hosts("test:route").h.p, { title: "Board" }, "board post stored");
    assert.deepEqual(board_hosts(PAGE_STATUS_BOARD), { }, "legacy field ignored when board is present");

    assert.true(aggregate_notification_control({
        host: "h",
        page: "legacy",
        page_status_board: PAGE_STATUS_BOARD,
        data: { page_status: { type: "warning" } },
    }), "legacy post accepted");
    assert.deepEqual(board_hosts(PAGE_STATUS_BOARD).h.legacy, { type: "warning" }, "legacy post stored");

    assert.false(aggregate_notification_control({
        host: "h",
        page: "bad",
        page_status_board: PAGE_STATUS_BOARD,
        data: { board: "test:route" },
    }), "missing board notification is ignored");

    reset_notifications();
});

QUnit.test("aggregate_notification rejects invalid posts", function (assert) {
    reset_notifications();

    const bad_title = /** @type {any} */ ({ title: 5 });
    const array_payload = /** @type {any} */ (Object.assign([], { title: "x" }));
    assert.false(aggregate_notification({ host: "h", page: "p", board: "bad name", notification: { title: "x" } }),
                 "board name failing BOARD_KEY_RE rejected");
    assert.false(aggregate_notification({ host: "h", page: "p", board: "test:rej", notification: bad_title }),
                 "non-string title rejected");
    assert.false(aggregate_notification({ host: "h", page: "p", board: "test:rej", notification: array_payload }),
                 "array carrying a title own-prop rejected");
    assert.deepEqual(board_hosts("test:rej"), { }, "nothing stored from rejected posts");

    reset_notifications();
});

QUnit.test("aggregate_notification clear of an unposted page returns false", function (assert) {
    reset_notifications();

    assert.false(aggregate_notification({ host: "h", page: "ghost", board: "test:prune", notification: null }),
                 "clearing a board/host that was never posted is a no-op");

    assert.true(aggregate_notification({ host: "h", page: "real", board: "test:prune", notification: { title: "x" } }),
                "post a sibling entry on the same host");
    assert.false(aggregate_notification({ host: "h", page: "ghost", board: "test:prune", notification: null }),
                 "clearing an absent page on a populated host is a no-op");
    assert.deepEqual(board_hosts("test:prune").h.real, { title: "x" }, "sibling entry untouched by the no-op clear");

    reset_notifications();
});

QUnit.test("aggregate_notification keeps hostile keys inert", function (assert) {
    reset_notifications();

    for (const k of ["__proto__", "constructor", "prototype"])
        aggregate_notification({ host: k, page: k, board: k, notification: { type: null, title: "x" } });

    assert.notOk("title" in {}, "Object.prototype not polluted via board/host/page keys");
    assert.strictEqual(Object.getPrototypeOf({}), Object.prototype, "plain object prototype intact");
    assert.deepEqual(Object.keys(board_hosts("__proto__")), ["__proto__"],
                     "hostile board/host/page names stored as inert own keys");

    reset_notifications();
});

cockpit.transport.wait(QUnit.start);
