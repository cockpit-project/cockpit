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

import cockpit from "cockpit";
import QUnit from "qunit-tests";

function deep_update(target, data) {
    for (const prop in data) {
        if (Object.prototype.toString.call(data[prop]) === '[object Object]') {
            if (!target[prop])
                target[prop] = {};
            deep_update(target[prop], data[prop]);
        } else {
            target[prop] = data[prop];
        }
    }
}

export function common_dbus_tests(channel_options, bus_name) { // eslint-disable-line no-unused-vars
    QUnit.test("call method", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        assert.equal(typeof dbus.call, "function", "is a function");
        const reply = await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                      "HelloWorld", ["Browser-side JS"]);
        assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"], "reply");
    });

    QUnit.test("call method with timeout", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "NeverReturn",
                            [], { timeout: 10 });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.ok([
                "org.freedesktop.DBus.Error.Timeout",
                "org.freedesktop.DBus.Error.NoReply"
            ].indexOf(ex.name) >= 0);
        }
    });

    QUnit.test("close immediately", assert => {
        const done = assert.async();
        assert.expect(1);
        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.addEventListener("close", (_event, options) => {
            assert.equal(options.problem, "test-code", "got right code");
            done();
        });

        window.setTimeout(() => dbus.close("test-code"), 100);
    });

    QUnit.test("call close", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            const promise = dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "HelloWorld", ["Browser-side JS"]);
            dbus.close();
            await promise;
            // assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "disconnected", "got right close code");
        }
    });

    QUnit.test("call closed", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.close("blah-blah");

        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                            "HelloWorld", ["Browser-side JS"]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "blah-blah", "got right close code");
        }
    });

    QUnit.test("primitive types", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const reply = await dbus.call(
            "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TestPrimitiveTypes",
            [10, true, 11, 12, 13, 14, 15, 16, 17, "a string", "/a/path", "asig", "ZWZnAA=="]);
        assert.deepEqual(reply, [
            20, false, 111, 1012, 10013, 100014, 1000015, 10000016, 17.0 / Math.PI,
            "Word! You said `a string'. Rock'n'roll!", "/modified/a/path", "assgitasig",
            "Ynl0ZXN0cmluZyH/AA=="
        ], "round trip");
    });

    QUnit.test.skipWithPybridge("integer bounds", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);

        async function testNumber(type, value, valid) {
            try {
                await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                "TestVariant", [{ t: type, v: value }]);
                if (!valid)
                    assert.ok(false, "should not be reached");
            } catch (ex) {
                assert.equal(valid, false);
                assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs");
            }
        }

        await testNumber('y', 0, true);
        await testNumber('y', 0xff, true);
        await testNumber('y', -1, false);
        await testNumber('y', 0xff + 1, false);
        await testNumber('n', -300, true);
        await testNumber('n', 300, true);
        await testNumber('n', -0x8000 - 1, false);
        await testNumber('n', 0x7fff + 1, false);
        await testNumber('q', 0, true);
        await testNumber('q', 300, true);
        await testNumber('q', -1, false);
        await testNumber('q', 0xffff + 1, false);
        await testNumber('i', -0xfffff, true);
        await testNumber('i', 0xfffff, true);
        await testNumber('i', -0x80000000 - 1, false);
        await testNumber('i', 0x7fffffff + 1, false);
        await testNumber('u', 0, true);
        await testNumber('u', 0xfffff, true);
        await testNumber('u', -1, false);
        await testNumber('u', 0xffffffff + 1, false);
        await testNumber('x', -0xfffffffff, true);
        await testNumber('x', 0xfffffffff, true);
        await testNumber('t', 0xfffffffff, true);
        await testNumber('t', -1, false);
    });

    QUnit.test("non-primitive types", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const reply = await dbus.call(
            "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
            "TestNonPrimitiveTypes", [
                { one: "red", two: "blue" },
                { first: [42, 42], second: [43, 43] },
                [42, 'foo', 'bar'],
                ["one", "two"],
                ["/one", "/one/two"],
                ["ass", "git"],
                ["QUIA", "QkMA"]
            ]);
        assert.deepEqual(reply, [
            "{'one': 'red', 'two': 'blue'}{'first': (42, 42), 'second': (43, 43)}(42, 'foo', 'bar')array_of_strings: [one, two] array_of_objpaths: [/one, /one/two] array_of_signatures: [signature 'ass', 'git'] array_of_bytestrings: [AB, BC] "
        ], "round trip");
    });

    QUnit.test.skipWithPybridge("variants", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const reply = await dbus.call(
            "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
            "TestAsv", [{
                one: cockpit.variant("s", "foo"),
                two: cockpit.variant("o", "/bar"),
                three: cockpit.variant("g", "assgit"),
                four: cockpit.variant("y", 42),
                five: cockpit.variant("d", 1000.0)
            }]);
        assert.deepEqual(reply, [
            "{'one': <'foo'>, 'two': <objectpath '/bar'>, 'three': <signature 'assgit'>, 'four': <byte 0x2a>, 'five': <1000.0>}"
        ], "round trip");
    });

    QUnit.test.skipWithPybridge("bad variants", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call(
                "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TestAsv",
                [{
                    one: "foo",
                    two: "/bar",
                    three: "assgit",
                    four: 42,
                    five: 1000.0
                }]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
            assert.equal(ex.message, "Unexpected type 'string' in argument", "error message");
        }
    });

    QUnit.test("get all", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const reply = await dbus.call("/otree/frobber", "org.freedesktop.DBus.Properties", "GetAll",
                                      ["com.redhat.Cockpit.DBusTests.Frobber"]);
        assert.deepEqual(reply, [{
            FinallyNormalName: { t: "s", v: "There aint no place like home" },
            ReadonlyProperty: { t: "s", v: "blah" },
            aay: { t: "aay", v: [] },
            ag: { t: "ag", v: [] },
            ao: { t: "ao", v: [] },
            as: { t: "as", v: [] },
            ay: { t: "ay", v: "QUJDYWJjAA==" },
            b: { t: "b", v: false },
            d: { t: "d", v: 43 },
            g: { t: "g", v: "" },
            i: { t: "i", v: 0 },
            n: { t: "n", v: 0 },
            o: { t: "o", v: "/" },
            q: { t: "q", v: 0 },
            s: { t: "s", v: "" },
            t: { t: "t", v: 0 },
            u: { t: "u", v: 0 },
            x: { t: "x", v: 0 },
            y: { t: "y", v: 42 }
        }], "reply");
    });

    QUnit.test("call unimplemented", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "UnimplementedMethod", []);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
            assert.equal(ex.message, "Method UnimplementedMethod is not implemented on interface com.redhat.Cockpit.DBusTests.Frobber", "error message");
        }
    });

    QUnit.test.skipWithPybridge("call bad base64", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call(
                "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TestPrimitiveTypes",
                [10, true, 11, 12, 13, 14, 15, 16, 17, "a string", "/a/path", "asig", "Yooohooo!~ bad base64"]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
            assert.equal(ex.message, "Invalid base64 in argument", "error message");
        }
    });

    QUnit.test("call unknown", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "UnknownBlahMethod", [1]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
            assert.equal(ex.message, "Introspection data for method com.redhat.Cockpit.DBusTests.Frobber UnknownBlahMethod not available", "error message");
        }
    });

    QUnit.test("signals", async assert => {
        let received = false;
        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.subscribe({
            interface: "com.redhat.Cockpit.DBusTests.Frobber",
            path: "/otree/frobber"
        }, (path, iface, signal, args) => {
            if (received)
                return;
            assert.equal(path, "/otree/frobber", "got right path");
            assert.equal(iface, "com.redhat.Cockpit.DBusTests.Frobber", "got right path");
            assert.equal(signal, "TestSignal", "signals: got right path");
            assert.deepEqual(args, [
                43, ["foo", "frobber"], ["/foo", "/foo/bar"],
                { first: [42, 42], second: [43, 43] }], "got right arguments");
            received = true;
        });

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0]);
        assert.equal(received, true, "signal received");
    });

    QUnit.test("signal unsubscribe", async assert => {
        let received = false;
        const dbus = cockpit.dbus(bus_name, channel_options);

        function on_signal() {
            received = true;
        }

        const subscription = dbus.subscribe({
            interface: "com.redhat.Cockpit.DBusTests.Frobber",
            path: "/otree/frobber"
        }, on_signal);

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0]);
        assert.equal(received, true, "signal received");

        subscription.remove();
        received = false;
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0]);
        assert.equal(received, false, "signal not received");
    });

    QUnit.test("with types", assert => {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [{ one: "red", two: "blue" }, 55, 66, 32],
                  { type: "a{ss}uit" })
                .done(function(reply, options) {
                    assert.deepEqual(reply, [{ one: "red", two: "blue" }, 55, 66, 32], "round trip");
                    assert.equal(options.type, "a{ss}uit", "got back type");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.skipWithPybridge("empty base64", assert => {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [""],
                  { type: "ay" })
                .done(function(reply, options) {
                    assert.deepEqual(reply, [""], "round trip");
                    assert.equal(options.type, "ay", "got back type");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.skipWithPybridge("bad object path", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("invalid/path", "borkety.Bork", "Echo", [1]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "object path is invalid in dbus \"call\": invalid/path", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad interface name", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/path", "!invalid!interface!", "Echo", [1]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "interface name is invalid in dbus \"call\": !invalid!interface!", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad method name", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/path", "borkety.Bork", "!Invalid!Method!", [1]);
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "member name is invalid in dbus \"call\": !Invalid!Method!", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad flags", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/path", "borkety.Bork", "Method", [1], { flags: 5 });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "the \"flags\" field is invalid in dbus call", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad types", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/bork", "borkety.Bork", "Echo", [1], { type: "!!%%" });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "the \"type\" signature is not valid in dbus call: !!%%", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad type invalid", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/bork", "borkety.Bork", "Echo", [1], { type: 5 }); // invalid
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.problem, "protocol-error", "error name");
            assert.equal(ex.message, "the \"type\" field is invalid in call", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad dict type", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "Nobody",
                            [{ "!!!": "value" }], { type: "a{is}" });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
            assert.equal(ex.message, "Unexpected key '!!!' in dict entry", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad object path", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "Nobody",
                            ["not/a/path"], { type: "o" });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
            assert.equal(ex.message, "Invalid object path 'not/a/path'", "error message");
        }
    });

    QUnit.test.skipWithPybridge("bad signature", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        try {
            await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "Nobody", ["bad signature"], { type: "g" });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
            assert.equal(ex.message, "Invalid signature 'bad signature'", "error message");
        }
    });

    QUnit.test("flags", assert => {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["test"], { flags: "" })
                .done(function(reply, options) {
                    assert.equal(typeof options.flags, "string", "is string");
                    assert.ok(options.flags.indexOf(">") !== -1 || options.flags.indexOf("<") !== -1, "has byte order");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test("without introspection", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const reply = await dbus.call("/bork", "borkety.Bork", "Echo");
        assert.deepEqual(reply, [], "round trip");
    });

    QUnit.test("watch path", async assert => {
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        await dbus.watch("/otree/frobber");
        assert.equal(typeof cache["/otree/frobber"], "object", "has path");
        assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                         {
                             FinallyNormalName: "There aint no place like home",
                             ReadonlyProperty: "blah",
                             aay: [],
                             ag: [],
                             ao: [],
                             as: [],
                             ay: "QUJDYWJjAA==",
                             b: false,
                             d: 43,
                             g: "",
                             i: 0,
                             n: 0,
                             o: "/",
                             q: 0,
                             s: "",
                             t: 0,
                             u: 0,
                             x: 0,
                             y: 42
                         }, "correct data");
        dbus.removeEventListener("notify", onnotify);
    });

    QUnit.test("watch object manager", async assert => {
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        await dbus.watch({ path_namespace: "/otree" });
        assert.deepEqual(cache, {
            "/otree/frobber": {
                "com.redhat.Cockpit.DBusTests.Frobber":
                {
                    FinallyNormalName: "There aint no place like home",
                    ReadonlyProperty: "blah",
                    aay: [],
                    ag: [],
                    ao: [],
                    as: [],
                    ay: "QUJDYWJjAA==",
                    b: false,
                    d: 43,
                    g: "",
                    i: 0,
                    n: 0,
                    o: "/",
                    q: 0,
                    s: "",
                    t: 0,
                    u: 0,
                    x: 0,
                    y: 42
                }
            }
        }, "correct data");
        dbus.removeEventListener("notify", onnotify);
    });

    QUnit.test("watch change", async assert => {
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify_cache = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify_cache);

        let onnotify_test_called = false;

        const onnotify_test = (event, data) => {
            assert.equal(typeof cache["/otree/frobber"], "object", "has path");
            assert.deepEqual(cache, {
                "/otree/frobber": {
                    "com.redhat.Cockpit.DBusTests.Frobber": {
                        FinallyNormalName: "There aint no place like home",
                        ReadonlyProperty: "blah",
                        aay: [],
                        ag: [],
                        ao: [],
                        as: [],
                        ay: "QUJDYWJjAA==",
                        b: false,
                        d: 43,
                        g: "",
                        i: 0,
                        n: 0,
                        o: "/",
                        q: 0,
                        s: "",
                        t: 0,
                        u: 0,
                        x: 0,
                        y: 42
                    }
                }
            }, "correct data");
            dbus.removeEventListener("notify", onnotify_cache);
            dbus.removeEventListener("notify", onnotify_test);
            onnotify_test_called = true;
        };
        dbus.addEventListener("notify", onnotify_test);

        await dbus.watch("/otree/frobber");
        assert.ok(onnotify_test_called, "onnotify_test was called");
    });

    QUnit.test("watch barrier", async assert => {
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path_namespace: "/otree" });

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "HelloWorld", ["Browser-side JS"]);
        assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                         {
                             FinallyNormalName: "There aint no place like home",
                             ReadonlyProperty: "blah",
                             aay: [],
                             ag: [],
                             ao: [],
                             as: [],
                             ay: "QUJDYWJjAA==",
                             b: false,
                             d: 43,
                             g: "",
                             i: 0,
                             n: 0,
                             o: "/",
                             q: 0,
                             s: "",
                             t: 0,
                             u: 0,
                             x: 0,
                             y: 42
                         }, "correct data");
        dbus.removeEventListener("notify", onnotify);
    });

    QUnit.test("watch interfaces", async assert => {
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        await dbus.watch({ path_namespace: "/otree" });
        assert.deepEqual(cache, {
            "/otree/frobber": {
                "com.redhat.Cockpit.DBusTests.Frobber":
                {
                    FinallyNormalName: "There aint no place like home",
                    ReadonlyProperty: "blah",
                    aay: [],
                    ag: [],
                    ao: [],
                    as: [],
                    ay: "QUJDYWJjAA==",
                    b: false,
                    d: 43,
                    g: "",
                    i: 0,
                    n: 0,
                    o: "/",
                    q: 0,
                    s: "",
                    t: 0,
                    u: 0,
                    x: 0,
                    y: 42
                }
            }
        }, "correct data");

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "AddAlpha", []);
        assert.deepEqual(cache, {
            "/otree/frobber": {
                "com.redhat.Cockpit.DBusTests.Frobber":
            {
                FinallyNormalName: "There aint no place like home",
                ReadonlyProperty: "blah",
                aay: [],
                ag: [],
                ao: [],
                as: [],
                ay: "QUJDYWJjAA==",
                b: false,
                d: 43,
                g: "",
                i: 0,
                n: 0,
                o: "/",
                q: 0,
                s: "",
                t: 0,
                u: 0,
                x: 0,
                y: 42
            },
                "com.redhat.Cockpit.DBusTests.Alpha": {}
            }
        }, "correct data");

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RemoveAlpha", []);
        assert.deepEqual(cache, {
            "/otree/frobber": {
                "com.redhat.Cockpit.DBusTests.Frobber": {
                    FinallyNormalName: "There aint no place like home",
                    ReadonlyProperty: "blah",
                    aay: [],
                    ag: [],
                    ao: [],
                    as: [],
                    ay: "QUJDYWJjAA==",
                    b: false,
                    d: 43,
                    g: "",
                    i: 0,
                    n: 0,
                    o: "/",
                    q: 0,
                    s: "",
                    t: 0,
                    u: 0,
                    x: 0,
                    y: 42
                },
                "com.redhat.Cockpit.DBusTests.Alpha": null
            }
        }, "correct data");
        dbus.removeEventListener("notify", onnotify);
    });

    QUnit.test.skipWithPybridge("path loop", async assert => {
        const name = "yo" + new Date().getTime();
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => Object.assign(cache, data);
        dbus.addEventListener("notify", onnotify);

        await dbus.watch({ path_namespace: "/cliques/" + name });
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "CreateClique", [name]);
        const expect = { };
        /* The same way mock-service.c calculates the paths */
        for (let i = 0; i < 3; i++) {
            expect["/cliques/" + name + "/" + i] = {
                "com.redhat.Cockpit.DBusTests.Clique": {
                    Friend: "/cliques/" + name + "/" + (i + 1) % 3
                }
            };
        }
        assert.deepEqual(cache, expect, "got all data before method reply");
        dbus.removeEventListener("notify", onnotify);
    });

    QUnit.test.skipWithPybridge("path signal", async assert => {
        const name = "yo" + new Date().getTime();
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => Object.assign(cache, data);
        dbus.addEventListener("notify", onnotify);

        await dbus.watch({ path: "/hidden/" + name });
        assert.deepEqual(cache, { }, "no data yet");

        dbus.subscribe({ path: "/hidden/" + name }, function(path, iface, args) {
            assert.equal(typeof cache[path], "object", "have object");
            assert.deepEqual(cache[path], {
                "com.redhat.Cockpit.DBusTests.Hidden": { Name: name }
            }, "got data before signal");
            dbus.removeEventListener("notify", onnotify);
        });
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "EmitHidden", [name]);
    });

    QUnit.test("proxy", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
        await proxy.wait();
        assert.strictEqual(proxy.valid, true, "proxy: is valid");
        assert.deepEqual(proxy.data, {
            FinallyNormalName: "There aint no place like home",
            ReadonlyProperty: "blah",
            aay: [],
            ag: [],
            ao: [],
            as: [],
            ay: "QUJDYWJjAA==",
            b: false,
            d: 43,
            g: "",
            i: 0,
            n: 0,
            o: "/",
            q: 0,
            s: "",
            t: 0,
            u: 0,
            x: 0,
            y: 42
        }, "correct data");

        assert.strictEqual(proxy.FinallyNormalName, "There aint no place like home", "property value");
        assert.strictEqual(proxy.ReadonlyProperty, "blah", "another property value");

        assert.equal(typeof proxy.HelloWorld, "function", "has function defined");
        const message = await proxy.HelloWorld("From a proxy");
        assert.equal(message, "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
    });

    QUnit.test("proxy call", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        /* No wait */
        const args = await proxy.call("HelloWorld", ["From a proxy"]);
        assert.equal(args[0], "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
    });

    QUnit.test("proxy call with timeout", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        try {
            await proxy.call('NeverReturn', [], { timeout: 10 });
            assert.ok(false, "should not be reached");
        } catch (ex) {
            assert.ok(["org.freedesktop.DBus.Error.Timeout",
                "org.freedesktop.DBus.Error.NoReply"].indexOf(ex.name) >= 0);
        }
    });

    QUnit.test("proxy signal", async assert => {
        let received = false;

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        const onsignal = (event, name, args) => {
            assert.equal(name, "TestSignal", "signals: got right name");
            assert.deepEqual(args, [
                43, ["foo", "frobber"], ["/foo", "/foo/bar"],
                { first: [42, 42], second: [43, 43] }], "got right arguments");
            received = true;
        };
        proxy.addEventListener("signal", onsignal);

        await proxy.call("RequestSignalEmission", [0]);
        assert.equal(received, true, "signal received");
        proxy.removeEventListener("signal", onsignal);
    });

    QUnit.test("proxy explicit notify", async assert => {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        await proxy.wait();
        const onchanged = () => {
            assert.equal(proxy.FinallyNormalName, "externally injected");
            proxy.removeEventListener("changed", onchanged);
            done();
        };
        proxy.addEventListener("changed", onchanged);

        dbus.notify({
            "/otree/frobber": {
                "com.redhat.Cockpit.DBusTests.Frobber": {
                    FinallyNormalName: "externally injected"
                }
            }
        });
    });

    QUnit.test("proxies", async assert => {
        const dbus = cockpit.dbus(bus_name, channel_options);

        /* Just some cleanup */
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "DeleteAllObjects", []);
        const proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber", "/otree");
        await proxies.wait();

        let added;
        proxies.addEventListener("added", function(event, proxy) {
            added = proxy;
            assert.strictEqual(added.valid, true, "added objects valid");
        });

        let changed;
        proxies.addEventListener("changed", function(event, proxy) {
            changed = proxy;
        });

        let removed;
        proxies.addEventListener("removed", function(event, proxy) {
            removed = proxy;
        });

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "CreateObject", ["/otree/other"]);
        assert.equal(typeof added, "object", "got added object");
        assert.equal(typeof changed, "object", "no changed object yet");
        assert.equal(typeof removed, "undefined", "no removed object yet");
        assert.equal(added.path, "/otree/other", "added object correct");
        assert.strictEqual(added, changed, "added fires changed");

        changed = null;
        await dbus.call(added.path, added.iface, "RequestPropertyMods", []);
        assert.strictEqual(changed, added, "change fired");

        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "DeleteObject", ["/otree/other"]);
        assert.strictEqual(removed, added, "removed fired");
        assert.strictEqual(removed.valid, false, "removed is invalid");
        dbus.close();
    });
}

export function dbus_track_tests(channel_options, bus_name) {
    QUnit.test("track name", async assert => {
        const name = "yo.x" + new Date().getTime();

        const dbus = cockpit.dbus(bus_name, channel_options);
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "ClaimOtherName", [name]);

        const other = cockpit.dbus(name, {
            bus: channel_options.bus,
            address: channel_options.address,
            track: true
        });
        let gone = false;
        other.addEventListener("close", (_event, data) => {
            assert.strictEqual(data.problem, undefined, "no problem");
            gone = true;
        });
        await other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "HelloWorld", ["test"]);
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "ReleaseOtherName", [name]);
        assert.strictEqual(gone, true, "close handler was called");
    });

    QUnit.test("no track name", async assert => {
        const name = "yo.y" + new Date().getTime();

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "ClaimOtherName", [name]);

        const other = cockpit.dbus(name, channel_options);
        let gone = false;
        other.addEventListener("close", () => { gone = true });

        await other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "HelloWorld", ["test"]);
        await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "ReleaseOtherName", [name]);
        try {
            await other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "HelloWorld", ["test"]);
            assert.ok(false, "call after release should fail");
        } catch (ex) {
            assert.equal(ex.name, "org.freedesktop.DBus.Error.ServiceUnknown");
        }
        assert.equal(gone, false, "is not gone");
    });

    QUnit.test.skipWithPybridge("receive readable fd", async assert => {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        const [fd] = await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                     "MakeTestFd", ["readable"]);
        assert.equal(typeof (fd.internal), 'string');
        assert.equal(fd.payload, 'stream');

        const channel = cockpit.channel(fd);

        channel.onmessage = (_event, data) => {
            assert.equal(data, 'Hello, fd');
            channel.close();
            done();
        };
    });

    QUnit.test.skipWithPybridge("receive readable fd and ensure opening more than once fails", async assert => {
        const done = assert.async();
        assert.expect(6);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        const [fd] = await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                     "MakeTestFd", ["readable"]);
        assert.equal(typeof (fd.internal), 'string');
        assert.equal(fd.payload, 'stream');

        const channel1 = cockpit.channel(fd);
        assert.ok(channel1);
        const channel2 = cockpit.channel(fd);

        channel2.onclose = (_event, options) => {
            assert.equal(options.channel, channel2.id);
            assert.equal(options.command, 'close');
            assert.equal(options.problem, 'not-found');
            done();
        };
    });

    QUnit.test.skipWithPybridge("receive readable fd and ensure writing fails", async assert => {
        const done = assert.async();
        assert.expect(5);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        const [fd] = await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                     "MakeTestFd", ["readable"]);
        assert.equal(typeof (fd.internal), 'string');
        assert.equal(fd.payload, 'stream');

        const channel = cockpit.channel(fd);
        channel.send('Hello, fd');

        channel.onclose = (_event, options) => {
            assert.equal(options.channel, channel.id);
            assert.equal(options.command, 'close');
            assert.equal(options.problem, 'protocol-error');
            done();
        };
    });

    QUnit.test.skipWithPybridge("receive writable fd", async assert => {
        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        const [fd] = await dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                     "MakeTestFd", ["writable"]);
        assert.equal(typeof (fd.internal), 'string');
        assert.equal(fd.payload, 'stream');

        const channel = cockpit.channel(fd);
        channel.send('Hello, fd');
        channel.close();
    });
}
