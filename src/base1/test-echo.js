/* global $, cockpit, QUnit, ArrayBuffer, Uint8Array */

/* To help with future migration */
var assert = QUnit;

QUnit.asyncTest("basic", function() {
    assert.expect(4);

    var channel = cockpit.channel({ "payload": "echo" });
    var pass = 0;

    $(channel).on("control", function(ev, options) {
        if (pass === 0) {
            assert.equal(options.command, "ready", "got ready");
            pass += 1;
        } else {
            assert.equal(options.command, "done", "got done");
            channel.close();
            $(channel).off();
            QUnit.start();
        }
    });

    $(channel).on("message", function(ev, payload) {
        assert.strictEqual(payload, "the payload", "got the right payload");
        channel.control({ command: "done" });
    });

    assert.strictEqual(channel.binary, false, "not binary");
    channel.send("the payload");
});

QUnit.asyncTest("binary empty", function() {
    assert.expect(2);

    var channel = cockpit.channel({
        "payload": "echo",
        "binary": true
    });

    $(channel).on("message", function(ev, payload) {
        if (window.Uint8Array)
            assert.ok(payload instanceof window.Uint8Array, "got a byte array");
        else
            assert.ok($.isArray(payload), "got a byte array");
        assert.strictEqual(payload.length, 0, "got the right payload");
        $(channel).off();
        QUnit.start();
    });

    channel.send("");
});

QUnit.asyncTest("binary", function() {
    assert.expect(3);

    var channel = cockpit.channel({ "payload": "echo", "binary": true });

    $(channel).on("message", function(ev, payload) {
        if (window.Uint8Array)
            assert.ok(payload instanceof window.Uint8Array, "got a byte array");
        else
            assert.ok($.isArray(payload), "got a byte array");

        var array = [];
        for (var i = 0; i < payload.length; i++)
            array.push(payload[i]);
        assert.deepEqual(array, [ 0, 1, 2, 3, 4, 5, 6, 7 ], "got back right data");

        channel.close();
        $(channel).off();
        QUnit.start();
    });

    var i, buffer;

    if (window.ArrayBuffer) {
        buffer = new ArrayBuffer(8);
        var view = new Uint8Array(buffer);
        for (i = 0; i < 8; i++)
            view[i] = i;
    } else {
        buffer = new Array(8);
        for (i = 0; i < 8; i++)
            buffer[i] = i;
    }

    assert.strictEqual(channel.binary, true, "binary set");
    channel.send(buffer);
});

QUnit.asyncTest("fence", function() {
    assert.expect(2);

    var before = cockpit.channel({ "payload": "echo" });
    before.addEventListener("message", onMessage);

    var fence = cockpit.channel({ "payload": "echo", "group": "fence" });
    fence.addEventListener("message", onMessage);

    var after = cockpit.channel({ "payload": "echo" });
    after.addEventListener("message", onMessage);

    var received = [ ];
    function onMessage(ev, payload) {
        received.push(payload);
        if (received.length == 3) {
            assert.deepEqual(received, [ "1", "2", "3", ], "got back before and fence data");
            fence.close();
        } else if (received.length == 5) {
            assert.deepEqual(received, [ "1", "2", "3", "4", "5" ], "got back data in right order");
            before.close();
            after.close();
            QUnit.start();
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
