import cockpit from "cockpit";
import QUnit from "qunit-tests";

function MockPeer() {
    /*
     * Events triggered here:
     * opened(event, args)
     * recv(event, payload)
     * closed(event, problem)
     */
    cockpit.event_target(this);

    let channel = null;

    /* open: triggered when mock Channel is created */
    this.onopened = function(event, channel, options) {
        /* nada */
    };

    /* close event: triggered when mock Channel is closed */
    this.onclosed = function(event, channel, options) {
        /* nada */
    };

    /* send a message from peer back to channel */
    this.send = function(payload) {
        if (typeof (payload) != "string")
            payload = String(payload);
        if (!channel)
            console.log("dropping message before open");
        else if (channel.valid)
            channel.dispatchEvent("message", payload);
        else
            console.log("dropping message after close");
    };

    /* send a object as JSON */
    this.send_json = function(payload) {
        this.send(JSON.stringify(payload));
    };

    /* peer closes the channel */
    this.close = function(channel, options) {
        console.assert(channel);
        if (channel.valid) {
            channel.valid = false;
            channel.dispatchEvent("close", options || { });
        }
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
            peer.dispatchEvent("recv", channel, payload);
        };

        this.close = function(options) {
            console.assert(arguments.length <= 1);
            this.valid = false;
            peer.dispatchEvent("close", channel, options || {});
        };

        QUnit.testDone(function() {
            channel.valid = false;
        });

        peer.dispatchEvent("open", channel, options || {});
    }

    cockpit.channel = function(options) {
        channel = new MockChannel(options);
        return channel;
    };
}

function MockSink(expected, callback) {
    const self = this;

    self.samples = [];

    function input(beg, items, mapping) {
        for (let i = 0; i < items.length; i++)
            self.samples[beg + i] = items[i];
    }

    self.series = { input };
    return self;
}

let old_channel;
QUnit.module("Mock tests", {
    beforeEach: () => {
        old_channel = cockpit.channel;
    },
    afterEach: () => {
        cockpit.channel = old_channel;
    }
});

QUnit.test("non-instanced decompression", assert => {
    assert.expect(1);

    const peer = new MockPeer();
    const sink = new MockSink();

    const metrics = cockpit.metrics(1000, {
        source: "source",
        metrics: [{ name: "m1" }],
    });
    metrics.series = sink.series;

    metrics.follow();
    peer.send_json({
        timestamp: 0,
        now: 0,
        interval: 1000,
        metrics: [{ name: "m1" }]
    });
    peer.send_json([[10]]);
    peer.send_json([[]]);

    assert.deepEqual(sink.samples, [[10], [10]], "got correct samples");
});

QUnit.test("interval validation", assert => {
    assert.expect(2);
    const done = assert.async();
    const metrics_channel = cockpit.channel({
        payload: "metrics1",
        source: "internal",
        interval: -1,
    });

    metrics_channel.addEventListener("close", (_, error) => {
        assert.equal(error.problem, "protocol-error");
        assert.equal(error.message, 'invalid "interval" value: -1');
        done();
    });
});

QUnit.test("metrics validation", assert => {
    assert.expect(2);
    const done = assert.async();
    const metrics_channel = cockpit.channel({
        payload: "metrics1",
        source: "internal",
        interval: 1000,
        metrics: {
            foo: 1
        }
    });

    metrics_channel.addEventListener("close", (_, error) => {
        assert.equal(error.problem, "protocol-error");
        assert.equal(error.message, 'invalid "metrics" option was specified (not an array)');
        done();
    });
});

QUnit.test("metrics object validation", assert => {
    assert.expect(1);
    const done = assert.async();
    const metrics_channel = cockpit.channel({
        payload: "metrics1",
        source: "internal",
        interval: 1000,
        metrics: [
            { name: "nonexistant", derive: "rate" },
        ]
    });

    metrics_channel.addEventListener("close", (_, error) => {
        assert.equal(error.problem, "not-supported");
        done();
    });
});

QUnit.start();
