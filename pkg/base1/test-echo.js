import cockpit from "cockpit";
import QUnit from "qunit-tests";

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

QUnit.start();
