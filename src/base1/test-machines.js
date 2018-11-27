/* global cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

var dbus = cockpit.dbus(null, { "bus": "internal" });
var configDir;

function cleanUp() {
    return cockpit.spawn([ "find", configDir + "/machines.d", "-type", "f", "-delete" ]);
}

/***
 * Tests for parsing on-disk JSON configuration
 */

function machinesParseTest(machines_defs, expectedProperty) {
    assert.expect(3);

    var setup = [];
    var path;

    for (var fname in machines_defs) {
        path = fname;
        if (fname.indexOf('/') < 0)
            path = configDir + "/machines.d/" + fname;
        setup.push(cockpit.file(path).replace(machines_defs[fname]));
    }

    cockpit.all(setup).done(function() {
        dbus.call("/machines", "org.freedesktop.DBus.Properties",
                  "Get", [ "cockpit.Machines", "Machines" ],
                  { "type": "ss" })
                .done(function(reply) {
                    assert.equal(reply[0].t, "a{sa{sv}}", "expected return type");
                    assert.deepEqual(reply[0].v, expectedProperty, "expected property value");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    cleanUp()
                            .done(QUnit.start)
                            .fail(function(err) {
                                console.error("cleanup failed:", err);
                            });
                });
    });
}

QUnit.asyncTest("no machine definitions", function() {
    machinesParseTest({}, {});
});

QUnit.asyncTest("empty json", function() {
    machinesParseTest({ "01.json": "" }, {});
});

QUnit.asyncTest("two definitions", function() {
    machinesParseTest({ "01.json": '{"green": {"visible": true, "address": "1.2.3.4"}, ' +
                                   ' "9.8.7.6": {"visible": false, "address": "9.8.7.6", "user": "admin"}}' },
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
    machinesParseTest({ "01.json": '{"green":' }, {});
});

QUnit.asyncTest("invalid data types", function() {
    machinesParseTest({ "01.json": '{"green": []}' }, {});
});

QUnit.asyncTest("merge several JSON files", function() {
    /* 99-webui.json changes a property in green, adds a
     * property to blue, and adds an entire new host yellow */
    machinesParseTest(
        { "01-green.json": '{"green": {"visible": true, "address": "1.2.3.4"}}',
          "02-blue.json":  '{"blue": {"address": "9.8.7.6"}}',
          "09-webui.json": '{"green": {"visible": false}, ' +
                           ' "blue":  {"user": "joe"}, ' +
                           ' "yellow": {"address": "fe80::1", "user": "sue"}}'
        },
        { "green": {
            "address": { "t": "s", "v": "1.2.3.4" },
            "visible": { "t": "b", "v": false }
        },
          "blue": {
              "address": { "t": "s", "v": "9.8.7.6" },
              "user": { "t": "s", "v": "joe" },
          },
          "yellow": {
              "address": { "t": "s", "v": "fe80::1" },
              "user": { "t": "s", "v": "sue" },
          }
        }
    );
});

QUnit.asyncTest("merge JSON files with errors", function() {
    machinesParseTest(
        { "01-valid.json":    '{"green": {"visible": true, "address": "1.2.3.4"}}',
          "02-syntax.json":   '[a',
          "03-toptype.json":  '["green"]',
          "04-toptype.json":  '{"green": ["visible"]}',
          "05-valid.json":    '{"blue": {"address": "fe80::1"}}',
          // goodprop should still be considered
          "06-proptype.json": '{"green": {"visible": [], "address": {"bar": null}, "goodprop": "yeah"}}',
          "07-valid.json":    '{"green": {"user": "joe"}}',
          "08-empty.json":    ''
        },
        { "green": {
            "address":  { "t": "s", "v": "1.2.3.4" },
            "visible":  { "t": "b", "v": true },
            "user":     { "t": "s", "v": "joe" },
            "goodprop": { "t": "s", "v": "yeah" },
        },
          "blue": {
              "address": { "t": "s", "v": "fe80::1" }
          }
        }
    );
});

/***
 * Tests for Update()
 */

function machinesUpdateTest(origJson, host, props, expectedJson) {
    assert.expect(3);

    var f = configDir + "/machines.d/99-webui.json";

    cockpit.file(f).replace(origJson)
            .done(function(tag) {
                dbus.call("/machines", "cockpit.Machines", "Update", [ "99-webui.json", host, props ], { "type": "ssa{sv}" })
                        .then(function(reply) {
                            assert.deepEqual(reply, [], "no expected return value");
                            return cockpit.file(f, { syntax: JSON }).read()
                                    .done(function(content, tag) {
                                        assert.deepEqual(content, expectedJson, "expected file content");
                                    })
                                    .fail(function(err) {
                                        assert.equal(err, undefined, "expected no error");
                                    });
                        })
                        .always(function() {
                            assert.equal(this.state(), "resolved", "finished successfully");
                            cleanUp()
                                    .done(QUnit.start)
                                    .fail(function(err) {
                                        console.error("cleanup failed:", err);
                                    });
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
                         "blue":  { "address": "9.8.7.6", "visible": false } });
});

QUnit.asyncTest("change bool host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
                       "green",
                       { "visible": cockpit.variant('b', false) },
                       { "green": { "address": "1.2.3.4", "visible": false } });
});

QUnit.asyncTest("change string host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
                       "green",
                       { "address": cockpit.variant('s', "fe80::1") },
                       { "green": { "address": "fe80::1", "visible": true } });
});

QUnit.asyncTest("add host property", function() {
    machinesUpdateTest('{"green": {"visible": true, "address": "1.2.3.4"}}',
                       "green",
                       { "color": cockpit.variant('s', "pitchblack") },
                       { "green": { "address": "1.2.3.4", "visible": true, "color": "pitchblack" } });
});

QUnit.asyncTest("Update() only writes delta", function() {
    cockpit.file(configDir + "/machines.d/01-green.json")
            .replace('{"green": {"address": "1.2.3.4"}, "blue": {"address": "fe80::1"}}')
            .done(function(tag) {
                machinesUpdateTest(null,
                                   "green",
                                   { "color": cockpit.variant('s', "pitchblack") },
                                   { "green": { "color": "pitchblack" } });
            });
});

QUnit.asyncTest("updating and existing delta file", function() {
    cockpit.file(configDir + "/machines.d/01-green.json")
            .replace('{"green": {"address": "1.2.3.4"}, "blue": {"address": "fe80::1"}}')
            .done(function(tag) {
                machinesUpdateTest('{"green": {"address": "9.8.7.6", "user": "joe"}}',
                                   "green",
                                   { "color": cockpit.variant('s', "pitchblack") },
                                   { "green": { "address": "9.8.7.6", "user": "joe", "color": "pitchblack" } });
            });
});

/* The test cockpit-bridge gets started with temp $COCKPIT_TEST_CONFIG_DIR instead of defaulting to /etc/cockpit.
 * Read it from the bridge so that we can put our test files into it. */
var proxy = dbus.proxy("cockpit.Environment", "/environment");
proxy.wait(function () {
    configDir = proxy.Variables["COCKPIT_TEST_CONFIG_DIR"];
    QUnit.start();
});
