/* global cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

var dbus = cockpit.dbus(null, { "bus": "internal" });
var dataDir;

/***
 * Tests for parsing on-disk JSON configuration
 */

function machinesParseTest(json, expectedProperty) {
    assert.expect(3);

    cockpit.file(dataDir + "/machines.json").replace(json).
        done(function(tag) {
            dbus.call("/machines", "org.freedesktop.DBus.Properties",
                      "Get", [ "cockpit.Machines", "Machines" ],
                      { "type": "ss" })
                .done(function(reply) {
                    assert.equal(reply[0].t, "a{sa{sv}}", "expected return type");
                    assert.deepEqual(reply[0].v, expectedProperty, "expected property value");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    QUnit.start();
                });
        });
}

QUnit.asyncTest("no machine definitions", function() {
    machinesParseTest(null, {});
});

QUnit.asyncTest("empty json", function() {
    machinesParseTest("", {});
});

QUnit.asyncTest("two definitions", function() {
    machinesParseTest('{"green": {"visible": true, "address": "1.2.3.4"}, ' +
                      ' "9.8.7.6": {"visible": false, "address": "9.8.7.6", "user": "admin"}}',
        { "green": {
            "address": { "t": "s", "v": "1.2.3.4" },
            "visible": { "t": "b", "v": true }
           },
           "9.8.7.6": {
               "address": { "t": "s", "v": "9.8.7.6" },
               "user": { "t": "s", "v": "admin" },
               "visible": { "t": "b", "v": false }
           }
        });
});

QUnit.asyncTest("invalid json", function() {
    machinesParseTest('{"green":', {});
});

QUnit.asyncTest("invalid data types", function() {
    machinesParseTest('{"green": []}', {});
});

/***
 * Tests for Update()
 */

function machinesUpdateTest(origJson, host, props, expectedJson)
{
    assert.expect(3);

    cockpit.file(dataDir + "/machines.json").replace(origJson).
        done(function(tag) {
            dbus.call("/machines", "cockpit.Machines", "Update", [ host, props ], { "type": "sa{sv}" })
                .done(function(reply) {
                    assert.deepEqual(reply, [], "no expected return value");
                    cockpit.file(dataDir + "/machines.json", { syntax: JSON }).read().
                        done(function(content, tag) {
                            assert.deepEqual(content, expectedJson, "expected file content");
                        }).
                        fail(function(err) {
                            assert.equal(err, undefined, "expected no error");
                        }).
                        always(QUnit.start);
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                });
        });
}

QUnit.asyncTest("no config files", function() {
    machinesUpdateTest(null, "green", { "visible": cockpit.variant('b', true), "address": cockpit.variant('s', "1.2.3.4") },
        { "green": { "address": "1.2.3.4", "visible": true } });
});

QUnit.asyncTest("add host to existing map", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
        "blue",
        { "visible": cockpit.variant('b', false), "address": cockpit.variant('s', "9.8.7.6") },
        { "green": { "address": "1.2.3.4", "visible": true },
            "blue":  { "address": "9.8.7.6", "visible": false} });
});

QUnit.asyncTest("change bool host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
        "green",
        { "visible": cockpit.variant('b', false)},
        { "green": { "address": "1.2.3.4", "visible": false } });
});

QUnit.asyncTest("change string host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
        "green",
        { "address": cockpit.variant('s', "fe80::1")},
        { "green": { "address": "fe80::1", "visible": true } });
});

QUnit.asyncTest("add host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
        "green",
        { "color": cockpit.variant('s', "pitchblack")},
        { "green": { "address": "1.2.3.4", "visible": true, "color": "pitchblack" } });
});


/* The test cockpit-bridge gets started with a temp COCKPIT_DATA_DIR  instead
 * of defaulting to /var/lib/cockpit/. Read it from the bridge so that we can
 * put our test files into it. */
var proxy = dbus.proxy("cockpit.Environment", "/environment");
proxy.wait(function () {
    dataDir = proxy.Variables["COCKPIT_DATA_DIR"];
    QUnit.start();
});
