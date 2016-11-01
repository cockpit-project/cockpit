/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

/* Seems like something jQuery should provide */
if (!console.assert) {
    console.assert = function(cond, msg) {
        if (!cond)
            throw msg || "assertion failed";
    };
}

function MockPeer() {
    /*
     * Events triggered here:
     * open(event, args)
     * recv(event, payload)
     * close(event, problem)
     * get(event, path)
     */

    /* open: triggered when mock Channel is created */
    this.onopened = function(event, channel, options) {
        /* nada */
    };

    /* close event: triggered when mock Channel is closed */
    this.onclosed = function(event, channel, options) {
        /* nada */
    };

    /* get event: triggered when we receive a get request */
    this.onget = function(event, channel, request) {
        if (event.isDefaultPrevented())
            return false;
        if (request.path == "/")
            this.reply(channel, request, { "key": "value" });
    };

    /* send a message from peer back to channel */
    this.send = function(channel, payload) {
        if (typeof(payload) != "string")
            payload = String(payload);
        window.setTimeout(function() {
            if (channel.valid)
                channel.dispatchEvent("message", payload);
            else
                console.log("dropping message after close from MockPeer");
        }, 5);
    };

    /* peer closes the channel */
    this.close = function(channel, options) {
        console.assert(channel);
        window.setTimeout(function() {
            if (channel.valid) {
                channel.valid = false;
                channel.dispatchEvent("close", options || { });
            }
        }, 5);
    };

    var peer = this;
    var last_channel = 0;

    function MockChannel(options) {
        cockpit.event_target(this);
        this.number = last_channel++;
        this.options = options;
        this.valid = true;

        var channel = this;

        function Transport() {
            this.close = function(problem) { console.assert(arguments.length == 1); };
        }

        this.transport = new Transport();

        this.send = function(payload) {
            console.assert(arguments.length == 1);
            console.assert(this.valid);
            window.setTimeout(function() { $(peer).trigger("recv", [channel, payload]); }, 5);
        };

        this.close = function(options) {
            console.assert(arguments.length <= 1);
            this.valid = false;
            window.setTimeout(function() { $(peer).trigger("closed", [channel, options || { }]); }, 5);
            this.dispatchEvent("close", options || { });
        };

        this.buffer = function(callback) {
            var buffers = [];
            buffers.callback = callback;
            buffers.squash = function squash() {
                return buffers.join("");
            };

            this.onmessage = function(event, data) {
                var consumed, block;
                buffers.push(data);
                if (buffers.callback) {
                    block = buffers.squash();
                    if (block.length > 0) {
                        consumed = buffers.callback.call(this, block);
                        if (typeof consumed !== "number" || consumed === block.length) {
                            buffers.length = 0;
                        } else {
                            buffers.length = 1;
                            buffers[0] = block.substring(consumed);
                        }
                    }
                }
            };

            return buffers;
        };

        QUnit.testDone(function() {
            channel.valid = false;
        });

        $(peer).trigger("opened", [channel, options]);
    }

    cockpit.channel = function(options) {
        return new MockChannel(options);
    };
}

QUnit.test("public api", function() {
    assert.equal(typeof cockpit.spawn, "function", "spawn is a function");
});

QUnit.asyncTest("simple request", function() {
    assert.expect(5);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel, options) {
        assert.deepEqual(channel.options["spawn"], ["/the/path", "arg1", "arg2"], "passed spawn correctly");
        assert.equal(channel.options["host"], undefined, "had no host");
    });
    $(peer).on("recv", function(event, channel, payload) {
        assert.equal(payload, "input", "had input");
        this.send(channel, "output");
        this.close(channel);
    });

    cockpit.spawn(["/the/path", "arg1", "arg2"]).
        input("input", true).
        done(function(resp) {
            assert.deepEqual(resp, "output", "returned right json");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("string command", function() {
    assert.expect(2);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel, options) {
        assert.deepEqual(channel.options["spawn"], ["/the/path"], "passed spawn correctly");
        assert.equal(channel.options["host"], "hostname", "had host");
        QUnit.start();
    });

    cockpit.spawn("/the/path", { "host": "hostname" });
});

QUnit.asyncTest("channel options", function() {
    assert.expect(1);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel) {
        assert.deepEqual(channel.options, {
            "spawn": ["/the/path", "arg"],
            "host": "the-other-host.example.com",
            "extra-option": "zerogjuggs",
            "payload": "stream"
            }, "sent correctly");
        QUnit.start();
    });

    /* Don't care about the result ... */
    var options = { "extra-option": "zerogjuggs", "host": "the-other-host.example.com" };
    cockpit.spawn(["/the/path", "arg"], options);
});

QUnit.asyncTest("streaming", function() {
    assert.expect(12);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel) {
        for(var i = 0; i < 10; i++)
            this.send(channel, String(i));
        this.close(channel);
    });

    var at = 0;
    cockpit.spawn(["/unused"]).
        stream(function(resp) {
            assert.equal(String(at), resp, "stream got right data");
            at++;
        }).
        done(function(resp) {
            assert.ok(!resp, "stream didn't send data to done");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "split response didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("with problem", function() {
    assert.expect(4);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel) {
        peer.close(channel, {"problem": "not-found"});
    });

    cockpit.spawn("/unused").
        fail(function(ex) {
            assert.equal(ex.problem, "not-found", "got problem");
            assert.strictEqual(ex.exit_signal, null, "got no signal");
            assert.strictEqual(ex.exit_status, null, "got no status");
        }).
        always(function() {
            assert.equal(this.state(), "rejected", "should fail");
            QUnit.start();
        });
});

QUnit.asyncTest("with status", function() {
    assert.expect(5);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel) {
        peer.send(channel, "the data");
        peer.close(channel, {"exit-status": 5});
    });

    cockpit.spawn("/unused").
        fail(function(ex, data) {
            assert.strictEqual(ex.problem, null, "got null problem");
            assert.strictEqual(ex.exit_signal, null, "got no signal");
            assert.strictEqual(ex.exit_status, 5, "got status");
            assert.equal(data, "the data", "got data even with exit status");
        }).
        always(function() {
            assert.equal(this.state(), "rejected", "should fail");
            QUnit.start();
        });
});

QUnit.asyncTest("with signal", function() {
    assert.expect(5);

    var peer = new MockPeer();
    $(peer).on("opened", function(event, channel) {
        peer.send(channel, "signal data here");
        peer.close(channel, {"exit-signal": "TERM"});
    });

    cockpit.spawn("/unused").
        fail(function(ex, data) {
            assert.strictEqual(ex.problem, null, "got null problem");
            assert.strictEqual(ex.exit_signal, "TERM", "got signal");
            assert.strictEqual(ex.exit_status, null, "got no status");
            assert.equal(data, "signal data here", "got data even with signal");
        }).
        always(function() {
            assert.equal(this.state(), "rejected", "should fail");
            QUnit.start();
        });
});

QUnit.test("spawn promise recursive", function() {
    assert.expect(7);

    var peer = new MockPeer();
    var promise = cockpit.spawn(["/the/path", "arg1", "arg2"]);

    var target = { };
    var promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.input, "function", "promise2.input()");

    var promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.input, "function", "promise3.input()");
});

QUnit.start();
