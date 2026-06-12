// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import { channel, CHANNELS_KEY } from "notifications";
import QUnit from "qunit-tests";

/** @param {object} data */
function planRegistry(data) {
    sessionStorage.setItem(CHANNELS_KEY, JSON.stringify(data));
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

    const ch = channel("test:valid");
    let fired = false;
    ch.addEventListener("changed", () => {
        if (ch.valid && !fired) {
            fired = true;
            assert.true(ch.valid, "valid is true after transport ready");
            assert.deepEqual(ch.list(), [], "list returns [] when registry empty");
            done();
        }
    });
});

QUnit.test("list reads channel slice for current host", function (assert) {
    sessionStorage.removeItem(CHANNELS_KEY);
    const ch = channel("test:read");
    const host = cockpit.transport.host;

    planRegistry({
        "test:read": {
            [host]: {
                [`${host}/page-a/widget`]: { id: "widget", type: "info", title: "Hello" },
            },
            "other-host": {
                "other-host/page-a/widget": { id: "widget", type: "warning", title: "Other" },
            },
        },
        "test:other": {
            [host]: {
                [`${host}/page-b/x`]: { id: "x", type: "info", title: "Wrong channel" },
            },
        },
    });

    const list = ch.list();
    assert.equal(list.length, 1, "one entry for current host on this channel");
    assert.equal(list[0].title, "Hello", "got the right entry");
    assert.equal(list[0].publisher, `${host}/page-a/widget`, "publisher key exposed");

    assert.equal(ch.list("other-host").length, 1, "host scoping: explicit host returns its slice");
    assert.equal(ch.list("nonexistent-host").length, 0, "unknown host returns empty");

    assert.equal(channel("test:other").list().length, 1, "other channel returns its own slice");
});

QUnit.test("changed event fires only for the registry key", function (assert) {
    const ch = channel("test:storage-event");

    let fired = 0;
    const handler = () => { fired++ };
    ch.addEventListener("changed", handler);

    window.dispatchEvent(new StorageEvent("storage", { key: "cockpit:page_status" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    window.dispatchEvent(new StorageEvent("storage", { key: CHANNELS_KEY }));

    ch.removeEventListener("changed", handler);
    assert.equal(fired, 1, "only the channels key fires changed");
});

QUnit.test("publish sends control message with expected shape", function (assert) {
    const ch = channel("test:publish");
    const cap = captureControl();

    ch.publish({ id: "abc", type: "warning", title: "Hi", details: { link: "x" } });

    assert.equal(cap.calls.length, 1, "one control message sent");
    assert.equal(cap.calls[0].command, "notify", "command is notify");
    assert.equal(cap.calls[0].options.channel, "test:publish", "channel name in payload");
    assert.equal(cap.calls[0].options.id, "abc", "id at top level");
    assert.equal(cap.calls[0].options.notification.title, "Hi", "notification payload preserved");

    cap.restore();
});

QUnit.test("publish dedups identical payload", function (assert) {
    const ch = channel("test:dedup");
    const cap = captureControl();

    /** @type {import("notifications").ChannelNotification} */
    const payload = { id: "dup", type: "info", title: "Same" };
    ch.publish(payload);
    ch.publish(/** @type {import("notifications").ChannelNotification} */
        ({ id: payload.id, type: payload.type, title: payload.title }));

    assert.equal(cap.calls.length, 1, "second publish skipped via dequal");

    /** @type {import("notifications").ChannelNotification} */
    const payload2 = { id: "dup", type: "info", title: "Different" };
    ch.publish(payload2);
    assert.equal(cap.calls.length, 2, "different title broadcasts");

    cap.restore();
});

QUnit.test("clear sends control message with notification:null", function (assert) {
    const ch = channel("test:clear");
    const cap = captureControl();

    ch.publish({ id: "to-clear", type: "info", title: "T" });
    assert.equal(cap.calls.length, 1, "publish first");

    ch.clear("to-clear");
    assert.equal(cap.calls.length, 2, "clear sent");
    assert.equal(cap.calls[1].options.id, "to-clear", "clear targets the id");
    assert.strictEqual(cap.calls[1].options.notification, null, "notification is null on clear");

    ch.clear("to-clear");
    assert.equal(cap.calls.length, 2, "second clear deduped");

    cap.restore();
});

QUnit.test("publish rejects missing or empty id", function (assert) {
    const ch = channel("test:no-id");
    assert.throws(() => ch.publish(/** @type {any} */ ({ title: "no id" })),
                  /id is required/, "missing id throws");
    assert.throws(() => ch.publish(/** @type {any} */ (null)),
                  /id is required/, "null payload throws");
    assert.throws(() => ch.publish(/** @type {any} */ (undefined)),
                  /id is required/, "undefined payload throws");
    assert.throws(() => ch.publish(/** @type {any} */ ({ id: "", title: "x" })),
                  /id is required/, "empty-string id throws");
});

QUnit.test("clear of unknown id sends a single notify, then dedups", function (assert) {
    const ch = channel("test:clear-unknown");
    const cap = captureControl();

    ch.clear("never-published");
    assert.equal(cap.calls.length, 1, "first clear of unknown id broadcasts");
    ch.clear("never-published");
    assert.equal(cap.calls.length, 1, "second clear of same id deduped");

    cap.restore();
});

QUnit.test("channel() is memoized", function (assert) {
    const a = channel("test:memo");
    const b = channel("test:memo");
    assert.strictEqual(a, b, "same instance for same name");
    assert.notStrictEqual(channel("test:memo-other"), a, "different name yields different instance");
});

cockpit.transport.wait(QUnit.start);
