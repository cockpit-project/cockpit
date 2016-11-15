/* global $, cockpit, QUnit, unescape, escape, WebSocket */

/* To help with future migration */
var assert = QUnit;

/* Tell cockpit to use an alternate url to connect to test-server */
window.mock.url = cockpit.transport.uri();
window.mock.url += "?cockpit-stub";

function internal_test(options) {
    assert.expect(2);
    var dbus = cockpit.dbus(null, options);
    dbus.call("/", "org.freedesktop.DBus.Introspectable", "Introspect")
        .done(function(resp) {
            assert.ok(String(resp[0]).indexOf("<node") !== -1, "introspected internal");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "called internal");
            QUnit.start();
        });
}

QUnit.asyncTest("internal dbus", function() {
    internal_test({"bus": "internal"});
});

QUnit.asyncTest("internal dbus bus none", function() {
    internal_test({"bus": "none"});
});

QUnit.asyncTest("internal dbus bus none with address", function() {
    internal_test({"bus": "none", "address": "internal"});
});

QUnit.asyncTest("echo", function() {
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

QUnit.asyncTest("http", function() {
    assert.expect(2);

    cockpit.http({ "internal": "/test-server" }).get("/pkg/playground/manifest.json")
        .done(function(data) {
            assert.deepEqual(JSON.parse(data), {
                version: "@VERSION@",
                requires: {
                    cockpit: "122"
                },
                tools: {
                    'patterns': {
                        label: "Design Patterns",
                        path: "jquery-patterns.html"
                    },
                    'react-patterns': {
                        label: "React Patterns"
                    },
                    'translate': {
                        label: "Translating"
                    }
                }
            }, "returned right data");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("internal dbus environment", function() {
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "internal" });
    var proxy = dbus.proxy("cockpit.Environment", "/environment");
    proxy.wait(function () {
        assert.ok(typeof proxy.Variables["PATH"] === 'string', "has PATH environment var");
        QUnit.start();
    });
});

QUnit.asyncTest("internal user dbus", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "internal" });
    dbus.call("/user", "org.freedesktop.DBus.Properties",
              "GetAll", [ "cockpit.User" ],
              { "type": "s" })
        .fail(function(ex) {
            assert.equal(ex.message, "No such interface 'org.freedesktop.DBus.Properties' on object at path /user");
        })
        .always(function() {
            assert.equal(this.state(), "rejected", "finished successfuly");
            QUnit.start();
        });
});


QUnit.asyncTest("not supported types", function() {
    var failures = 7;
    var seen = 0;
    assert.expect(failures);

    function failed(ev, ex) {
        assert.equal(ex.problem, "not-supported", "not-supported");
        seen++;
        if (failures == seen)
            QUnit.start();
    }

    var flist = cockpit.channel({"payload":"fslist1","path":"/foo"});
    $(flist).on("close", failed);

    var fwatch = cockpit.channel({"payload":"fswatch1","path":"/foo"});
    $(fwatch).on("close", failed);

    var file = cockpit.channel({"payload":"fsread1","path":"/foo"});
    $(file).on("close", failed);

    var freplace = cockpit.channel({"payload":"fsreplace1","path":"/foo"});
    $(freplace).on("close", failed);

    var spawn = cockpit.channel({"payload":"stream","spawn":["sh","-c","echo"]});
    $(spawn).on("close", failed);

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    $(dbus).on("close", failed);

    var metrics = cockpit.channel({payload: "metrics1",
                                   interval: 1000,
                                   source: "internal"});
    $(metrics).on("close", failed);

    window.setTimeout(function () {
        QUnit.start();
    }, 5000);
});

QUnit.asyncTest("external channel websocket", function() {
    assert.expect(3);

    var query = window.btoa(JSON.stringify({
        payload: "websocket-stream1",
        address: "localhost",
        port: parseInt(window.location.port, 10),
        path: "/cockpit/echosocket/",
    }));

    var count = 0;
    var ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
                           cockpit.transport.csrf_token + '?' + query);
    ws.onopen = function() {
        assert.ok(true, "websocket is open");
        ws.send("oh marmalade");
    };
    ws.onerror = function() {
        assert.ok(false, "websocket error");
    };
    ws.onmessage = function(ev) {
        if (count === 0) {
            assert.equal(ev.data, "OH MARMALADE", "got payload");
            ws.send("another test");
            count += 1;
        } else {
            assert.equal(ev.data, "ANOTHER TEST", "got payload again");
            ws.close(1000);
        }
    };
    ws.onclose = function(ev) {
        QUnit.start();
    };
});

QUnit.start();
