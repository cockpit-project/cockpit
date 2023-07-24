import cockpit from "cockpit";
import QUnit from "qunit-tests";

function MockPeer() {
    /*
     * Events triggered here:
     * open(event, args)
     * recv(event, payload)
     * close(event, problem)
     * get(event, path)
     */
    cockpit.event_target(this);

    /* open: triggered when mock Channel is created */
    this.onopened = function(event, channel, options) {
        /* nada */
    };

    /* close event: triggered when mock Channel is closed */
    this.onclosed = function(event, channel, options) {
        /* nada */
    };

    this.oncontrol = function(event, channel, options) {
        /* nada */
    };

    /* send a message from peer back to channel */
    this.send = function(channel, payload) {
        if (typeof (payload) != "string")
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

    const peer = this;
    let last_channel = 0;

    function MockChannel(options) {
        cockpit.event_target(this);
        this.number = last_channel++;
        this.options = options;
        this.valid = true;

        const channel = this;

        function Transport() {
            this.close = function(problem) { console.assert(arguments.length == 1) };
        }

        this.transport = new Transport();

        this.send = function(payload) {
            console.assert(arguments.length == 1);
            console.assert(this.valid);
            window.setTimeout(function() { peer.dispatchEvent("recv", channel, payload) }, 5);
        };

        this.control = function(options) {
            console.assert(typeof command === 'string');
            console.assert(options !== null && typeof options === 'object');
            console.assert(arguments.length == 1);
            window.setTimeout(function() { peer.dispatchEvent("control", channel, options) }, 5);
        };

        this.close = function(options) {
            console.assert(arguments.length <= 1);
            this.valid = false;
            window.setTimeout(function() { peer.dispatchEvent("closed", channel, options || { }) }, 5);
            this.dispatchEvent("close", options || { });
        };

        this.buffer = function(callback) {
            const buffers = [];
            buffers.callback = callback;
            buffers.squash = function squash() {
                return buffers.join("");
            };

            this.onmessage = function(event, data) {
                buffers.push(data);
                if (buffers.callback) {
                    const block = buffers.squash();
                    if (block.length > 0) {
                        const consumed = buffers.callback.call(this, block);
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

        peer.dispatchEvent("opened", channel, options);
    }

    cockpit.channel = function(options) {
        return new MockChannel(options);
    };
}

QUnit.test("public api", function (assert) {
    assert.equal(typeof cockpit.spawn, "function", "spawn is a function");
});

QUnit.test("simple request", async assert => {
    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel, options) {
        assert.deepEqual(channel.options.spawn, ["/the/path", "arg1", "arg2"], "passed spawn correctly");
        assert.equal(channel.options.host, undefined, "had no host");
    });
    peer.addEventListener("recv", function(event, channel, payload) {
        assert.equal(payload, "input", "had input");
        this.send(channel, "output");
        this.close(channel);
    });

    const resp = await cockpit.spawn(["/the/path", "arg1", "arg2"])
            .input("input", true);
    assert.deepEqual(resp, "output", "returned right json");
});

QUnit.test("input large", function (assert) {
    const done = assert.async();
    assert.expect(25);

    const str = new Array(128 * 1024).join('abcdef12345');
    let output = "";
    let count = 0;

    const peer = new MockPeer();
    peer.addEventListener("recv", function(event, channel, payload) {
        assert.ok(typeof (payload) == "string", "got payload");
        output += payload;
        count += 1;
    });
    peer.addEventListener("control", function(event, channel, options) {
        if (options.command == "done")
            this.close(channel);
    });

    cockpit.spawn(["/path/to/command"])
            .input(str)
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                assert.equal(str, output, "right output");
                assert.ok(count > 1, "broken into multiple blocks");
                done();
            });
});

QUnit.test("binary large", function (assert) {
    const done = assert.async();
    assert.expect(10);

    const data = new Uint8Array(249 * 1023);
    const len = data.byteLength;
    for (let i = 0; i < len; i++)
        data[i] = i % 233;

    let count = 0;

    const peer = new MockPeer();
    peer.addEventListener("recv", function(event, channel, payload) {
        console.log(typeof (payload), payload.constructor);
        assert.equal(typeof (payload), "object", "got payload");
        assert.equal(payload.constructor, Uint8Array, "right binary array");
        count += 1;
    });
    peer.addEventListener("control", function(event, channel, options) {
        console.log("control", options);
        if (options.command == "done")
            this.close(channel);
    });

    cockpit.spawn(["/ptah/to/command"])
            .input(data)
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                assert.ok(count > 1, "broken into multiple blocks");
                done();
            });
});

QUnit.test("string command", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel, options) {
        assert.deepEqual(channel.options.spawn, ["/the/path"], "passed spawn correctly");
        assert.equal(channel.options.host, "hostname", "had host");
        done();
    });

    cockpit.spawn("/the/path", { host: "hostname" });
});

QUnit.test("channel options", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel) {
        assert.deepEqual(channel.options, {
            spawn: ["/the/path", "arg"],
            host: "the-other-host.example.com",
            "extra-option": "zerogjuggs",
            payload: "stream"
        }, "sent correctly");
        done();
    });

    /* Don't care about the result ... */
    const options = { "extra-option": "zerogjuggs", host: "the-other-host.example.com" };
    cockpit.spawn(["/the/path", "arg"], options);
});

QUnit.test("streaming", assert => {
    const done = assert.async();
    assert.expect(15);

    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel) {
        for (let i = 0; i < 10; i++)
            this.send(channel, String(i));
        this.close(channel);
    });

    let at = 0;
    const promise = cockpit.spawn(["/unused"])
            .stream(function(resp) {
                assert.equal(String(at), resp, "stream got right data");
                if (at === 0)
                    assert.strictEqual(this, promise, "stream got right this");
                at++;
            })
            .done(function(resp) {
                assert.ok(!resp, "stream didn't send data to done");
                assert.strictEqual(this, promise, "done got right this");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "split response didn't fail");
                assert.strictEqual(this, promise, "always got right this");
                done();
            });
});

QUnit.test("with problem", async assert => {
    const peer = new MockPeer();
    peer.addEventListener("opened", (_event, channel) => {
        peer.close(channel, { problem: "not-found" });
    });

    try {
        await cockpit.spawn("/unused");
        assert.ok(false, "should not be reached");
    } catch (ex) {
        assert.equal(ex.problem, "not-found", "got problem");
        assert.strictEqual(ex.exit_signal, null, "got no signal");
        assert.strictEqual(ex.exit_status, null, "got no status");
    }
});

QUnit.test("with status", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel) {
        peer.send(channel, "the data");
        peer.close(channel, { "exit-status": 5 });
    });

    cockpit.spawn("/unused")
            .fail(function(ex, data) {
                assert.strictEqual(ex.problem, null, "got null problem");
                assert.strictEqual(ex.exit_signal, null, "got no signal");
                assert.strictEqual(ex.exit_status, 5, "got status");
                assert.equal(data, "the data", "got data even with exit status");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                done();
            });
});

QUnit.test("with signal", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const peer = new MockPeer();
    peer.addEventListener("opened", function(event, channel) {
        peer.send(channel, "signal data here");
        peer.close(channel, { "exit-signal": "TERM" });
    });

    cockpit.spawn("/unused")
            .fail(function(ex, data) {
                assert.strictEqual(ex.problem, null, "got null problem");
                assert.strictEqual(ex.exit_signal, "TERM", "got signal");
                assert.strictEqual(ex.exit_status, null, "got no status");
                assert.equal(data, "signal data here", "got data even with signal");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                done();
            });
});

QUnit.test("spawn promise recursive", function (assert) {
    assert.expect(7);

    const promise = cockpit.spawn(["/the/path", "arg1", "arg2"]);

    const target = { };
    const promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.input, "function", "promise2.input()");

    const promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.input, "function", "promise3.input()");
});

QUnit.start();
