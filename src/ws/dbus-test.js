/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

function basic_tests(client)
{
    test("Object lookup", function() {
        var obj;

        expect(2);

        obj = client.lookup("/otree/frobber");
        ok(obj, "Make sure existing object is returned");
        obj = client.lookup("/otree/frobber_non_existent");
        ok(!obj, "Make sure non-existing object is not returned");
    });

    test("Interface lookup", function() {
        var iface;

        expect(2);

        iface = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        ok(iface, "Look up object for com.redhat.Cockpit.DBusTests.Frobber D-Bus interface");

        iface = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber.NON_EXISTENT");
        ok(!iface, "Look up object for non-existant D-Bus interface");
    });

    test("D-Bus properties", function() {
        var frobber;

        expect(7);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        ok(frobber, "D-Bus interface existence");

        deepEqual(frobber.ay, [65, 66, 67, 97, 98, 99, 0], "Property");
        equal(frobber.y, 42, "Property");
        equal(frobber.d, 43.0, "Property");
        equal(frobber.FinallyNormalName, "There aint no place like home", "Property");
        equal(frobber.ReadonlyProperty, "blah", "Property");
        ok(!frobber.WriteonlyProperty, "Don't have 'WriteonlyProperty'");
    });

    asyncTest("Invoke HelloWorld()", function() {
        var frobber;

        expect(2);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("HelloWorld",
                     "Browser-side JS",
                     function (error, reply) {
                         ok(!error, "Error is not set");
                         equal(reply,
                               "Word! You said `Browser-side JS'. I'm Skeleton, btw!",
                               "Check HelloWorld() reply");
                         start();
                     });
    });

    test("Invoke method without a callback", function() {
        var frobber;

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("HelloWorld", "Browser-side JS", null);
        ok(true, "No exception thrown");
    });

    asyncTest("Invoke method returning an error", function() {
        var frobber;

        expect(3);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("UnimplementedMethod",
                     function (error) {
                         ok(error, "Error is set");
                         equal(error.name, "org.freedesktop.DBus.Error.UnknownMethod", "Check error.name");
                         equal(error.message, "Method UnimplementedMethod is not implemented on interface com.redhat.Cockpit.DBusTests.Frobber", "Check error.message");
                         start();
                     });
    });

    asyncTest("Invoke TestPrimitiveTypes()", function() {
        var frobber;

        expect(13);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("TestPrimitiveTypes",
                     10,
                     true,
                     11,
                     12,
                     13,
                     14,
                     15,
                     16,
                     17,
                     "a string",
                     "/a/path",
                     "asig",
                     [65, 66, 67, 0],
                     function (error, y, b, n, q, i, u, x, t, d, s, o, g, ay) {
                         ok(!error, "Error is not set");
                         equal(y, 20, "Checking arg value");
                         equal(b, false, "Checking arg value");
                         equal(n, 111, "Checking arg value");
                         equal(q, 1012, "Checking arg value");
                         equal(i, 10013, "Checking arg value");
                         equal(u, 100014, "Checking arg value");
                         equal(x, 1000015, "Checking arg value");
                         equal(t, 10000016, "Checking arg value");
                         equal(d, 17.0 / Math.PI, "Checking arg value");
                         equal(s, "Word! You said `a string'. Rock'n'roll!", "Checking arg value");
                         equal(g, "assgitasig", "Checking arg value");
                         deepEqual(ay, [98, 121, 116, 101, 115, 116, 114, 105, 110, 103, 33, 255, 0], "Checking arg value");
                         start();
                     });
    });

    asyncTest("Invoke TestNonPrimitiveTypes()", function() {
        var frobber;

        expect(2);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("TestNonPrimitiveTypes",
                     {one: "red", two: "blue"},
                     {first: [42, 42], second: [43, 43]},
                     [42, 'foo', 'bar'],
                     ["one", "two"],
                     ["/one", "/one/two"],
                     ["ass", "git"],
                     [[65, 66, 0], [66, 67, 0]],
                     function (error, str) {
                         ok(!error, "Error is not set");
                         equal(str, "{'one': 'red', 'two': 'blue'}{'first': (42, 42), 'second': (43, 43)}(42, 'foo', 'bar')array_of_strings: [one, two] array_of_objpaths: [/one, /one/two] array_of_signatures: [signature 'ass', 'git'] array_of_bytestrings: [AB, BC] ", "Checking arg value");
                         start();
                     });
    });

    asyncTest("Signals", function() {
        var frobber;

        expect(6);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        $(frobber).on("TestSignal",
                      function(event, val_int32, val_array_of_strings, val_array_of_objpaths, val_dict_s_to_pairs) {
                          ok(true, "Signal received");
                          equal(val_int32,
                                43,
                                "Checking arg value");
                          deepEqual(val_array_of_strings,
                                    ["foo", "frobber"],
                                    "Checking arg value");
                          deepEqual(val_array_of_objpaths,
                                    ["/foo", "/foo/bar"],
                                    "Checking arg value");
                          deepEqual(val_dict_s_to_pairs,
                                    {first: [42, 42], second: [43, 43]},
                                    "Checking arg value");
                      });
        frobber.call("RequestSignalEmission",
                     0,
                     function (error) {
                         ok(!error, "Error is not set");
                         start();
                     });
    });

    asyncTest("ObjectAdditionAndRemoval", function() {
        expect(19);

        var frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        var obj = frobber.getObject();
        ok(obj instanceof DBusObject, "Check type of enclosing object");
        equal(obj.objectPath, "/otree/frobber", "Check object path of enclosing object");
        frobber.call("DeleteAllObjects",
                     function(error) {
                         ok(!error, "Error is not set");
                         var obj = client.lookup("/otree/other", "com.redhat.Cockpit.DBusTests.Frobber");
                         ok(!obj, "Check /otree/other does not exist");

                         var receivedObjectAdded = false;
                         var receivedObjectRemoved = false;
                         $(client).on("objectAdded",
                                      function(event, obj) {
                                          receivedObjectAdded = true;
                                          equal(obj.objectPath, "/otree/other", "Check object path");
                                          ok(obj instanceof DBusObject, "Check type");
                                          ok(obj.lookup("com.redhat.Cockpit.DBusTests.Frobber") != null, "Has D-Bus iface");
                                          equal(obj.getInterfaces().length, 1, "Has only one D-Bus interface");
                                      });
                         $(client).on("objectRemoved",
                                      function(event, obj) {
                                          receivedObjectRemoved = true;
                                          equal(obj.objectPath, "/otree/other", "Check object path");
                                          ok(obj instanceof DBusObject, "Check type");
                                          ok(obj.lookup("com.redhat.Cockpit.DBusTests.Frobber") != null, "Has D-Bus iface");
                                          equal(obj.getInterfaces().length, 1, "Has only one D-Bus interface");
                                      });

                         frobber.call("CreateObject",
                                      "/otree/other",
                                      function(error) {
                                          ok(!error, "Error is not set");
                                          var obj = client.lookup("/otree/other", "com.redhat.Cockpit.DBusTests.Frobber");
                                          ok(obj, "Check that /otree/other exist");
                                          ok(receivedObjectAdded, "Have received objectAdded");
                                          ok(!receivedObjectRemoved, "Haven't received objectRemoved");
                                          frobber.call("DeleteObject",
                                                       "/otree/other",
                                                       function(error) {
                                                           ok(!error, "Error is not set");
                                                           var obj = client.lookup("/otree/other", "com.redhat.Cockpit.DBusTests.Frobber");
                                                           ok(!obj, "Check that /otree/other does not exist");
                                                           ok(receivedObjectRemoved, "Have received objectRemoved");
                                                           start();
                                                       });
                                      });
                     });
    });


    asyncTest("InterfaceAdditionAndRemoval", function() {
        expect(13);

        var frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        var obj = frobber.getObject();
        frobber.call("RemoveAlpha",
                     function(error) {
                         ok(!error, "Error is not set");
                         equal(obj.getInterfaces().length, 1, "Has only one D-Bus interface");

                         var receivedInterfaceAdded = false;
                         var receivedInterfaceRemoved = false;
                         $(client).on("interfaceAdded",
                                      function(event, object, iface) {
                                          receivedInterfaceAdded = true;
                                          ok(iface instanceof DBusInterface, "Check type");
                                          equal(iface.getObject().objectPath, "/otree/frobber", "Check object path");
                                      });
                         $(client).on("interfaceRemoved",
                                      function(event, object, iface) {
                                          receivedInterfaceRemoved = true;
                                          ok(iface instanceof DBusInterface, "Check type");
                                          equal(iface.getObject().objectPath, "/otree/frobber", "Check object path");
                                      });

                         frobber.call("AddAlpha",
                                      function(error) {
                                          ok(!error, "Error is not set");
                                          equal(obj.getInterfaces().length, 2, "Has two D-Bus interfaces");
                                          ok(receivedInterfaceAdded, "Have received interfaceAdded");
                                          ok(!receivedInterfaceRemoved, "Haven't received interfaceRemoved");
                                          frobber.call("RemoveAlpha",
                                                       function(error) {
                                                           ok(!error, "Error is not set");
                                                           equal(obj.getInterfaces().length, 1, "Has only one D-Bus interfaces");
                                                           ok(receivedInterfaceRemoved, "Have received interfaceRemoved");
                                                           start();
                                                       });
                                      });
                     });
    });

    asyncTest("Passing of non-annotated variants", function() {
        var frobber;

        expect(2);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("TestAsv",
                     {one: "foo",
                      two: "/bar",
                      three: "assgit",
                      four: 42,
                      five: 1000.0},
                     function (error, reply) {
                         ok(!error, "Error is not set");
                         equal(reply,
                               "{'one': <'foo'>, 'two': <'/bar'>, 'three': <'assgit'>, 'four': <int64 42>, 'five': <int64 1000>}",
                               "Check HelloWorld() reply");
                         start();
                     });
    });

    asyncTest("Passing of annotated variants", function() {
        var frobber;

        expect(2);

        frobber = client.lookup("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
        frobber.call("TestAsv",
                     {one: new DBusValue("s", "foo"),
                      two: new DBusValue("o", "/bar"),
                      three: new DBusValue("g", "assgit"),
                      four: new DBusValue("y", 42),
                      five: new DBusValue("d", 1000.0)},
                     function (error, reply) {
                         ok(!error, "Error is not set");
                         equal(reply,
                               "{'one': <'foo'>, 'two': <objectpath '/bar'>, 'three': <signature 'assgit'>, 'four': <byte 0x2a>, 'five': <1000.0>}",
                               "Check HelloWorld() reply");
                         start();
                     });
    });

}

var test_details = null;

function done(details)
{
    test_details = details;
    phantom_checkpoint ();
}

function dbus_test()
{
    var client = new DBusClient("localhost");
    $(client).on("state-change", function(event) {
        if (client.state == "ready") {
            basic_tests(client);
            QUnit.done(done);
            QUnit.start();
        }
    });
}
