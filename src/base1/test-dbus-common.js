/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/* global cockpit, QUnit, $ */

var assert = QUnit;

function common_dbus_tests(channel_options, bus_name)
{
    QUnit.asyncTest("call method", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        assert.equal(typeof dbus.call, "function", "is a function");
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            done(function(reply) {
                assert.deepEqual(reply, [ "Word! You said `Browser-side JS'. I'm Skeleton, btw!" ], "reply");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("close immediately", function() {
        assert.expect(1);
        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("close", function(event, options) {
            assert.equal(options.problem, "test-code", "got right code");
            QUnit.start();
        });

        window.setTimeout(function() {
            dbus.close("test-code");
        }, 100);
    });

    QUnit.asyncTest("call close", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            fail(function(ex) {
                assert.equal(ex.problem, "disconnected", "got right close code");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "call rejected");
                QUnit.start();
            });

        dbus.close();
    });

    QUnit.asyncTest("call closed", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.close("blah-blah");

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            fail(function(ex) {
                assert.equal(ex.problem, "blah-blah", "got right close code");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "call rejected");
                QUnit.start();
            });
    });

    QUnit.asyncTest("primitive types", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [
                        10, true, 11, 12, 13, 14, 15, 16, 17,
                        "a string", "/a/path", "asig",
                        "ZWZnAA==" ]).
            done(function(reply) {
                assert.deepEqual(reply, [
                    20, false, 111, 1012, 10013, 100014, 1000015, 10000016, 17.0 / Math.PI,
                    "Word! You said `a string'. Rock'n'roll!", "/modified/a/path", "assgitasig",
                    "Ynl0ZXN0cmluZyH/AA=="
                ], "round trip");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("non-primitive types", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestNonPrimitiveTypes", [
                        {one: "red", two: "blue"},
                        {first: [42, 42], second: [43, 43]},
                        [42, 'foo', 'bar'],
                        ["one", "two"],
                        ["/one", "/one/two"],
                        ["ass", "git"],
                        ["QUIA", "QkMA"] ]).
            done(function(reply) {
                assert.deepEqual(reply, [
                        "{'one': 'red', 'two': 'blue'}{'first': (42, 42), 'second': (43, 43)}(42, 'foo', 'bar')array_of_strings: [one, two] array_of_objpaths: [/one, /one/two] array_of_signatures: [signature 'ass', 'git'] array_of_bytestrings: [AB, BC] "
                ] , "round trip");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("variants", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                    "TestAsv", [ {
                       one: cockpit.variant("s", "foo"),
                       two: cockpit.variant("o", "/bar"),
                       three: cockpit.variant("g", "assgit"),
                       four: cockpit.variant("y", 42),
                       five: cockpit.variant("d", 1000.0)
                    } ]).
            done(function(reply) {
                assert.deepEqual(reply, [
                        "{'one': <'foo'>, 'two': <objectpath '/bar'>, 'three': <signature 'assgit'>, 'four': <byte 0x2a>, 'five': <1000.0>}"
                ] , "round trip");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad variants", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                    "TestAsv", [ {
                        one: "foo",
                        two: "/bar",
                        three: "assgit",
                        four: 42,
                        five: 1000.0
                    } ]).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Unexpected type 'string' in argument", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad variants", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                    "TestAsv", [ {
                        one: "foo",
                        two: "/bar",
                        three: "assgit",
                        four: 42,
                        five: 1000.0
                    } ]).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Unexpected type 'string' in argument", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("get all", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "org.freedesktop.DBus.Properties",
                  "GetAll", [ "com.redhat.Cockpit.DBusTests.Frobber" ]).
            done(function(reply) {
                assert.deepEqual(reply, [ {
                    "FinallyNormalName": { "t": "s", "v": "There aint no place like home" },
                    "ReadonlyProperty": { "t": "s", "v": "blah" },
                    "aay": { "t": "aay", "v": [] },
                    "ag": { "t": "ag", "v": [] },
                    "ao": { "t": "ao", "v": [] },
                    "as": { "t": "as", "v": [] },
                    "ay": { "t": "ay", "v": "QUJDYWJjAA==" },
                    "b": { "t": "b", "v": false },
                    "d": { "t": "d", "v": 43 },
                    "g": { "t": "g", "v": "" },
                    "i": { "t": "i", "v": 0 },
                    "n": { "t": "n", "v": 0 },
                    "o": { "t": "o", "v": "/" },
                    "q": { "t": "q", "v": 0 },
                    "s": { "t": "s", "v": "" },
                    "t": { "t": "t", "v": 0 },
                    "u": { "t": "u", "v": 0 },
                    "x": { "t": "x", "v": 0 },
                    "y": { "t": "y", "v": 42 }
               } ], "reply");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("call unimplemented", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "UnimplementedMethod", [ ]).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                assert.equal(ex.message, "Method UnimplementedMethod is not implemented on interface com.redhat.Cockpit.DBusTests.Frobber", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("call bad base64", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [ 10, true, 11, 12, 13, 14, 15, 16, 17, "a string", "/a/path", "asig",
                        "Yooohooo!~ bad base64" ]).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Invalid base64 in argument", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("call unknown", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                "UnknownBlahMethod", [ 1 ]).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                assert.equal(ex.message, "Introspection data for method com.redhat.Cockpit.DBusTests.Frobber UnknownBlahMethod not available", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("signals", function() {
        assert.expect(6);

        var received = false;
        var dbus = cockpit.dbus(bus_name, channel_options);
        var id = dbus.subscribe({
            "interface": "com.redhat.Cockpit.DBusTests.Frobber",
            "path": "/otree/frobber"
            }, function(path, iface, signal, args) {
                if (received)
                    return;
                assert.equal(path, "/otree/frobber", "got right path");
                assert.equal(iface, "com.redhat.Cockpit.DBusTests.Frobber", "got right path");
                assert.equal(signal, "TestSignal", "signals: got right path");
                assert.deepEqual(args, [
                        43, [ "foo", "frobber" ], [ "/foo", "/foo/bar" ],
                        { "first": [ 42, 42 ], "second": [ 43, 43 ] } ], "got right arguments");
                received = true;
            });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [ 0 ]).
            always(function() {
                assert.equal(this.state(), "resolved", "emmision requested");
                assert.equal(received, true, "signal received");
                QUnit.start();
            });
    });

    QUnit.asyncTest("signal unsubscribe", function() {
        assert.expect(4);

        var received = true;
        var dbus = cockpit.dbus(bus_name, channel_options);

        function on_signal() {
            received = true;
        }

        var subscription = dbus.subscribe({
            "interface": "com.redhat.Cockpit.DBusTests.Frobber",
            "path": "/otree/frobber"
            }, on_signal);

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [ 0 ]).
            always(function() {
                assert.equal(this.state(), "resolved", "emmision requested");
                assert.equal(received, true, "signal received");
            }).then(function() {
                subscription.remove();
                received = false;

                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [ 0 ]).
                    always(function() {
                        assert.equal(this.state(), "resolved", "second emmision requested");
                        assert.equal(received, false, "signal not received");
                        QUnit.start();
                    });
            });
    });

    QUnit.asyncTest("with types", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [ {one: "red", two: "blue"}, 55, 66, 32 ],
                  { type: "a{ss}uit" }).
            done(function(reply, options) {
                assert.deepEqual(reply, [ {one: "red", two: "blue"}, 55, 66, 32 ], "round trip");
                assert.equal(options.type, "a{ss}uit", "got back type");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("with meta", function() {
        assert.expect(2);

        var meta = {
            "borkety.Bork": {
                "methods": {
                    "Echo": {
                        "in": [ "a{ss}", "u", "i", "t" ],
                        "out": [ "a{ss}", "u", "i", "t" ]
                    }
                }
            }
        };

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.addEventListener("meta", function(event, data) {
            assert.deepEqual(data, meta, "got meta data");
        });

        dbus.meta(meta);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [ {one: "red", two: "blue"}, 55, 66, 32 ])
            .then(function(reply) {
                assert.deepEqual(reply, [ {one: "red", two: "blue"}, 55, 66, 32 ], "returned round trip");
            }, function(ex) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
            }).
            always(function() {
                dbus.close();
                QUnit.start();
            });
    });

    QUnit.asyncTest("empty base64", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [ "" ],
                  { type: "ay" }).
            done(function(reply, options) {
                assert.deepEqual(reply, [ "" ], "round trip");
                assert.equal(options.type, "ay", "got back type");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad object path", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("invalid/path", "borkety.Bork", "Echo", [ 1 ]).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "object path is invalid in dbus \"call\": invalid/path", "error message");
            }).
            always(function() {
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad interface name", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "!invalid!interface!", "Echo", [ 1 ]).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "interface name is invalid in dbus \"call\": !invalid!interface!", "error message");
            }).
            always(function() {
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad method name", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "borkety.Bork", "!Invalid!Method!", [ 1 ]).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "member name is invalid in dbus \"call\": !Invalid!Method!", "error message");
            }).
            always(function() {
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad flags", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "borkety.Bork", "Method", [ 1 ], { "flags": 5 }).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "the \"flags\" field is invalid in dbus call", "error message");
            }).
            always(function() {
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad types", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo", [ 1 ],
                  { type: "!!%%" }).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "the \"type\" signature is not valid in dbus call: !!%%", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad type invalid", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo", [ 1 ], { type: 5 /* invalid */ }).
            fail(function(ex) {
                assert.equal(ex.problem, "protocol-error", "error name");
                assert.equal(ex.message, "the \"type\" field is invalid in call", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad dict type", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ { "!!!": "value" } ], { type: "a{is}" }).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Unexpected key '!!!' in dict entry", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad object path", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ "not/a/path" ], { type: "o" }).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Invalid object path 'not/a/path'", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("bad signature", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ "bad signature" ], { type: "g" }).
            fail(function(ex) {
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                assert.equal(ex.message, "Invalid signature 'bad signature'", "error message");
            }).
            always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                QUnit.start();
            });
    });

    QUnit.asyncTest("flags", function() {
        assert.expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "test" ], { flags: "" }).
            done(function(reply, options) {
                assert.equal(typeof options.flags, "string", "is string");
                assert.ok(options.flags.indexOf(">") !== -1 || options.flags.indexOf("<") !== -1, "has byte order");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });

    QUnit.asyncTest("without introspection", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo").
            done(function(reply) {
                assert.deepEqual(reply, [], "round trip");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                QUnit.start();
            });
    });


    QUnit.asyncTest("watch path", function() {
        assert.expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(true, cache, data);
        });

        dbus.watch("/otree/frobber").
            done(function() {
                assert.equal(typeof cache["/otree/frobber"], "object", "has path");
                assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 }, "correct data");
                $(dbus).off();
                QUnit.start();
            });
    });

    QUnit.asyncTest("watch object manager", function() {
        assert.expect(1);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" }).
            done(function() {
                assert.deepEqual(cache, { "/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 } } }, "correct data");
                $(dbus).off();
                QUnit.start();
            });
    });


    QUnit.asyncTest("watch change", function() {
        assert.expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch("/otree/frobber");
        $(dbus).on("notify", function(event, data) {
            assert.equal(typeof cache["/otree/frobber"], "object", "has path");
            assert.deepEqual(cache, {"/otree/frobber": {
                    "com.redhat.Cockpit.DBusTests.Frobber": {
                          "FinallyNormalName": "There aint no place like home",
                          "ReadonlyProperty": "blah",
                          "aay": [], "ag": [], "ao": [], "as": [],
                          "ay": "QUJDYWJjAA==",
                          "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                          "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                          "y": 42 }
                        } }, "correct data");
            $(dbus).off();
            QUnit.start();
        });
    });

    QUnit.asyncTest("watch barrier", function() {
        assert.expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            done(function(reply) {
                assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 }, "correct data");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "finished successfuly");
                $(dbus).off();
                QUnit.start();
            });
    });

    QUnit.asyncTest("watch interfaces", function() {
        assert.expect(3);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(true, cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" }).
            done(function() {
                assert.deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 } } }, "correct data");
                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "AddAlpha", []).
                    done (function () {
                        assert.deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                                  { "FinallyNormalName": "There aint no place like home",
                                    "ReadonlyProperty": "blah",
                                    "aay": [], "ag": [], "ao": [], "as": [],
                                    "ay": "QUJDYWJjAA==",
                                    "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                                    "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                                    "y": 42 },
                                "com.redhat.Cockpit.DBusTests.Alpha": {}
                            } }, "correct data");
                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RemoveAlpha", []).
                        done (function () {
                            assert.deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                                      { "FinallyNormalName": "There aint no place like home",
                                        "ReadonlyProperty": "blah",
                                        "aay": [], "ag": [], "ao": [], "as": [],
                                        "ay": "QUJDYWJjAA==",
                                        "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                                        "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                                        "y": 42 },
                                "com.redhat.Cockpit.DBusTests.Alpha": null
                            } }, "correct data");
                            $(dbus).off();
                            QUnit.start();
                        });
                });
        });
    });

    QUnit.asyncTest("path loop", function() {
        assert.expect(2);

        var name = "yo" + new Date().getTime();
        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path_namespace": "/cliques/" + name }).
            done(function() {
                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                          "CreateClique", [ name ]).
                    done(function(path) {
                        var expect = { };
                        /* The same way mock-service.c calculates the paths */
                        for (var i = 0; i < 3; i++) {
                            expect["/cliques/" + name + "/" + i] = {
                                "com.redhat.Cockpit.DBusTests.Clique": {
                                    "Friend": "/cliques/" + name + "/" + (i + 1) % 3
                                }
                            };
                        }
                        assert.deepEqual(cache, expect, "got all data before method reply");
                    }).
                    always(function() {
                        assert.equal(this.state(), "resolved", "method called");
                        $(dbus).off();
                        QUnit.start();
                    });
            });
    });

    QUnit.asyncTest("path signal", function() {
        assert.expect(4);

        var name = "yo" + new Date().getTime();
        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path": "/hidden/" + name }).
            done(function() {
                assert.deepEqual(cache, { }, "no data yet");

                dbus.subscribe({ "path": "/hidden/" + name }, function(path, iface, args) {
                    assert.equal(typeof cache[path], "object", "have object");
                    assert.deepEqual(cache[path], {
                            "com.redhat.Cockpit.DBusTests.Hidden": { "Name": name }
                        }, "got data before signal");
                    $(dbus).off();
                    QUnit.start();
                });
                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                          "EmitHidden", [ name ]).
                    always(function() {
                        assert.equal(this.state(), "resolved", "method called");
                    });
            });
    });

    QUnit.asyncTest("proxy", function() {
        assert.expect(7);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
        proxy.wait(function() {
            assert.strictEqual(proxy.valid, true, "proxy: is valid");
            assert.deepEqual(proxy.data, {
                "FinallyNormalName": "There aint no place like home",
                "ReadonlyProperty": "blah",
                "aay": [], "ag": [], "ao": [], "as": [],
                "ay": "QUJDYWJjAA==",
                "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                "y": 42
            }, "correct data");

            assert.strictEqual(proxy.FinallyNormalName, "There aint no place like home", "property value");
            assert.strictEqual(proxy.ReadonlyProperty, "blah", "another property value");

            assert.equal(typeof proxy.HelloWorld, "function", "has function defined");
            proxy.HelloWorld("From a proxy").
                done(function(message) {
                    assert.equal(message, "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
                }).
                always(function() {
                    assert.equal(this.state(), "resolved", "method called");
                    $(dbus).off();
                    QUnit.start();
                });
       });
    });

    QUnit.asyncTest("proxy call", function() {
        assert.expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        /* No wait */
        proxy.call("HelloWorld", ["From a proxy"]).
            done(function(args) {
                assert.equal(args[0], "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
            }).
            always(function() {
                assert.equal(this.state(), "resolved", "method called");
                $(dbus).off();
                QUnit.start();
            });
    });

    QUnit.asyncTest("proxy signal", function() {
        assert.expect(4);

        var received = false;

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        $(proxy).on("signal", function(event, name, args) {
            assert.equal(name, "TestSignal", "signals: got right name");
            assert.deepEqual(args, [
                      43, [ "foo", "frobber" ], [ "/foo", "/foo/bar" ],
                      { "first": [ 42, 42 ], "second": [ 43, 43 ] } ], "got right arguments");
            received = true;
        });

        proxy.call("RequestSignalEmission", [ 0 ]).
            always(function() {
                assert.equal(this.state(), "resolved", "emmision requested");
                assert.equal(received, true, "signal received");
                $(dbus).off();
                $(proxy).off();
                QUnit.start();
            });
    });

    QUnit.asyncTest("proxy explicit notify", function() {
        assert.expect(1);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        proxy.wait().done(function() {
            $(proxy).on("changed", function () {
                assert.equal(proxy.FinallyNormalName, "externally injected");
                $(proxy).off("changed");
                QUnit.start();
            });
            dbus.notify({
                "/otree/frobber": {
                    "com.redhat.Cockpit.DBusTests.Frobber": {
                        "FinallyNormalName": "externally injected"
                    }
                }
            });
        });
    });

    QUnit.asyncTest("proxies", function() {
        assert.expect(13);

        var dbus = cockpit.dbus(bus_name, channel_options);

        /* Just some cleanup */
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "DeleteAllObjects", []).
            always(function() {
                assert.equal(this.state(), "resolved", "deleted stray objects");

                var proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber");
                proxies.wait().always(function() {
                    var added;
                    $(proxies).on("added", function(event, proxy) {
                        added = proxy;
                        assert.strictEqual(added.valid, true, "added objects valid");
                    });

                    var changed;
                    $(proxies).on("changed", function(event, proxy) {
                        changed = proxy;
                    });

                    var removed;
                    $(proxies).on("removed", function(event, proxy) {
                        removed = proxy;
                    });

                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                            "CreateObject", [ "/otree/other" ]).
                        always(function() {
                            assert.equal(this.state(), "resolved", "create objects done");

                            assert.equal(typeof added, "object", "got added object");
                            assert.equal(typeof changed, "object", "no changed object yet");
                            assert.equal(typeof removed, "undefined", "no removed object yet");
                            assert.equal(added.path, "/otree/other", "added object correct");
                            assert.strictEqual(added, changed, "added fires changed");

                            changed = null;

                            dbus.call(added.path, added.iface, "RequestPropertyMods", []).
                                always(function() {
                                    assert.equal(this.state(), "resolved", "changed object");
                                    assert.strictEqual(changed, added, "change fired");

                                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                            "DeleteObject", [ "/otree/other" ]).
                                        always(function() {
                                            assert.equal(this.state(), "resolved", "removed object");
                                            assert.strictEqual(removed, added, "removed fired");
                                            assert.strictEqual(removed.valid, false, "removed is invalid");
                                            dbus.close();
                                            $(dbus).off();
                                            QUnit.start();
                                        });
                                });
                        });
                });
            });
    });
}

function dbus_track_tests(channel_options, bus_name) {
    QUnit.asyncTest("track name", function() {
        assert.expect(4);

        var name = "yo.x" + new Date().getTime();
        var released = false;
        var gone = false;

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [ name ])
            .always(function() {
                assert.equal(this.state(), "resolved", "name claimed");

                var other = cockpit.dbus(name, { "bus": channel_options.bus,
                                                 "address": channel_options.address,
                                                 "track": true });
                $(other).on("close", function(event, data) {
                    assert.strictEqual(data.problem, undefined, "no problem");
                    gone = true;
                    if (released && gone)
                        QUnit.start();
                });

                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                           "HelloWorld", [ "test" ])
                    .always(function() {
                        assert.equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [ name ])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "name released");
                                released = true;
                                if (released && gone)
                                    QUnit.start();
                            });
                    });
            });
    });

    QUnit.asyncTest("no track name", function() {
        assert.expect(5);

        var name = "yo.y" + new Date().getTime();
        var gone = false;

        var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [ name ])
            .always(function() {
                assert.equal(this.state(), "resolved", "name claimed");

                var other = cockpit.dbus(name, channel_options);
                $(other).on("close", function(event, data) {
                    gone = true;
                });

                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                           "HelloWorld", [ "test" ])
                    .always(function() {
                        assert.equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [ name ])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "name released");

                                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                           "HelloWorld", [ "test" ])
                                    .always(function() {
                                        assert.equal(this.state(), "rejected", "call after release should fail");
                                        assert.equal(gone, false, "is not gone");
                                        QUnit.start();
                                    });
                            });
                    });
            });
    });
}
