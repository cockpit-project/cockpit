import cockpit from "cockpit";
import QUnit, { mock_info } from "qunit-tests";

QUnit.test("basic", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const channel = cockpit.channel({ payload: "echo" });
    let pass = 0;

    const onControl = (ev, options) => {
        if (pass === 0) {
            assert.equal(options.command, "ready", "got ready");
            pass += 1;
        } else {
            assert.equal(options.command, "done", "got done");
            channel.close();
            channel.removeEventListener("control", onControl);
            done();
        }
    };
    channel.addEventListener("control", onControl);

    channel.addEventListener("message", (ev, payload) => {
        assert.strictEqual(payload, "the payload", "got the right payload");
        channel.control({ command: "done" });
    });

    assert.strictEqual(channel.binary, false, "not binary");
    channel.send("the payload");
});

QUnit.test("binary empty", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const channel = cockpit.channel({
        payload: "echo",
        binary: true
    });

    const onMessage = (ev, payload) => {
        assert.ok(payload instanceof Uint8Array, "got a byte array");
        assert.strictEqual(payload.length, 0, "got the right payload");
        channel.removeEventListener("message", onMessage);
        done();
    };
    channel.addEventListener("message", onMessage);

    channel.send("");
});

QUnit.test("binary", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const channel = cockpit.channel({ payload: "echo", binary: true });

    const onMessage = (ev, payload) => {
        assert.ok(payload instanceof Uint8Array, "got a byte array");

        const array = [];
        for (let i = 0; i < payload.length; i++)
            array.push(payload[i]);
        assert.deepEqual(array, [0, 1, 2, 3, 4, 5, 6, 7], "got back right data");

        channel.close();
        channel.removeEventListener("message", onMessage);
        done();
    };
    channel.addEventListener("message", onMessage);

    const buffer = new ArrayBuffer(8);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < 8; i++)
        view[i] = i;

    assert.strictEqual(channel.binary, true, "binary set");
    channel.send(buffer);
});

QUnit.test("fence", async assert => {
    const done = assert.async();

    // This is implemented in the C bridge, but not in Python.
    if (await mock_info("pybridge")) {
        assert.ok(true, "skipping on python bridge, not implemented");
        done();
        return;
    }

    assert.expect(2);

    const before = cockpit.channel({ payload: "echo" });
    before.addEventListener("message", onMessage);

    const fence = cockpit.channel({ payload: "echo", group: "fence" });
    fence.addEventListener("message", onMessage);

    const after = cockpit.channel({ payload: "echo" });
    after.addEventListener("message", onMessage);

    const received = [];
    function onMessage(ev, payload) {
        received.push(payload);
        if (received.length == 3) {
            assert.deepEqual(received, ["1", "2", "3"], "got back before and fence data");
            fence.close();
        } else if (received.length == 5) {
            assert.deepEqual(received, ["1", "2", "3", "4", "5"], "got back data in right order");
            before.close();
            after.close();
            done();
        }
    }

    /* We send messages in this order, but they should echoed in numeric order */
    before.send("1");
    after.send("4");
    after.send("5");
    fence.send("2");
    fence.send("3");
});

QUnit.start();
