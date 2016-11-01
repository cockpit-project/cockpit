/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

function MockPeer() {
    /*
     * Events triggered here:
     * opened(event, args)
     * recv(event, payload)
     * closed(event, problem)
     */

    var channel = null;

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
        if (typeof(payload) != "string")
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
            $(peer).trigger("recv", [channel, payload]);
        };

        this.close = function(options) {
            console.assert(arguments.length <= 1);
            this.valid = false;
            $(peer).trigger("closed", [channel, options || { }]);
            $(this).triggerHandler("close", [options || { }]);
        };

        QUnit.testDone(function() {
            channel.valid = false;
        });

        $(peer).trigger("opened", [channel, options]);
    }

    cockpit.channel = function(options) {
        channel = new MockChannel(options);
        return channel;
    };
}

function MockSink(expected, callback) {
    var self = this;

    self.samples = [ ];

    function input(beg, items, mapping) {
        for (var i = 0; i < items.length; i++)
            self.samples[beg+i] = items[i];
    }

    self.series = { input: input };
    return self;
}

QUnit.test("non-instanced decompression", function() {
    assert.expect(1);

    var peer = new MockPeer();
    var sink = new MockSink();

    var metrics = cockpit.metrics(1000, { source: "source",
                                          metrics: [ { name: "m1" } ],
                                        });
    metrics.series = sink.series;

    metrics.follow();
    peer.send_json({ timestamp: 0, now: 0, interval: 1000,
                     metrics: [ { name: "m1" } ]
                   });
    peer.send_json([ [ 10 ] ]);
    peer.send_json([ [ ] ]);

    assert.deepEqual(sink.samples, [ [ 10 ], [ 10 ] ], "got correct samples");
});

QUnit.start();
