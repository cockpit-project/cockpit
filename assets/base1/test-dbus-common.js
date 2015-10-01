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
function common_dbus_tests(channel_options, bus_name)
{
    asyncTest("call method", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        equal(typeof dbus.call, "function", "is a function");
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            done(function(reply) {
                deepEqual(reply, [ "Word! You said `Browser-side JS'. I'm Skeleton, btw!" ], "reply");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("close immediately", function() {
        expect(1);
        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("close", function(event, options) {
            equal(options.problem, "test-code", "got right code");
            start();
        });

        window.setTimeout(function() {
            dbus.close("test-code");
        }, 100);
    });

    asyncTest("call close", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            fail(function(ex) {
                equal(ex.problem, "disconnected", "got right close code");
            }).
            always(function() {
                equal(this.state(), "rejected", "call rejected");
                start();
            });

        dbus.close();
    });

    asyncTest("call closed", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.close("blah-blah");

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            fail(function(ex) {
                equal(ex.problem, "blah-blah", "got right close code");
            }).
            always(function() {
                equal(this.state(), "rejected", "call rejected");
                start();
            });
    });

    asyncTest("primitive types", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [
                        10, true, 11, 12, 13, 14, 15, 16, 17,
                        "a string", "/a/path", "asig",
                        "ZWZnAA==" ]).
            done(function(reply) {
                deepEqual(reply, [
                    20, false, 111, 1012, 10013, 100014, 1000015, 10000016, 17.0 / Math.PI,
                    "Word! You said `a string'. Rock'n'roll!", "/modified/a/path", "assgitasig",
                    "Ynl0ZXN0cmluZyH/AA=="
                ], "round trip");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("non-primitive types", function() {
        expect(2);

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
                deepEqual(reply, [
                        "{'one': 'red', 'two': 'blue'}{'first': (42, 42), 'second': (43, 43)}(42, 'foo', 'bar')array_of_strings: [one, two] array_of_objpaths: [/one, /one/two] array_of_signatures: [signature 'ass', 'git'] array_of_bytestrings: [AB, BC] "
                ] , "round trip");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("variants", function() {
        expect(2);

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
                deepEqual(reply, [
                        "{'one': <'foo'>, 'two': <objectpath '/bar'>, 'three': <signature 'assgit'>, 'four': <byte 0x2a>, 'five': <1000.0>}"
                ] , "round trip");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("bad variants", function() {
        expect(3);

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
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Unexpected type 'string' in argument", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("bad variants", function() {
        expect(3);

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
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Unexpected type 'string' in argument", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("get all", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "org.freedesktop.DBus.Properties",
                  "GetAll", [ "com.redhat.Cockpit.DBusTests.Frobber" ]).
            done(function(reply) {
                deepEqual(reply, [ {
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
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("call unimplemented", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "UnimplementedMethod", [ ]).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                equal(ex.message, "Method UnimplementedMethod is not implemented on interface com.redhat.Cockpit.DBusTests.Frobber", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("call bad base64", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [ 10, true, 11, 12, 13, 14, 15, 16, 17, "a string", "/a/path", "asig",
                        "Yooohooo!~ bad base64" ]).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Invalid base64 in argument", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("call unknown", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                "UnknownBlahMethod", [ 1 ]).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                equal(ex.message, "Introspection data for method com.redhat.Cockpit.DBusTests.Frobber UnknownBlahMethod not available", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("signals", function() {
        expect(6);

        var received = false;
        var dbus = cockpit.dbus(bus_name, channel_options);
        var id = dbus.subscribe({
            "interface": "com.redhat.Cockpit.DBusTests.Frobber",
            "path": "/otree/frobber"
            }, function(path, iface, signal, args) {
                if (received)
                    return;
                equal(path, "/otree/frobber", "got right path");
                equal(iface, "com.redhat.Cockpit.DBusTests.Frobber", "got right path");
                equal(signal, "TestSignal", "signals: got right path");
                deepEqual(args, [
                        43, [ "foo", "frobber" ], [ "/foo", "/foo/bar" ],
                        { "first": [ 42, 42 ], "second": [ 43, 43 ] } ], "got right arguments");
                received = true;
            });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [ 0 ]).
            always(function() {
                equal(this.state(), "resolved", "emmision requested");
                equal(received, true, "signal received");
                start();
            });
    });

    asyncTest("signal unsubscribe", function() {
        expect(4);

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
                equal(this.state(), "resolved", "emmision requested");
                equal(received, true, "signal received");
            }).then(function() {
                subscription.remove();
                received = false;

                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [ 0 ]).
                    always(function() {
                        equal(this.state(), "resolved", "second emmision requested");
                        equal(received, false, "signal not received");
                        start();
                    });
            });
    });

    asyncTest("with types", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [ {one: "red", two: "blue"}, 55, 66, 32 ],
                  { type: "a{ss}uit" }).
            done(function(reply, options) {
                deepEqual(reply, [ {one: "red", two: "blue"}, 55, 66, 32 ], "round trip");
                equal(options.type, "a{ss}uit", "got back type");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("empty base64", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [ "" ],
                  { type: "ay" }).
            done(function(reply, options) {
                deepEqual(reply, [ "" ], "round trip");
                equal(options.type, "ay", "got back type");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });


    asyncTest("bad types", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo", [ 1 ],
                  { type: "!!%%" }).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Type signature is not valid: !!%%", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("bad dict type", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ { "!!!": "value" } ], { type: "a{is}" }).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Unexpected key '!!!' in dict entry", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("bad object path", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ "not/a/path" ], { type: "o" }).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Invalid object path 'not/a/path'", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("bad signature", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [ "bad signature" ], { type: "g" }).
            fail(function(ex) {
                equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                equal(ex.message, "Invalid signature 'bad signature'", "error message");
            }).
            always(function() {
                equal(this.state(), "rejected", "should fail");
                start();
            });
    });

    asyncTest("flags", function() {
        expect(3);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "test" ], { flags: "" }).
            done(function(reply, options) {
                equal(typeof options.flags, "string", "is string");
                ok(options.flags.indexOf(">") !== -1 || options.flags.indexOf("<") !== -1, "has byte order");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });

    asyncTest("without introspection", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo").
            done(function(reply) {
                deepEqual(reply, [], "round trip");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                start();
            });
    });


    asyncTest("watch path", function() {
        expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch("/otree/frobber").
            done(function() {
                equal(typeof cache["/otree/frobber"], "object", "has path");
                deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 }, "correct data");
                $(dbus).off();
                start();
            });
    });

    asyncTest("watch object manager", function() {
        expect(1);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" }).
            done(function() {
                deepEqual(cache, { "/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 } } }, "correct data");
                $(dbus).off();
                start();
            });
    });


    asyncTest("watch change", function() {
        expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch("/otree/frobber");
        $(dbus).on("notify", function(event, data) {
            equal(typeof cache["/otree/frobber"], "object", "has path");
            deepEqual(cache, {"/otree/frobber": {
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
            start();
        });
    });

    asyncTest("watch barrier", function() {
        expect(2);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", [ "Browser-side JS" ]).
            done(function(reply) {
                deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 }, "correct data");
            }).
            always(function() {
                equal(this.state(), "resolved", "finished successfuly");
                $(dbus).off();
                start();
            });
    });

    asyncTest("watch interfaces", function() {
        expect(3);

        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(true, cache, data);
        });

        dbus.watch({ "path_namespace": "/otree" }).
            done(function() {
                deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
                          { "FinallyNormalName": "There aint no place like home",
                            "ReadonlyProperty": "blah",
                            "aay": [], "ag": [], "ao": [], "as": [],
                            "ay": "QUJDYWJjAA==",
                            "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                            "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                            "y": 42 } } }, "correct data");
                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "AddAlpha", []).
                    done (function () {
                        deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
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
                            deepEqual(cache, {"/otree/frobber": { "com.redhat.Cockpit.DBusTests.Frobber":
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
                            start();
                        });
                });
        });
    });

    asyncTest("path loop", function() {
        expect(2);

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
                        deepEqual(cache, expect, "got all data before method reply");
                    }).
                    always(function() {
                        equal(this.state(), "resolved", "method called");
                        $(dbus).off();
                        start();
                    });
            });
    });

    asyncTest("path signal", function() {
        expect(4);

        var name = "yo" + new Date().getTime();
        var cache = { };

        var dbus = cockpit.dbus(bus_name, channel_options);
        $(dbus).on("notify", function(event, data) {
            $.extend(cache, data);
        });

        dbus.watch({ "path": "/hidden/" + name }).
            done(function() {
                deepEqual(cache, { }, "no data yet");

                dbus.subscribe({ "path": "/hidden/" + name }, function(path, iface, args) {
                    equal(typeof cache[path], "object", "have object");
                    deepEqual(cache[path], {
                            "com.redhat.Cockpit.DBusTests.Hidden": { "Name": name }
                        }, "got data before signal");
                    $(dbus).off();
                    start();
                });
                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                          "EmitHidden", [ name ]).
                    always(function() {
                        equal(this.state(), "resolved", "method called");
                    });
            });
    });

    asyncTest("proxy", function() {
        expect(7);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
        proxy.wait(function() {
            strictEqual(proxy.valid, true, "proxy: is valid");
            deepEqual(proxy.data, {
                "FinallyNormalName": "There aint no place like home",
                "ReadonlyProperty": "blah",
                "aay": [], "ag": [], "ao": [], "as": [],
                "ay": "QUJDYWJjAA==",
                "b": false, "d": 43, "g": "", "i": 0, "n": 0,
                "o": "/", "q": 0, "s": "", "t": 0, "u": 0, "x": 0,
                "y": 42
            }, "correct data");

            strictEqual(proxy.FinallyNormalName, "There aint no place like home", "property value");
            strictEqual(proxy.ReadonlyProperty, "blah", "another property value");

            equal(typeof proxy.HelloWorld, "function", "has function defined");
            proxy.HelloWorld("From a proxy").
                done(function(message) {
                    equal(message, "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
                }).
                always(function() {
                    equal(this.state(), "resolved", "method called");
                    $(dbus).off();
                    start();
                });
       });
    });

    asyncTest("proxy call", function() {
        expect(2);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        /* No wait */
        proxy.call("HelloWorld", ["From a proxy"]).
            done(function(args) {
                equal(args[0], "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
            }).
            always(function() {
                equal(this.state(), "resolved", "method called");
                $(dbus).off();
                start();
            });
    });

    asyncTest("proxy signal", function() {
        expect(4);

        var received = false;

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        $(proxy).on("signal", function(event, name, args) {
            equal(name, "TestSignal", "signals: got right name");
            deepEqual(args, [
                      43, [ "foo", "frobber" ], [ "/foo", "/foo/bar" ],
                      { "first": [ 42, 42 ], "second": [ 43, 43 ] } ], "got right arguments");
            received = true;
        });

        proxy.call("RequestSignalEmission", [ 0 ]).
            always(function() {
                equal(this.state(), "resolved", "emmision requested");
                equal(received, true, "signal received");
                $(dbus).off();
                $(proxy).off();
                start();
            });
    });

    asyncTest("proxy explicit notify", function() {
        expect(1);

        var dbus = cockpit.dbus(bus_name, channel_options);
        var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        proxy.wait(function() {
            $(proxy).on("changed", function () {
                equal(proxy.FinallyNormalName, "externally injected");
                $(proxy).off("changed");
                start();
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

    asyncTest("proxies", function() {
        expect(13);

        var dbus = cockpit.dbus(bus_name, channel_options);

        /* Just some cleanup */
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "DeleteAllObjects", []).
            always(function() {
                equal(this.state(), "resolved", "deleted stray objects");

                var proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber");
                proxies.wait(function() {
                    var added;
                    $(proxies).on("added", function(event, proxy) {
                        added = proxy;
                        strictEqual(added.valid, true, "added objects valid");
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
                            equal(this.state(), "resolved", "create objects done");

                            equal(typeof added, "object", "got added object");
                            equal(typeof changed, "object", "no changed object yet");
                            equal(typeof removed, "undefined", "no removed object yet");
                            equal(added.path, "/otree/other", "added object correct");
                            strictEqual(added, changed, "added fires changed");

                            changed = null;

                            dbus.call(added.path, added.iface, "RequestPropertyMods", []).
                                always(function() {
                                    equal(this.state(), "resolved", "changed object");
                                    strictEqual(changed, added, "change fired");

                                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                            "DeleteObject", [ "/otree/other" ]).
                                        always(function() {
                                            equal(this.state(), "resolved", "removed object");
                                            strictEqual(removed, added, "removed fired");
                                            strictEqual(removed.valid, false, "removed is invalid");
                                            $(dbus).off();
                                            start();
                                        });
                                });
                        });
                });
            });
    });
}

function dbus_track_tests(channel_options, bus_name) {
    asyncTest("track name", function() {
        expect(4);

        var name = "yo.x" + new Date().getTime();
        var released = false;
        var gone = false;

        var dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [ name ])
            .always(function() {
                equal(this.state(), "resolved", "name claimed");

                var other = cockpit.dbus(name, { "bus": channel_options.bus,
                                                 "address": channel_options.address,
                                                 "track": true });
                $(other).on("close", function(event, data) {
                    strictEqual(data.problem, undefined, "no problem");
                    gone = true;
                    if (released && gone)
                        start();
                });

                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                           "HelloWorld", [ "test" ])
                    .always(function() {
                        equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [ name ])
                            .always(function() {
                                equal(this.state(), "resolved", "name released");
                                released = true;
                                if (released && gone)
                                    start();
                            });
                    });
            });
    });

    asyncTest("no track name", function() {
        expect(5);

        var name = "yo.y" + new Date().getTime();
        var gone = false;

        var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [ name ])
            .always(function() {
                equal(this.state(), "resolved", "name claimed");

                var other = cockpit.dbus(name, channel_options);
                $(other).on("close", function(event, data) {
                    gone = true;
                });

                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                           "HelloWorld", [ "test" ])
                    .always(function() {
                        equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [ name ])
                            .always(function() {
                                equal(this.state(), "resolved", "name released");

                                other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                           "HelloWorld", [ "test" ])
                                    .always(function() {
                                        equal(this.state(), "rejected", "call after release should fail");
                                        equal(gone, false, "is not gone");
                                        start();
                                    });
                            });
                    });
            });
    });
}
