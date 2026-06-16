// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import {
    board, NOTIFICATIONS_KEY, BOARD_KEY_RE, PAGE_STATUS_BOARD,
    aggregate_notification, aggregate_notification_control, board_entries, board_index, reset_notifications,
} from "_internal/notifications";
import { SAFE_LINK_RE } from "overview";
import { page_status, is_page_status } from "shell";
import QUnit from "qunit-tests";

/** @type {{ command: string, options: any }[]} */
let calls = [];
let warned = 0;
const orig_control = cockpit.transport.control;
const orig_warn = console.warn;

QUnit.hooks.beforeEach(() => {
    reset_notifications();
    calls = [];
    warned = 0;
    cockpit.transport.control = (command, options) => { calls.push({ command, options }) };
    console.warn = () => { warned++ };
});

QUnit.hooks.afterEach(() => {
    cockpit.transport.control = orig_control;
    console.warn = orig_warn;
});

/** @param {string} board */
function payloads(board) {
    return board_entries(board).map(e => e.notification);
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

QUnit.test("list reads board entries for current host", function (assert) {
    const b = board("test:read");
    const host = cockpit.transport.host;

    sessionStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify({
        "test:read": [
            { host, page: "page-a", notification: { type: "info", title: "Hello" } },
            { host: "other-host", page: "page-a", notification: { type: "warning", title: "Other" } },
            { host, page: "page-a", notification: { type: "info", title: "Second" } },
        ],
        "test:other": [
            { host, page: "page-b", notification: { type: "info", title: "Wrong board" } },
        ],
    }));

    const list = b.list();
    assert.equal(list.length, 2, "entries for current host on this board");
    assert.deepEqual(list[0], { host, page: "page-a", notification: { type: "info", title: "Hello" } }, "entry wraps origin and payload");
    assert.equal(list[1].notification.title, "Second", "a page can hold several entries");

    assert.equal(b.list("other-host").length, 1, "host scoping: explicit host returns its entries");
    assert.equal(b.list("nonexistent-host").length, 0, "unknown host returns empty");

    assert.equal(board("test:other").list().length, 1, "other board returns its own entries");
});

QUnit.test("list returns [] when sessionStorage holds malformed JSON", function (assert) {
    const b = board("test:malformed");
    sessionStorage.setItem(NOTIFICATIONS_KEY, "{not valid json");
    assert.deepEqual(b.list(), [], "JSON.parse failure swallowed, empty list");
});

QUnit.test("list ignores inherited properties for unposted boards", function (assert) {
    for (const name of ["__proto__", "constructor", "toString"]) {
        const b = board(name);
        assert.deepEqual(b.list(), [], `${name} is empty before its first post`);
        aggregate_notification({ host: cockpit.transport.host, page: "p", board: name, notifications: ["posted"] });
        assert.deepEqual(b.list().map(e => e.notification), ["posted"], `${name} returns its own entries`);
    }
});

QUnit.test("changed event fires only for the registry key", function (assert) {
    const b = board("test:storage-event");

    let fired = 0;
    const handler = () => { fired++ };
    b.addEventListener("changed", handler);

    window.dispatchEvent(new StorageEvent("storage", { key: "cockpit:other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: NOTIFICATIONS_KEY }));

    b.removeEventListener("changed", handler);
    assert.equal(fired, 1, "only the notifications key fires changed");
});

QUnit.test("publish sends control message with expected shape", function (assert) {
    const b = board("test:publish");

    b.publish([{ type: "warning", title: "Hi", link: "x" }, "plain string"]);

    assert.equal(calls.length, 1, "one control message sent");
    assert.equal(calls[0].command, "notify", "command is notify");
    assert.deepEqual(calls[0].options,
                     { board: "test:publish", notifications: [{ type: "warning", title: "Hi", link: "x" }, "plain string"] },
                     "board and entries sent verbatim");

    b.publish(["y"], { extra: 1, board: "spoofed", notifications: ["spoofed"] });
    assert.deepEqual(calls[1].options, { extra: 1, board: "test:publish", notifications: ["y"] },
                     "extra fields ride along but cannot override board or notifications");
});

QUnit.test("page_status.publish sends legacy and board payloads", function (assert) {
    page_status.publish(null);
    calls = [];

    page_status.publish({ type: "warning" });
    assert.equal(calls.length, 1, "one control message sent");
    assert.equal(calls[0].command, "notify", "command is notify");
    assert.deepEqual(calls[0].options,
                     { page_status: { type: "warning" }, board: PAGE_STATUS_BOARD, notifications: [{ type: "warning" }] },
                     "legacy field and one-entry board list");

    page_status.publish(null);
    assert.equal(calls.length, 2, "clear sent");
    assert.deepEqual(calls[1].options, { page_status: null, board: PAGE_STATUS_BOARD, notifications: [] },
                     "legacy null and empty board list");
});

QUnit.test("is_page_status accepts type/title shapes and rejects others", function (assert) {
    for (const ok of [{ }, { type: null }, { type: "warning", title: "t" }, { title: "t" }])
        assert.true(is_page_status(ok), `accepts ${JSON.stringify(ok)}`);
    for (const bad of [null, undefined, "s", 5, [], { type: 5 }, { type: "x y" }, { type: "danger" }, { title: 5 }, { title: {} }])
        assert.false(is_page_status(bad), `rejects ${JSON.stringify(bad)}`);
});

QUnit.test("publish dedups identical payload", function (assert) {
    const b = board("test:dedup");

    b.publish([{ type: "info", title: "Same" }]);
    b.publish([{ type: "info", title: "Same" }]);
    assert.equal(calls.length, 1, "identical list not resent");

    b.publish([{ type: "info", title: "Different" }]);
    assert.equal(calls.length, 2, "different title broadcasts");

    b.publish([{ type: "info", title: "Different" }, { type: "info", title: "More" }]);
    assert.equal(calls.length, 3, "longer list broadcasts");

    b.publish([{ type: "info", title: "Different" }, { type: "info", title: "More" }], { legacy: 1 });
    assert.equal(calls.length, 4, "changed extra field broadcasts");
});

QUnit.test("clear sends control message with an empty list", function (assert) {
    const b = board("test:clear");

    b.publish([{ type: "info", title: "T" }]);
    assert.equal(calls.length, 1, "publish first");

    b.clear();
    assert.equal(calls.length, 2, "clear sent");
    assert.deepEqual(calls[1].options, { board: "test:clear", notifications: [] }, "clear is an empty list");

    b.clear();
    assert.equal(calls.length, 2, "second clear deduped");
});

QUnit.test("clear from a fresh instance still sends (stale entry after reload)", function (assert) {
    const b = board("test:clear-fresh");

    b.clear();
    assert.equal(calls.length, 1, "first clear sends even without a prior publish");
    assert.deepEqual(calls[0].options.notifications, [], "notifications is empty");

    b.clear();
    assert.equal(calls.length, 1, "second clear deduped");
});

QUnit.test("board() is memoized", function (assert) {
    const a = board("test:memo");
    const b = board("test:memo");
    assert.strictEqual(a, b, "same instance for same name");
    assert.notStrictEqual(board("test:memo-other"), a, "different name yields different instance");
});

QUnit.test("board() warns on a name that fails BOARD_KEY_RE", function (assert) {
    assert.ok(board("bad name"), "still returns a board instance for an invalid name");
    assert.equal(warned, 1, "warns once");
    board("bad name");
    assert.equal(warned, 1, "memoized instance does not warn again");
});

QUnit.test("BOARD_KEY_RE accepts board names, rejects hostile input", function (assert) {
    // "__proto__" matches the pattern; the null-prototype registry keeps it inert.
    for (const ok of ["overview:health", "shell:page-status", "playground:demo", "a/b", "A_b.c-1", "__proto__", "x".repeat(128)])
        assert.true(BOARD_KEY_RE.test(ok), `accepts ${ok.slice(0, 20)}`);
    for (const bad of ["", "a b", "a<b", "a;b", "a\nb", "x".repeat(129)])
        assert.false(BOARD_KEY_RE.test(bad), `rejects ${JSON.stringify(bad).slice(0, 20)}`);
});

QUnit.test("SAFE_LINK_RE accepts page paths, rejects cross-host and traversal", function (assert) {
    for (const ok of ["updates", "system/services", "a-b_c/d"])
        assert.true(SAFE_LINK_RE.test(ok), `accepts ${ok}`);
    for (const bad of ["", "@host", "/system/log", "a/", "../x", "a/../b", "http://x", "javascript:alert(1)", "a b", "a?b", "//x", "ü", "a/б", "a#b"])
        assert.false(SAFE_LINK_RE.test(bad), `rejects ${bad}`);
});

QUnit.test("aggregate_notification stores wrapped entries, mirrors them, and clears", function (assert) {
    assert.true(aggregate_notification({ host: "h1", page: "p1", board: "test:agg", notifications: [{ type: "info", title: "Hi" }] }),
                "valid post accepted");
    const expected = [{ host: "h1", page: "p1", notification: { type: "info", title: "Hi" } }];
    assert.deepEqual(board_entries("test:agg"), expected, "entry wrapped with its origin");
    assert.deepEqual(JSON.parse(sessionStorage.getItem(NOTIFICATIONS_KEY)), { "test:agg": expected }, "mirror holds the registry");
    assert.deepEqual(board("test:agg").list("h1"), expected, "a page reads the post back through list()");

    assert.true(aggregate_notification({ host: "h1", page: "p1", board: "test:agg", notifications: [] }),
                "clear accepted");
    assert.deepEqual(board_entries("test:agg"), [], "entry gone after clear");
    assert.deepEqual(board("test:agg").list("h1"), [], "list() sees the clear");

    aggregate_notification({ host: "h1", page: "p1", board: "test:agg", notifications: ["x"] });
    reset_notifications();
    assert.deepEqual(board_entries("test:agg"), [], "reset empties the board");
    assert.strictEqual(sessionStorage.getItem(NOTIFICATIONS_KEY), null, "reset drops the mirror");
});

QUnit.test("aggregate_notification takes any JSON payload", function (assert) {
    const entries = [5, "s", null, true, [1, [2]], { a: { b: 1 } }, { type: "warning" }];
    assert.true(aggregate_notification({ host: "h", page: "p", board: "test:opaque", notifications: entries }),
                "mixed payloads accepted");
    assert.deepEqual(payloads("test:opaque"), entries, "payloads stored verbatim and in order");
});

QUnit.test("aggregate_notification replaces a page's entries in place", function (assert) {
    aggregate_notification({ host: "h", page: "a", board: "test:replace", notifications: ["a1"] });
    aggregate_notification({ host: "h", page: "b", board: "test:replace", notifications: ["b1", "b2"] });
    aggregate_notification({ host: "h", page: "c", board: "test:replace", notifications: ["c1"] });
    aggregate_notification({ host: "h2", page: "b", board: "test:replace", notifications: ["other-host"] });
    assert.deepEqual(payloads("test:replace"), ["a1", "b1", "b2", "c1", "other-host"], "entries listed in post order");

    assert.true(aggregate_notification({ host: "h", page: "b", board: "test:replace", notifications: ["b3"] }),
                "republish accepted");
    assert.deepEqual(payloads("test:replace"), ["a1", "b3", "c1", "other-host"],
                     "page's entries replaced at their old position, other pages and hosts untouched");

    assert.true(aggregate_notification({ host: "h", page: "b", board: "test:replace", notifications: ["b4", "b5", "b6"] }),
                "republish with more entries accepted");
    assert.deepEqual(payloads("test:replace"), ["a1", "b4", "b5", "b6", "c1", "other-host"], "grows in place");

    assert.true(aggregate_notification({ host: "h", page: "b", board: "test:replace", notifications: [] }), "clear accepted");
    assert.deepEqual(payloads("test:replace"), ["a1", "c1", "other-host"], "cleared page gone, order kept");
});

QUnit.test("aggregate_notification drops a post the mirror cannot hold", function (assert) {
    aggregate_notification({ host: "h", page: "p", board: "test:quota", notifications: ["kept"] });

    const orig_set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError") };
    try {
        assert.false(aggregate_notification({ host: "h", page: "p", board: "test:quota", notifications: ["big"] }),
                     "post rejected when setItem throws");
    } finally {
        Storage.prototype.setItem = orig_set;
    }
    assert.deepEqual(payloads("test:quota"), ["kept"], "registry keeps the previous entries");
    assert.deepEqual(JSON.parse(sessionStorage.getItem(NOTIFICATIONS_KEY))["test:quota"].map(e => e.notification), ["kept"],
                     "mirror still matches the registry");
    assert.equal(warned, 1, "failure is logged once");
});

QUnit.test("large posts reach the storage quota handler", function (assert) {
    aggregate_notification({ host: "h", page: "p", board: "test:large", notifications: ["kept"] });

    const orig_set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError") };
    try {
        assert.false(aggregate_notification({ host: "h", page: "p", board: "test:large", notifications: Array(200000).fill(null) }),
                     "large post rejected without exceeding the function argument limit");
    } finally {
        Storage.prototype.setItem = orig_set;
    }
    assert.deepEqual(payloads("test:large"), ["kept"], "previous entries survive");
    assert.equal(warned, 1, "storage failure was handled");
});

QUnit.test("aggregate_notification_control routes board and legacy posts", function (assert) {
    assert.equal(aggregate_notification_control({
        host: "h",
        page: "p",
        data: { board: "test:route", notifications: [{ title: "Board" }], page_status: { type: "warning" } },
    }), "test:route", "board post accepted and its board reported");
    assert.deepEqual(payloads("test:route"), [{ title: "Board" }], "board post stored");
    assert.deepEqual(board_entries(PAGE_STATUS_BOARD), [], "legacy field ignored when board is present");

    assert.equal(aggregate_notification_control({
        host: "h",
        page: "legacy",
        data: { page_status: { type: "warning" } },
    }), PAGE_STATUS_BOARD, "legacy post lands on the page-status board");
    assert.deepEqual(board_entries(PAGE_STATUS_BOARD), [{ host: "h", page: "legacy", notification: { type: "warning" } }],
                     "legacy post stored as a one-entry list");

    assert.equal(aggregate_notification_control({ host: "h", page: "legacy", data: { page_status: "odd" } }),
                 PAGE_STATUS_BOARD, "legacy non-object post accepted, consumers validate");
    assert.deepEqual(payloads(PAGE_STATUS_BOARD), ["odd"], "stored verbatim");

    assert.equal(aggregate_notification_control({ host: "h", page: "legacy", data: { page_status: null } }),
                 PAGE_STATUS_BOARD, "legacy clear accepted");
    assert.deepEqual(board_entries(PAGE_STATUS_BOARD), [], "legacy null clears the page");

    for (const notifications of [undefined, null, "x", { title: "obj" }]) {
        assert.strictEqual(aggregate_notification_control({
            host: "h",
            page: "bad",
            data: { board: "test:route", notifications, page_status: { type: "warning" } },
        }), null, `board post with non-array notifications ${JSON.stringify(notifications)} rejected`);
    }
    assert.deepEqual(board_entries(PAGE_STATUS_BOARD), [], "a rejected board post does not fall through to page_status");
    assert.deepEqual(payloads("test:route"), [{ title: "Board" }], "rejected posts leave the board untouched");

    assert.equal(aggregate_notification_control({ host: "h", page: "num", data: { board: 5, page_status: { type: "info" } } }),
                 PAGE_STATUS_BOARD, "non-string board falls back to the legacy field");

    assert.strictEqual(aggregate_notification_control({ host: "h", page: "none", data: { } }),
                       null, "message without board or page_status is ignored");
});

QUnit.test("aggregate_notification rejects a bad board name or non-list", function (assert) {
    assert.false(aggregate_notification({ host: "h", page: "p", board: "bad name", notifications: [{ title: "x" }] }),
                 "board name failing BOARD_KEY_RE rejected");
    assert.false(aggregate_notification({ host: "h", page: "p", board: "test:rej", notifications: /** @type {any} */ ({ title: "x" }) }),
                 "object instead of a list rejected");
    assert.deepEqual(board_entries("test:rej"), [], "nothing stored from rejected posts");
});

QUnit.test("aggregate_notification clear of an unposted page returns false", function (assert) {
    assert.false(aggregate_notification({ host: "h", page: "ghost", board: "test:prune", notifications: [] }),
                 "clearing a board that was never posted is a no-op");

    assert.true(aggregate_notification({ host: "h", page: "real", board: "test:prune", notifications: [{ title: "x" }] }),
                "post a sibling entry on the same host");
    assert.false(aggregate_notification({ host: "h", page: "ghost", board: "test:prune", notifications: [] }),
                 "clearing an absent page on a populated board is a no-op");
    assert.deepEqual(payloads("test:prune"), [{ title: "x" }], "sibling entry untouched by the no-op clear");
});

QUnit.test("board_index keeps a page's last valid entry per host", function (assert) {
    aggregate_notification({ host: "h1", page: "a", board: "test:index", notifications: [{ type: "info", title: "first" }, { type: "error", title: "last" }] });
    aggregate_notification({ host: "h1", page: "b", board: "test:index", notifications: ["not a status"] });
    aggregate_notification({ host: "h2", page: "a", board: "test:index", notifications: [{ type: "warning" }] });

    const index = board_index("test:index", is_page_status);
    assert.deepEqual(index, { h1: { a: { type: "error", title: "last" } }, h2: { a: { type: "warning" } } },
                     "last entry wins, entries failing the guard dropped");
    assert.strictEqual(Object.getPrototypeOf(index), null, "index has no prototype");
    assert.strictEqual(Object.getPrototypeOf(index.h1), null, "host slots have no prototype");
    assert.deepEqual(board_index("test:empty", is_page_status), { }, "unknown board gives an empty index");
});

QUnit.test("aggregate_notification keeps hostile keys inert", function (assert) {
    for (const k of ["__proto__", "constructor", "prototype"]) {
        aggregate_notification({ host: k, page: k, board: k, notifications: [{ type: null, title: "x" }] });
        assert.deepEqual(board_entries(k), [{ host: k, page: k, notification: { type: null, title: "x" } }], `${k} stored as an inert own key`);
        assert.deepEqual(board_index(k, is_page_status)[k][k], { type: null, title: "x" }, `${k} indexed as an inert own key`);
    }

    assert.notOk("title" in {}, "Object.prototype not polluted via board/host/page keys");
    assert.strictEqual(Object.getPrototypeOf({}), Object.prototype, "plain object prototype intact");
});

cockpit.transport.wait(QUnit.start);
