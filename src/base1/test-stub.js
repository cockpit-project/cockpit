/* global $, cockpit, QUnit, WebSocket */

/* Tell cockpit to use an alternate url to connect to test-server */
window.mock.url = cockpit.transport.uri();
window.mock.url += "?cockpit-stub";

function internal_test(assert, options) {
    let done = assert.async();
    assert.expect(2);
    var dbus = cockpit.dbus(null, options);
    dbus.call("/", "org.freedesktop.DBus.Introspectable", "Introspect")
            .done(function(resp) {
                assert.ok(String(resp[0]).indexOf("<node") !== -1, "introspected internal");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "called internal");
                done();
            });
}

QUnit.test("internal dbus", function (assert) {
    internal_test(assert, { "bus": "internal" });
});

QUnit.test("internal dbus bus none", function (assert) {
    internal_test(assert, { "bus": "none" });
});

QUnit.test("internal dbus bus none with address", function (assert) {
    internal_test(assert, { "bus": "none", "address": "internal" });
});

QUnit.test("echo", function (assert) {
    let done = assert.async();
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
            done();
        }
    });

    $(channel).on("message", function(ev, payload) {
        assert.strictEqual(payload, "the payload", "got the right payload");
        channel.control({ command: "done" });
    });

    assert.strictEqual(channel.binary, false, "not binary");
    channel.send("the payload");
});

QUnit.test("http", function (assert) {
    let done = assert.async();
    assert.expect(2);

    cockpit.http({ "internal": "/test-server" }).get("/pkg/playground/manifest.json.in")
            .done(function(data) {
                assert.deepEqual(JSON.parse(data), {
                    version: "@VERSION@",
                    requires: {
                        cockpit: "122"
                    },
                    tools: {
                        'exception': {
                            label: 'Exceptions'
                        },
                        'patterns': {
                            label: "Design Patterns",
                            path: "jquery-patterns.html"
                        },
                        'react-patterns': {
                            label: "React Patterns"
                        },
                        'translate': {
                            label: "Translating"
                        },
                        'pkgs': {
                            label: "Packages"
                        }
                    }
                }, "returned right data");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("internal dbus environment", function (assert) {
    let done = assert.async();
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "internal" });
    var proxy = dbus.proxy("cockpit.Environment", "/environment");
    proxy.wait(function () {
        assert.ok(typeof proxy.Variables["PATH"] === 'string', "has PATH environment var");
        done();
    });
});

QUnit.test("internal user dbus", function (assert) {
    let done = assert.async();
    assert.expect(4);

    var dbus = cockpit.dbus(null, { "bus": "internal" });
    dbus.call("/user", "org.freedesktop.DBus.Properties",
              "GetAll", [ "cockpit.User" ],
              { "type": "s" })
            .fail(function(ex) {
                assert.ok(ex.message.indexOf("No such interface") == 0, "unexpected error: " + ex.message);
                assert.ok(ex.message.indexOf("org.freedesktop.DBus.Properties") > 0, "unexpected error: " + ex.message);
                assert.ok(ex.message.indexOf("/user") > 0, "unexpected error: " + ex.message);
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "finished successfuly");
                done();
            });
});

QUnit.test("not supported types", function (assert) {
    let done = assert.async();
    var failures = 7;
    var seen = 0;
    assert.expect(failures);

    function failed(ev, ex) {
        assert.equal(ex.problem, "not-supported", "not-supported");
        seen++;
        if (failures == seen)
            done();
    }

    var flist = cockpit.channel({ "payload":"fslist1", "path":"/foo" });
    $(flist).on("close", failed);

    var fwatch = cockpit.channel({ "payload":"fswatch1", "path":"/foo" });
    $(fwatch).on("close", failed);

    var file = cockpit.channel({ "payload":"fsread1", "path":"/foo" });
    $(file).on("close", failed);

    var freplace = cockpit.channel({ "payload":"fsreplace1", "path":"/foo" });
    $(freplace).on("close", failed);

    var spawn = cockpit.channel({ "payload":"stream", "spawn":["sh", "-c", "echo"] });
    $(spawn).on("close", failed);

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    $(dbus).on("close", failed);

    var metrics = cockpit.channel({ payload: "metrics1",
                                    interval: 1000,
                                    source: "internal" });
    $(metrics).on("close", failed);

    window.setTimeout(function () {
        done();
    }, 5000);
});

QUnit.test("external channel websocket", function (assert) {
    let done = assert.async();
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
        done();
    };
});

QUnit.start();
