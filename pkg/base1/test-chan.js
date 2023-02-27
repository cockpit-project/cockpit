import cockpit from "cockpit";
import QUnit from "qunit-tests";

/* Set this to a regexp to ignore that warning once */
function console_ignore_log(exp) {
    const console_log = console.log;
    console.log = function() {
        if (!exp.exec(arguments[0]))
            console_log.apply(console, arguments);
        console.log = console_log;
    };
}

/* The other end of the mock websocket */
function MockPeer() {
    const self = this;
    const echos = { };
    const nulls = { };
    const queue = [];
    let pending = false;

    cockpit.event_target(this);

    /* These are events */
    self.onopen = function(event) { };
    self.onrecv = function(event, channel, payload) {
        /* A rudimentary echo channel implementation */
        if (channel) {
            if (channel in echos || channel in nulls)
                queue.push([channel, payload]);
        } else {
            const command = JSON.parse(payload);
            if (command.command == "open") {
                let reply;
                if (command.payload == "echo") {
                    echos[command.channel] = true;
                    reply = {
                        command: "ready",
                        channel: command.channel
                    };
                } else if (command.payload == "null") {
                    nulls[command.channel] = true;
                    reply = {
                        command: "ready",
                        channel: command.channel
                    };
                } else {
                    reply = {
                        command: "close",
                        channel: command.channel,
                        problem: "not-supported",
                    };
                }
                queue.push([null, JSON.stringify(reply)]);
            } else if (command.command == "close") {
                delete echos[command.channel];
                delete nulls[command.channel];
            }
        }

        if (queue.length && !pending) {
            pending = true;
            window.setTimeout(function() {
                while (queue.length) {
                    self.send.apply(self, queue.shift());
                }
                pending = false;
            }, 0);
        }
    };

    /* Methods filled in by MockWebSocket */
    self.send = function(channel, payload) { throw Error("not reached") };
    self.close = function(options) { throw Error("not reached") };
}

window.mock = { url: "ws://url" };
let force_default_host = null;
let mock_peer = new MockPeer();

QUnit.testDone(function() {
    mock_peer = new MockPeer();
    cockpit.transport.close();
});

/* Mock WebSocket */
function MockWebSocket(url, protocol) {
    if (typeof url != "string")
        throw Error("WebSocket(@url) is not a string: " + typeof url);
    if (typeof protocol != "string")
        throw Error("WebSocket(@protocol) is not a string: " + typeof protocol);

    this.onopen = function(event) { };
    this.onclose = function(event) { };
    this.onmessage = function(event) { };
    this.onerror = function(event) { };
    this.readyState = 0;
    this.url = url;
    this.protocol = protocol;
    this.extensions = "";
    this.binaryType = null;

    const ws = this;
    const mock = mock_peer;

    this.send = function(data) {
        if (typeof data != "string")
            throw Error("WebSocket.send(@data) is not a string: " + typeof data);
        const pos = data.indexOf("\n");
        if (pos == -1)
            throw Error("Invalid frame sent to WebSocket: " + data);
        const channel = data.substring(0, pos);
        const payload = data.substring(pos + 1);
        window.setTimeout(function() { mock.dispatchEvent("recv", channel, payload) }, 5);
    };

    this.close = function(code, reason) {
        if (typeof code != "number" && typeof code != "undefined")
            throw Error("WebSocket.close(@code) is not a number: " + typeof code);
        if (typeof reason != "string" && typeof reason != "undefined")
            throw Error("WebSocket.close(@reason) is not a number: " + typeof string);
        if (this.readyState > 1)
            throw Error("WebSocket.close() called on a closed WebSocket" + this.readyState + " " + code + reason);
        this.readyState = 3;
        this.onclose({ name: "close", code: code || 1000, reason, wasClean: true });
    };

    /* Instantiate the global mock peer */
    const sending = [];
    mock.send = function(channel, payload) {
        if (!channel)
            channel = "";
        const event = {
            name: "message",
            data: channel.toString() + "\n" + payload
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
            ws.close(options.reason ? 1000 : 1011, options.reason || "");
        }, 5);
    };

    /* Open shortly */
    window.setTimeout(function() {
        ws.readyState = 1;
        mock.dispatchEvent("open");
        ws.onopen({ name: "open" });
        const init = {
            command: "init",
            version: 1,
            "channel-seed": "test",
            "csrf-token": "the-csrf-token",
            user: {
                user: "scruffy",
                name: "Scruffy the Janitor"
            },
            system: {
                version: "zero.point.zero",
                build: "nasty stuff",
            }
        };
        if (force_default_host)
            init.host = force_default_host;
        force_default_host = null;
        ws.onmessage({ data: "\n" + JSON.stringify(init) });
    }, 5);
}

WebSocket = MockWebSocket; // eslint-disable-line no-global-assign

function check_transport (assert, base_url, application, socket, url_root) {
    const old_url = window.mock.url;
    const arr = [base_url];
    if (base_url.slice(-1) == '/')
        arr.push(base_url + "other");
    else
        arr.push(base_url + '/', base_url + '/other');

    window.mock.url = null;
    window.mock.url_root = url_root;
    for (let i = 0; i < arr.length; i++) {
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

QUnit.test("public api", function (assert) {
    const channel = cockpit.channel({ host: "host.example.com" });
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

    check_transport(assert, '/', 'cockpit', '/cockpit/socket');
    check_transport(assert, '/cockpit', 'cockpit', '/cockpit/socket');
    check_transport(assert, '/cockpitother/', 'cockpit', '/cockpit/socket');
    check_transport(assert, '/cockpita+pplication/', 'cockpit', '/cockpit/socket');
    check_transport(assert, '/cockpit+application', 'cockpit+application', '/cockpit+application/socket');
    check_transport(assert, '/=machine', 'cockpit+=machine', '/cockpit+=machine/socket');
    check_transport(assert, '/url-root', 'cockpit', '/url-root/cockpit/socket', 'url-root');
    check_transport(assert, '/url-root/cockpit', 'cockpit', '/url-root/cockpit/socket', 'url-root');
    check_transport(assert, '/url-root/cockpit+application', 'cockpit+application',
                    '/url-root/cockpit+application/socket', 'url-root');
    check_transport(assert, '/url-root/=machine', 'cockpit+=machine', '/url-root/cockpit+=machine/socket', 'url-root');
});

QUnit.test("open channel", function (assert) {
    const done = assert.async();
    assert.expect(8);

    const channel = cockpit.channel({ host: "scruffy" });
    let is_inited = false;
    mock_peer.addEventListener("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const command = JSON.parse(payload);
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
            done();
        }
    });
});

QUnit.test("multiple", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const channel = cockpit.channel({ host: "scruffy" });
    const channelb = cockpit.channel({ host: "amy" });

    const onrecv = event => {
        mock_peer.removeEventListener("recv", onrecv);
        assert.notStrictEqual(channel.id, channelb.id, "channels have different ids");
        done();
    };
    mock_peer.addEventListener("recv", onrecv);
});

QUnit.test("open no host", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const channel = cockpit.channel({ });
    assert.ok(channel);
    mock_peer.addEventListener("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const command = JSON.parse(payload);
        if (command.command == "open") {
            assert.strictEqual(command.host, undefined, "host not included");
            done();
        }
    });
});

QUnit.test("open auto host", function (assert) {
    const done = assert.async();
    assert.expect(3);

    force_default_host = "planetexpress";
    const channel = cockpit.channel({ });
    assert.ok(channel);
    mock_peer.addEventListener("open", function(event) {
        assert.ok(true, "websocket connected");
    });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const command = JSON.parse(payload);
        if (command.command == "open") {
            assert.strictEqual(command.host, "planetexpress", "host automatically chosen");
            done();
        }
    });
});

QUnit.test("send message", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const channel = cockpit.channel({ });
    mock_peer.addEventListener("open", function(event) {
        channel.send("Scruffy gonna die the way he lived");
    });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        /* Ignore the open and init messages */
        if (!chan)
            return;
        assert.strictEqual(chan, channel.id, "sent with correct channel");
        assert.equal(payload, "Scruffy gonna die the way he lived", "sent the right payload");
        done();
    });
});

QUnit.test("queue messages", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const sentence = [];
    const channel = cockpit.channel({ });
    channel.send("Scruffy");
    channel.send("knows");
    channel.send("he");
    channel.send("rules");
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        if (!chan)
            return; /* ignore control messages */
        sentence.push(payload);
        if (sentence.length === 4) {
            assert.equal(sentence.join(" "), "Scruffy knows he rules", "messages queued and sent correctly");
            done();
        }
    });
});

QUnit.test("receive message", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const onrecv = (event, chan, payload) => {
        const cmd = JSON.parse(payload);
        if (cmd.command == "open") {
            mock_peer.removeEventListener("recv", onrecv);
            mock_peer.send(channel.id, "Oh, marrrrmalade!");
        }
    };
    mock_peer.addEventListener("recv", onrecv);

    const channel = cockpit.channel({ });
    channel.addEventListener("message", function(event, message) {
        assert.equal(message, "Oh, marrrrmalade!", "got right message in channel");
        done();
    });
});

QUnit.test("close channel", function (assert) {
    const done = assert.async(2);
    assert.expect(4);

    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close();
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.strictEqual(cmd.channel, channel.id, "correct channel");
        mock_peer.send("", payload);
        done();
    });
    const channel = cockpit.channel({ });
    channel.addEventListener("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.ok(!options.problem, "no problem");
        done();
    });
});

QUnit.test("close early", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const channel = cockpit.channel({ });
    channel.addEventListener("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "yo", "got problem");
        done();
    });
    channel.close("yo");
    assert.strictEqual(channel.valid, false, "no longer valid");
});

QUnit.test("close problem", function (assert) {
    const done = assert.async();
    assert.expect(5);

    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close({ problem: "problem" });
            assert.strictEqual(channel.valid, false, "no longer valid");
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.equal(cmd.problem, "problem", "sent reason");
        done();
    });
    const channel = cockpit.channel({ });
    channel.addEventListener("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "problem", "set");
    });
});

QUnit.test("close problem string", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const channel = cockpit.channel({ });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const cmd = JSON.parse(payload);
        if (cmd.command == "init") {
            return;
        } else if (cmd.command == "open") {
            channel.close("testo");
            assert.strictEqual(channel.valid, false, "no longer valid");
            return;
        }
        assert.equal(cmd.command, "close", "sent close command");
        assert.equal(cmd.problem, "testo", "sent reason");
        done();
    });
    channel.addEventListener("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "testo", "set");
    });
});

QUnit.test("close peer", function (assert) {
    const done = assert.async();
    assert.expect(5);

    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const msg = JSON.parse(payload);
        if (msg.command == "init")
            return;
        const cmd = {
            command: "close",
            channel: channel.id,
            problem: "marmalade",
            extra: 5
        };
        mock_peer.send("", JSON.stringify(cmd));
    });

    const channel = cockpit.channel({ });
    const channelb = cockpit.channel({ });

    channel.addEventListener("close", function(event, options) {
        assert.ok(true, "triggered event");
        assert.equal(options.problem, "marmalade", "received reason");
        assert.equal(options.extra, 5, "received extra");
        assert.strictEqual(channel.valid, false, "became invalid");
        assert.strictEqual(channelb.valid, true, "correct channel");
        done();
    });
});

QUnit.test("close socket", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const channel = cockpit.channel({ });
    const channelb = cockpit.channel({ });

    channel.addEventListener("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channel.valid, false, "channel is invalid");
        if (!channel.valid && !channelb.valid)
            done();
    });

    channelb.addEventListener("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channelb.valid, false, "other channel invalid");
        if (!channel.valid && !channelb.valid)
            done();
    });

    mock_peer.close();
});

QUnit.test("wait ready", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const channel = cockpit.channel({ payload: "echo" });
    channel.wait().then(function(options) {
        assert.ok(true, "channel is ready");
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "ready", "wait is ready");
        assert.strictEqual(channel.valid, true, "when valid");
    }, function() {
        assert.ok(false, "should not fail");
    })
            .always(function() {
                done();
            });
});

QUnit.test("wait close", function (assert) {
    const done = assert.async();
    assert.expect(6);

    const channel = cockpit.channel({ payload: "unsupported" });
    channel.wait().then(function() {
        assert.ok(false, "should not succeed");
    }, function(options) {
        assert.ok(true, "channel is closed");
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "close", "wait is close");
        assert.equal(options.problem, "not-supported", "wait options has fields");
        assert.strictEqual(channel.valid, false, "channel not valid");
    })
            .always(function() {
                done();
            });
});

QUnit.test("wait callback", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const channel = cockpit.channel({ payload: "unsupported" });
    channel.wait(function(options) {
        assert.equal(typeof options, "object", "wait options");
        assert.ok(!!options, "wait options not null");
        assert.equal(options.command, "close", "wait is close");
        assert.equal(options.problem, "not-supported", "wait options has fields");
        assert.strictEqual(channel.valid, false, "channel not valid");
    }).always(function() {
        done();
    });
});

QUnit.test("logout", function (assert) {
    const done = assert.async();
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const cmd = JSON.parse(payload);
        if (cmd.command == "logout") {
            mock_peer.close("disconnected");
            assert.strictEqual(cmd.disconnect, true, "disconnect set");
        }
    });

    let channel = cockpit.channel({ payload: "echo" });
    let channelb = cockpit.channel({ payload: "echo" });

    channel.addEventListener("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channel.valid, false, "channel is invalid");
        channel = null;
        if (channel === null && channelb === null)
            done();
    });

    channelb.addEventListener("close", function(event, options) {
        assert.equal(options.problem, "disconnected", "received reason");
        assert.strictEqual(channelb.valid, false, "other channel invalid");
        channelb = null;
        if (channel === null && channelb === null)
            done();
    });

    cockpit.logout(false);
});

QUnit.test("droppriv", function (assert) {
    const done = assert.async();
    assert.expect(1);
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        const cmd = JSON.parse(payload);
        if (cmd.command == "logout") {
            assert.strictEqual(cmd.disconnect, false, "disconnect not set");
            done();
        }
    });

    cockpit.drop_privileges();
});

QUnit.test("info", function (assert) {
    const done = assert.async();
    assert.expect(4);

    let info_changed = false;

    const onchanged = () => {
        assert.strictEqual(cockpit.info.version, "zero.point.zero", "cockpit.info.version");
        assert.strictEqual(cockpit.info.build, "nasty stuff", "cockpit.info.build");
        info_changed = true;
    };
    cockpit.info.addEventListener("changed", onchanged);

    const onrecv = (event, chan, payload) => {
        const cmd = JSON.parse(payload);
        if (cmd.command == "open") {
            mock_peer.removeEventListener("recv", onrecv);
            cockpit.info.removeEventListener("changed", onchanged);
            assert.strictEqual(info_changed, true, "info changed event was called");
            done();
        }
    };
    mock_peer.addEventListener("recv", onrecv);

    const channel = cockpit.channel({ host: "scruffy" });
    assert.ok(channel);
});

QUnit.test("send after close", function (assert) {
    const done = assert.async();
    assert.expect(1);

    console_ignore_log(/sending message on closed.*/);

    let received_message = false;
    const channel = cockpit.channel({ });
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        if (chan)
            received_message = true;
    });

    channel.close();
    channel.send("Dern it.");

    window.setTimeout(function() {
        assert.ok(!received_message, "didn't send message");
        done();
    }, 50);
});

QUnit.test("ignore other commands", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const channel = cockpit.channel({ payload: "echo" });

    console_ignore_log(/unhandled control message.*/);

    mock_peer.send(0, JSON.stringify({ command: "ping" }));
    mock_peer.send(0, JSON.stringify({ command: "unexpected" }));

    window.setTimeout(function() {
        assert.ok(channel.valid, "other messages didn't screw up channel");
        done();
    }, 50);
});

QUnit.test("filter message in", function (assert) {
    const done = assert.async();
    assert.expect(14);

    let filtered = 0;
    let filtering = true;
    cockpit.transport.filter(function(message, channelid, control) {
        if (!filtering)
            return true;
        if (message[0] == '\n') {
            assert.strictEqual(channelid, "", "control message channel");
            assert.equal(typeof control, "object", "control is a JSON object");
            assert.equal(typeof control.command, "string", "control has a command");
            return true;
        } else {
            assert.strictEqual(channelid, channel.id, "cockpit channel id");
            assert.equal(control, undefined, "control is undefined");
            filtered += 1;
            return (filtered != 1);
        }
    });

    let received = 0;
    const channel = cockpit.channel({ payload: "echo" });
    channel.addEventListener("message", function(data) {
        received += 1;

        if (received == 2) {
            assert.equal(filtered, 3, "filtered right amount");
            assert.equal(received, 2, "let through right amount");
            channel.close();
            filtering = false;
            done();
        }
    });

    channel.send("one");
    channel.send("two");
    channel.send("three");
});

QUnit.test("filter message out", function (assert) {
    const done = assert.async();
    assert.expect(10);

    let filtered = 0;
    let filtering = true;
    cockpit.transport.filter(function(message, channelid, control) {
        if (!filtering)
            return true;
        if (message[0] == '\n') {
            assert.strictEqual(channelid, "", "control message channel");
            assert.equal(typeof control, "object", "control is a JSON object");
            assert.equal(typeof control.command, "string", "control has a command");
        } else {
            assert.strictEqual(channelid, channel.id, "cockpit channel id");
            assert.equal(control, undefined, "control is undefined");
            filtered += 1;

            if (filtered != 1) {
                channel.close();
                filtering = false;
                done();
                return false;
            }

            return true;
        }
        return false;
    }, true);

    const channel = cockpit.channel({ payload: "null" });
    channel.send("one");
    channel.send("two");
    channel.send("three");
});

QUnit.test("inject message out", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const ret = cockpit.transport.inject("bree\nyellow");
    assert.equal(ret, false, "failure returns false");

    let first = true;
    mock_peer.addEventListener("recv", function(event, chan, payload) {
        if (first) {
            const ret = cockpit.transport.inject("bree\nyellow");
            assert.equal(ret, true, "returned true");
            first = false;
            return;
        }

        if (chan) {
            assert.equal(chan, "bree", "right channel");
            assert.equal(payload, "yellow", "right payload");
            channel.close();
            done();
        }
    });

    const channel = cockpit.channel({ });
});

QUnit.test("inject message in", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const channel = cockpit.channel({ payload: "null" });
    channel.addEventListener("control", function(ev, control) {
        if (control.command == "ready") {
            const payload = JSON.stringify({ command: "blah", blah: "marmalade", channel: channel.id });
            const ret = cockpit.transport.inject("\n" + payload, false);
            assert.equal(ret, true, "returned true");
        } else {
            assert.equal(control.command, "blah", "got right control message");
            assert.equal(control.blah, "marmalade", "got right control data");
            channel.close();
            done();
        }
    });
});

QUnit.test("transport options", function (assert) {
    const done = assert.async();
    assert.expect(3);

    mock_peer.addEventListener("recv", function(event, chan, payload) {
        if (chan) {
            assert.equal(typeof cockpit.transport.options, "object", "is an object");
            assert.deepEqual(cockpit.transport.options, {
                command: "init",
                version: 1,
                "channel-seed": "test",
                "csrf-token": "the-csrf-token",
                user: {
                    user: "scruffy",
                    name: "Scruffy the Janitor"
                },
                system: {
                    version: "zero.point.zero",
                    build: "nasty stuff",
                }
            }, "is correct");
            assert.equal(cockpit.transport.csrf_token, "the-csrf-token", "got csrf token");
            channel.close();
            done();
        }
    });

    const channel = cockpit.channel({ });
    channel.send("blah");
});

QUnit.test("message", function (assert) {
    assert.expect(4);
    assert.strictEqual(cockpit.message("terminated"), "Your session has been terminated.", "problem code");
    assert.strictEqual(cockpit.message({ problem: "timeout" }), "Connection has timed out.", "problem property");
    assert.strictEqual(cockpit.message({ message: "The message", problem: "blah" }), "The message", "problem property");
    assert.strictEqual(cockpit.message(55), "55", "invalid input");
});

window.location.hash = "";
QUnit.start();
