/* global $, cockpit, QUnit, WebSocket:true */

/* To help with future migration */
var assert = QUnit;

/* Set this to a regexp to ignore that warning once */
function console_ignore_log(exp) {
    var console_log = console.log;
    console.log = function() {
        if (!exp.exec(arguments[0]))
            console_log.apply(console, arguments);
        console.log = console_log;
    };
}

/* The other end of the mock websocket */
function MockPeer() {
    var self = this;
    var echos = { };

    /* These are events */
    self.onopen = function(event) { };
    self.onrecv = function(event, channel, payload) {
        var command;

        /* A rudimentary echo channel implementation */
        if (channel) {
            if (channel in echos)
                self.send(channel, payload);
            return;
        }

        command = JSON.parse(payload);
        if (command.command == "open") {
            if (command.payload == "echo") {
                echos[command.channel] = true;
                self.send(null, JSON.stringify({
                    "command": "ready",
                    "channel": command.channel
                }));
            } else {
                self.send(null, JSON.stringify({
                    "command": "close",
                    "channel": command.channel,
                    "problem": "not-supported",
                }));
            }
        } else if (command.command == "close") {
            delete echos[command.channel];
        }
    };

    /* Methods filled in by MockWebSocket */
    self.send = function(channel, payload) { throw "not reached"; };
    self.close = function(options) { throw "not reached"; };
}

window.mock = { url: "ws://url" };
var force_default_host = null;
var mock_peer = new MockPeer();

QUnit.testDone(function() {
    mock_peer = new MockPeer();
    cockpit.transport.close();
});

/* Mock WebSocket */
function MockWebSocket(url, protocol) {
    if (typeof url != "string")
        throw "WebSocket(@url) is not a string: " + typeof url;
    if (typeof protocol != "string")
        throw "WebSocket(@protocol) is not a string: " + typeof protocol;

    this.onopen = function(event) { };
    this.onclose = function(event) { };
    this.onmessage = function(event) { };
    this.onerror = function(event) { };
    this.readyState = 0;
    this.url = url;
    this.protocol = protocol;
    this.extensions = "";
    this.binaryType = null;

    var ws = this;
    var mock = mock_peer;

    this.send = function(data) {
        if (typeof data != "string")
            throw "WebSocket.send(@data) is not a string: " + typeof data;
        var pos = data.indexOf("\n");
        if (pos == -1)
            throw "Invalid frame sent to WebSocket: " + data;
        var channel = data.substring(0, pos);
        var payload = data.substring(pos + 1);
        window.setTimeout(function() { $(mock).triggerHandler("recv", [channel, payload]); }, 5);
    };

    this.close = function(code, reason) {
        if (typeof code != "number" && typeof code != "undefined")
            throw "WebSocket.close(@code) is not a number: " + typeof code;
        if (typeof reason != "string" && typeof reason != "undefined")
            throw "WebSocket.close(@reason) is not a number: " + typeof string;
        if (this.readyState > 1)
            throw "WebSocket.close() called on a closed WebSocket" + this.readyState + " " + code + reason;
        this.readyState = 3;
        this.onclose({"name": "close", "code": code || 1000, "reason": reason, "wasClean": true });
    };

    /* Instantiate the global mock peer */
    var sending = [ ];
    mock.send = function(channel, payload) {
        if (!channel)
            channel = "";
        var event = {
            "name": "message",
            "data": channel.toString() + "\n" + payload
        };
        sending.push(event);
        window.setTimeout(function() {
            if (ws.readyState == 1)
                ws.onmessage(sending.shift());
        }, 5);
    };

    mock.close = function(options) {
        if (!options)
            options = { };
        window.setTimeout(function() {
            ws.close(options.reason && 1000 || 1011, options.reason || "");
        }, 5);
    };

    /* Open shortly */
    window.setTimeout(function() {
        ws.readyState = 1;
        $(mock).triggerHandler("open");
        ws.onopen({"name": "open"});
        var init = {
            "command": "init",
            "version": 1,
            "channel-seed": "test",
            "csrf-token": "the-csrf-token",
            "user": {
                "user": "scruffy",
                "name": "Scruffy the Janitor"
            },
            "system": {
                "version": "zero.point.zero",
                "build": "nasty stuff",
            }
        };
        if (force_default_host)
            init["host"] = force_default_host;
        force_default_host = null;
        ws.onmessage({"data": "\n" + JSON.stringify(init)});
    }, 5);
}

WebSocket = MockWebSocket;

function check_transport (base_url, application, socket, url_root) {
    var old_url = window.mock.url;
    var i;
    var arr = [base_url];
    if (base_url.slice(-1) == '/')
        arr.push(base_url + "other");
    else
        arr.push(base_url + '/', base_url + '/other');

    window.mock.url = null;
    window.mock.url_root = url_root;
    for (i = 0; i < arr.length; i++) {
        window.mock.pathname = arr[i];
        assert.equal(cockpit.transport.application(), application,
              arr[i] + " transport.application is " + socket);
        assert.equal(cockpit.transport.uri(), "ws://" + window.location.host + socket,
              arr[i] + " transport.uri is " + socket);
    }

    window.mock.url = old_url;
    window.mock.url_root = null;
    window.mock.pathname = null;
}

QUnit.test("public api", function() {
    var channel = cockpit.channel({ "host": "host.example.com" });
    assert.equal(typeof channel, "object", "cockpit.channel() constructor");
    assert.equal(channel.options.host, "host.example.com", "channel.options is dict");
    assert.ok(channel.id !== undefined, "channel.id is a field");
    assert.ok(channel.toString().indexOf("host.example.com") > 0, "channel.toString()");
    assert.equal(typeof channel.send, "function", "channel.send() is a function");
    assert.equal(typeof channel.close, "function", "channel.close() is a function");
    assert.strictEqual(channel.valid, true, "channel.valid is set");
    assert.equal(typeof cockpit.logout, "function", "cockpit.logout is a function");
    assert.equal(typeof cockpit.transport, "object", "cockpit.transport is an object");
    assert.equal(typeof cockpit.transport.close, "function", "cockpit.transport.close is a function");
    assert.equal(typeof cockpit.transport.options, "object", "cockpit.transport.options is a object");

    if (window.location.origin)
        assert.equal(cockpit.transport.origin, window.location.origin, "cockpit.transport.origin is correct");
    else
        assert.equal(typeof cockpit.transport.origin, "string", "cockpit.transport.origin is present");

    check_transport ('/', 'cockpit', '/cockpit/socket');
    check_transport ('/cockpit', 'cockpit', '/cockpit/socket');
    check_transport ('/cockpitother/', 'cockpit', '/cockpit/socket');
    check_transport ('/cockpita+pplication/', 'cockpit', '/cockpit/socket');
    check_transport ('/cockpit+application', 'cockpit+application', '/cockpit+application/socket');
    check_transport ('/=machine', 'cockpit+=machine', '/cockpit+=machine/socket');
    check_transport ('/url-root', 'cockpit', '/url-root/cockpit/socket', 'url-root');
    check_transport ('/url-root/cockpit', 'cockpit', '/url-root/cockpit/socket', 'url-root');
    check_transport ('/url-root/cockpit+application', 'cockpit+application',
                     '/url-root/cockpit+application/socket', 'url-root');
    check_transport ('/url-root/=machine', 'cockpit+=machine', '/url-root/cockpit+=machine/socket', 'url-root');
});

QUnit.asyncTest("open channel", function() {
    assert.expect(8);

    var channel = cockpit.channel({ "host": "scruffy" });
    var is_inited = false;
    $(mock_peer).on("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    $(mock_peer).on("recv", function(event, chan, payload) {
        var command = JSON.parse(payload);
        if (!is_inited) {
            assert.equal(typeof command, "object", "valid json");
            assert.strictEqual(chan, "", "sent with empty channel");
            assert.equal(command.command, "init", "got init");
            assert.equal(command.version, 1, "got init version");
            is_inited = true;
        } else {
            assert.equal(command.command, "open", "right command");
            assert.strictEqual(command.channel, channel.id, "contains right channel");
            assert.equal(command.host, "scruffy", "host as expected");
            QUnit.start();
        }
    });
});

QUnit.asyncTest("multiple", function() {
    assert.expect(1);

    var channel = cockpit.channel({ "host": "scruffy" });
    var channelb = cockpit.channel({ "host": "amy" });

    $(mock_peer).on("recv", function(event) {
        $(mock_peer).off("recv");
        assert.notStrictEqual(channel.id, channelb.id, "channels have different ids");
        QUnit.start();
    });
});

QUnit.asyncTest("open no host", function() {
    assert.expect(2);

    var channel = cockpit.channel({ });
    $(mock_peer).on("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    $(mock_peer).on("recv", function(event, chan, payload) {
        var command = JSON.parse(payload);
        if (command.command == "open") {
            assert.strictEqual(command.host, undefined, "host not included");
            QUnit.start();
        }
    });
});

QUnit.asyncTest("open auto host", function() {
    assert.expect(2);

    force_default_host = "planetexpress";
    var channel = cockpit.channel({ });
    $(mock_peer).on("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    $(mock_peer).on("recv", function(event, chan, payload) {
        var command = JSON.parse(payload);
        if (command.command == "open") {
            assert.strictEqual(command.host, "planetexpress", "host automatically chosen");
            QUnit.start();
        }
    });
});

QUnit.asyncTest("send message", function() {
    assert.expect(2);

    var channel = cockpit.channel({ });
    $(mock_peer).on("open", function(event) {
	channel.send("Scruffy gonna die the way he lived");
    });
    $(mock_peer).on("recv", function(event, chan, payload) {
        /* Ignore the open and init messages */
        if (!chan)
            return;
        assert.strictEqual(chan, channel.id, "sent with correct channel");
        assert.equal(payload, "Scruffy gonna die the way he lived", "sent the right payload");
        QUnit.start();
    });
});

QUnit.asyncTest("queue messages", function() {
    assert.expect(1);

    var sentence = [];
    var channel = cockpit.channel({ });
    channel.send("Scruffy");
    channel.send("knows");
    channel.send("he");
    channel.send("rules");
    $(mock_peer).on("recv", function(event, chan, payload) {
        if (!chan)
            return; /* ignore control messages */
        sentence.push(payload);
        if (sentence.length === 4) {
            assert.equal(sentence.join(" "), "Scruffy knows he rules", "messages queued and sent correctly");
            QUnit.start();
        }
    });
});

QUnit.asyncTest("receive message", function() {
    assert.expect(1);

    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "open") {
            $(mock_peer).off("recv");
            mock_peer.send(channel.id, "Oh, marrrrmalade!");
        }
    });

    var channel = cockpit.channel({ });
    $(channel).on("message", function(event, message) {
        assert.equal(message, "Oh, marrrrmalade!", "got right message in channel");
        QUnit.start();
    });
});

QUnit.asyncTest("close channel", function() {
    assert.expect(4);

    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close();
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.strictEqual(cmd.channel, channel.id, "correct channel");
        mock_peer.send("", payload);
    });
    var channel = cockpit.channel({ });
    $(channel).on("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.ok(!options.problem, "no problem");
        QUnit.start();
    });
});

QUnit.asyncTest("close early", function() {
    assert.expect(3);

    var channel = cockpit.channel({ });
    $(channel).on("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "yo", "got problem");
        QUnit.start();
    });
    channel.close("yo");
    assert.strictEqual(channel.valid, false, "no longer valid");
});

QUnit.asyncTest("close problem", function() {
    assert.expect(5);

    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close({"problem": "problem"});
            assert.strictEqual(channel.valid, false, "no longer valid");
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.equal(cmd.problem, "problem", "sent reason");
        QUnit.start();
    });
    var channel = cockpit.channel({ });
    $(channel).on("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "problem", "set");
    });
});

QUnit.asyncTest("close problem string", function() {
    assert.expect(5);

    var channel = cockpit.channel({ });
    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close("testo");
            assert.strictEqual(channel.valid, false, "no longer valid");
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.equal(cmd.problem, "testo", "sent reason");
        QUnit.start();
    });
    $(channel).on("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "testo", "set");
    });
});

QUnit.asyncTest("close peer", function() {
    assert.expect(5);

    $(mock_peer).on("recv", function(event, chan, payload) {
        var msg = JSON.parse(payload);
        if (msg.command == "init")
            return;
        var cmd = {
            "command": "close",
            "channel": channel.id,
            "problem" : "marmalade",
            "extra": 5
        };
        mock_peer.send("", JSON.stringify(cmd));
    });

    var channel = cockpit.channel({ });
    var channelb = cockpit.channel({ });

    $(channel).on("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "marmalade", "received reason");
        assert.equal(options.extra, 5, "received extra");
        assert.strictEqual(channel.valid, false, "became invalid");
        assert.strictEqual(channelb.valid, true, "correct channel");
        QUnit.start();
    });
});

QUnit.asyncTest("close socket", function() {
    assert.expect(4);

    var channel = cockpit.channel({ });
    var channelb = cockpit.channel({ });

    $(channel).on("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channel.valid, false, "channel is invalid");
        if (!channel.valid && !channelb.valid)
            QUnit.start();
    });

    $(channelb).on("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channelb.valid, false, "other channel invalid");
        if (!channel.valid && !channelb.valid)
            QUnit.start();
    });

    mock_peer.close();
});

QUnit.asyncTest("wait ready", function() {
    assert.expect(5);

    var channel = cockpit.channel({ "payload": "echo" });
    channel.wait().then(function(options) {
        assert.ok(true, "channel is ready");
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "ready", "wait is ready");
        assert.strictEqual(channel.valid, true, "when valid");
    }, function() {
        assert.ok(false, "should not fail");
    }).always(function() {
        QUnit.start();
    });
});

QUnit.asyncTest("wait close", function() {
    assert.expect(6);

    var channel = cockpit.channel({ "payload": "unsupported" });
    channel.wait().then(function() {
        assert.ok(false, "should not succeed");
    }, function(options) {
        assert.ok(true, "channel is closed");
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "close", "wait is close");
        assert.equal(options.problem, "not-supported", "wait options has fields");
        assert.strictEqual(channel.valid, false, "channel not valid");
    }).always(function() {
        QUnit.start();
    });
});

QUnit.asyncTest("wait callback", function() {
    assert.expect(5);

    var channel = cockpit.channel({ "payload": "unsupported" });
    channel.wait(function(options) {
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "close", "wait is close");
        assert.equal(options.problem, "not-supported", "wait options has fields");
        assert.strictEqual(channel.valid, false, "channel not valid");
    }).always(function() {
        QUnit.start();
    });
});

QUnit.asyncTest("logout", function() {
    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "logout") {
            mock_peer.close("disconnected");
            assert.strictEqual(cmd.disconnect, true, "disconnect set");
        }
    });

    var channel = cockpit.channel({ "payload": "echo" });
    var channelb = cockpit.channel({ "payload": "echo" });

    $(channel).on("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channel.valid, false, "channel is invalid");
        channel = null;
        if (channel === null && channelb === null)
            QUnit.start();
    });

    $(channelb).on("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channelb.valid, false, "other channel invalid");
        channelb = null;
        if (channel === null && channelb === null)
            QUnit.start();
    });

    cockpit.logout(false);
});

QUnit.asyncTest("droppriv", function() {
    assert.expect(1);
    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "logout") {
            assert.strictEqual(cmd.disconnect, false, "disconnect not set");
            QUnit.start();
        }
    });

    cockpit.drop_privileges();
});

QUnit.asyncTest("info", function() {
    assert.expect(3);

    var info_changed = false;

    $(cockpit.info).on("changed", function() {
        assert.strictEqual(cockpit.info.version, "zero.point.zero", "cockpit.info.version");
        assert.strictEqual(cockpit.info.build, "nasty stuff", "cockpit.info.build");
        info_changed = true;
    });

    $(mock_peer).on("recv", function(event, chan, payload) {
        var cmd = JSON.parse(payload);
        if (cmd.command == "open") {
            $(mock_peer).off("recv");
            $(cockpit.info).off("changed");
            assert.strictEqual(info_changed, true, "info changed event was called");
            QUnit.start();
        }
    });

    var channel = cockpit.channel({ "host": "scruffy" });
});


QUnit.asyncTest("send after close", function() {
    assert.expect(1);

    console_ignore_log(/sending message on closed.*/);

    var received_message = false;
    var channel = cockpit.channel({ });
    $(mock_peer).on("recv", function(event, chan, payload) {
        if (chan)
            received_message = true;
    });

    channel.close();
    channel.send("Dern it.");

    window.setTimeout(function() {
        assert.ok(!received_message, "didn't send message");
        QUnit.start();
    }, 50);
});

QUnit.asyncTest("ignore other commands", function() {
    assert.expect(1);

    var channel = cockpit.channel({ "payload": "echo" });

    console_ignore_log(/unhandled control message.*/);

    mock_peer.send(0, JSON.stringify({ "command": "ping"}));
    mock_peer.send(0, JSON.stringify({ "command": "unexpected"}));

    window.setTimeout(function() {
        assert.ok(channel.valid, "other messages didn't screw up channel");
        QUnit.start();
    }, 50);
});

QUnit.asyncTest("filter message", function() {
    assert.expect(2);

    var filtered = 0;
    cockpit.transport.filter(function(message, channel, control) {
        if (message[0] != '\n') {
            console.log("filtered", message);
            filtered += 1;
            return (filtered != 1);
        }
    });

    var received = 0;
    var channel = cockpit.channel({ "payload": "echo" });
    $(channel).on("message", function(data) {
        received += 1;

        if (received == 2) {
            assert.equal(filtered, 3, "filtered right amount");
            assert.equal(received, 2, "let through right amount");
            channel.close();
            QUnit.start();
        }
    });

    channel.send("one");
    channel.send("two");
    channel.send("three");
});

QUnit.asyncTest("inject message", function() {
    assert.expect(4);

    var ret = cockpit.transport.inject("bree\nyellow");
    assert.equal(ret, false, "failure returns false");

    var first = true;
    var channel;
    $(mock_peer).on("recv", function(event, chan, payload) {
        if (first) {
            var ret = cockpit.transport.inject("bree\nyellow");
            assert.equal(ret, true, "returned true");
            first = false;
            return;
        }

        if (chan) {
            assert.equal(chan, "bree", "right channel");
            assert.equal(payload, "yellow", "right payload");
            channel.close();
            QUnit.start();
        }
    });

    channel = cockpit.channel({ });
});

QUnit.asyncTest("transport options", function() {
    assert.expect(3);

    var channel;
    $(mock_peer).on("recv", function(event, chan, payload) {
        if (chan) {
            assert.equal(typeof cockpit.transport.options, "object", "is an object");
            assert.deepEqual(cockpit.transport.options, {
                "command": "init",
                "version": 1,
                "channel-seed": "test",
                "csrf-token": "the-csrf-token",
                "user": {
                    "user": "scruffy",
                    "name": "Scruffy the Janitor"
                },
                "system": {
                    "version": "zero.point.zero",
                    "build": "nasty stuff",
                }
            }, "is correct");
            assert.equal(cockpit.transport.csrf_token, "the-csrf-token", "got csrf token");
            channel.close();
            QUnit.start();
        }
    });

    channel = cockpit.channel({ });
    channel.send("blah");
});

var shell = shell || { };

QUnit.test("message", function() {
    assert.expect(4);
    assert.strictEqual(cockpit.message("terminated"), "Your session has been terminated.", "problem code");
    assert.strictEqual(cockpit.message({ problem: "timeout" }), "Connection has timed out.", "problem property");
    assert.strictEqual(cockpit.message({ message: "The message", problem: "blah" }), "The message", "problem property");
    assert.strictEqual(cockpit.message(55), "55", "invalid input");
});

window.location.hash = "";
QUnit.start();
