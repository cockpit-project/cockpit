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

    var first = true;

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

QUnit.start();
