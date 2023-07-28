import cockpit from "cockpit";
import QUnit from "qunit-tests";

import { common_dbus_tests, dbus_track_tests } from "./test-dbus-common.js";

/* with a name */
const options = {
    bus: "session"
};
common_dbus_tests(options, "com.redhat.Cockpit.DBusTests.Test");
dbus_track_tests(options, "com.redhat.Cockpit.DBusTests.Test");

QUnit.test("proxy no stutter", function (assert) {
    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });

    const proxy = dbus.proxy();
    assert.equal(proxy.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
    assert.equal(proxy.path, "/com/redhat/Cockpit/DBusTests/Test", "path auto chosen");
});

QUnit.test("proxies no stutter", function (assert) {
    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });

    const proxies = dbus.proxies();
    assert.equal(proxies.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
    assert.equal(proxies.path_namespace, "/", "path auto chosen");
});

QUnit.test("exposed client and options", function (assert) {
    const options = { host: "localhost", bus: "session" };
    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", options);
    const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
    const proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber");

    assert.deepEqual(dbus.options, options, "client object exposes options");
    assert.strictEqual(proxy.client, dbus, "proxy object exposes client");
    assert.strictEqual(proxies.client, dbus, "proxies object exposes client");
});

QUnit.test("subscriptions on closed client", function (assert) {
    function on_signal() {
    }

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    dbus.close();

    const subscription = dbus.subscribe({
        interface: "com.redhat.Cockpit.DBusTests.Frobber",
        path: "/otree/frobber"
    }, on_signal);
    assert.ok(subscription, "can subscribe");

    subscription.remove();
    assert.ok(true, "can unsubscribe");
});

QUnit.test("watch promise recursive", function (assert) {
    assert.expect(7);

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    const promise = dbus.watch("/otree/frobber");

    const target = { };
    const promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.remove, "function", "promise2.remove()");

    const promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.remove, "function", "promise3.remove()");
});

QUnit.test("owned messages", function (assert) {
    const done = assert.async();
    assert.expect(9);

    const name = "yo.x" + new Date().getTime();
    let times_changed = 0;

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    let other = null;
    let org_owner = null;
    function on_owner (event, owner) {
        if (times_changed === 0) {
            assert.strictEqual(typeof owner, "string", "initial owner string");
            assert.ok(owner.length > 1, "initial owner not empty");
            org_owner = owner;
        } else if (times_changed === 1) {
            assert.strictEqual(owner, null, "no owner");
        } else if (times_changed === 2) {
            // owner is the same because the server
            // dbus connection is too.
            assert.strictEqual(owner, org_owner, "has owner again");
        }
        times_changed++;
    }

    function acquire_name () {
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [name])
                .always(function() {
                    assert.equal(this.state(), "resolved", "name claimed");
                    if (!other) {
                        other = cockpit.dbus(name, { bus: "session" });
                        other.addEventListener("owner", on_owner);
                        release_name();
                    } else {
                        assert.strictEqual(times_changed, 3, "owner changed three times");
                        done();
                    }
                });
    }

    function release_name () {
        other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                   "HelloWorld", ["test"])
                .always(function() {
                    assert.equal(this.state(), "resolved", "called on other name");

                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                              "ReleaseOtherName", [name])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "name released");
                                acquire_name();
                            });
                });
    }
    acquire_name();
});

QUnit.test("owned message for absent service", assert => {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.NotExisting", { bus: "session" });
    dbus.addEventListener("owner", (_event, owner) => {
        assert.strictEqual(owner, null, "no owner");
        done();
    });
});

QUnit.test.skipWithPybridge("bad dbus address", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus(null, { bus: "none", address: "bad" });
    dbus.addEventListener("close", (event, options) => {
        assert.equal(options.problem, "protocol-error", "bad address closed");
        done();
    });
});

QUnit.test.skipWithPybridge("bad dbus bus", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus(null, { bus: "bad" });
    dbus.addEventListener("close", (event, options) => {
        assert.equal(options.problem, "protocol-error", "bad bus format");
        done();
    });
});

QUnit.test("wait ready", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    dbus.wait().then(function(options) {
        assert.ok(!!dbus.unique_name, "wait fills unique_name");
    }, function() {
        assert.ok(false, "shouldn't fail");
    })
            .always(function() {
                done();
            });
});

QUnit.test("wait fail", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.NotExisting", { bus: "session" });
    dbus.wait().then(function(options) {
        assert.ok(false, "shouldn't succeed");
    }, function() {
        assert.ok(true, "should fail");
    })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("no default name", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", ["Browser-side JS"], { name: "com.redhat.Cockpit.DBusTests.Test" })
            .then(function(reply) {
                assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"], "replied");
            }, function(ex) {
                assert.ok(false, "shouldn't fail");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("no default name bad", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", ["Browser-side JS"], { name: 5 })
            .then(function(reply) {
                assert.ok(false, "shouldn't succeed");
            }, function(ex) {
                assert.equal(ex.problem, "protocol-error", "error problem");
                assert.equal(ex.message, "the \"name\" field is invalid in dbus call", "error message");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("no default name invalid", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", ["Browser-side JS"], { name: "!invalid!" })
            .then(function(reply) {
                assert.ok(false, "shouldn't succeed");
            }, function(ex) {
                assert.equal(ex.problem, "protocol-error", "error problem");
                assert.equal(ex.message, "the \"name\" field in dbus call is not a valid bus name: !invalid!", "error message");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("no default name missing", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", ["Browser-side JS"])
            .then(function(reply) {
                assert.ok(false, "shouldn't succeed");
            }, function(ex) {
                assert.equal(ex.problem, "protocol-error", "error problem");
                assert.equal(ex.message, "the \"name\" field is missing in dbus call", "error message");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("no default name second", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
              { name: "com.redhat.Cockpit.DBusTests.Test" })
            .then(function(reply) {
                assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Test"], "right name");
                return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
                                 { name: "com.redhat.Cockpit.DBusTests.Second" })
                        .then(function(reply) {
                            assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Second"], "second name");
                        }, function(ex) {
                            assert.ok(false, "shouldn't fail");
                        });
            }, function(ex) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("override default name", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [])
            .then(function(reply) {
                assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Test"], "right name");
                return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
                                 { name: "com.redhat.Cockpit.DBusTests.Second" })
                        .then(function(reply) {
                            assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Second"], "second name");
                        }, function(ex) {
                            assert.ok(false, "shouldn't fail");
                        });
            }, function(ex) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
            })
            .always(function() {
                done();
            });
});

QUnit.test.skipWithPybridge("watch no default name", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const cache = { };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.addEventListener("notify", function(event, data) {
        Object.assign(cache, data);
    });

    dbus.watch({ path: "/otree/frobber", name: "com.redhat.Cockpit.DBusTests.Second" })
            .then(function() {
                assert.equal(typeof cache["/otree/frobber"], "object", "has path");
            }, function(ex) {
                assert.ok(false, "shouldn't fail");
            })
            .always(function() {
                dbus.close();
                done();
            });
});

QUnit.test.skipWithPybridge("watch missing name", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
    dbus.watch("/otree/frobber")
            .then(function() {
                assert.ok(false, "shouldn't succeed");
            }, function(ex) {
                assert.equal(ex.problem, "protocol-error", "error problem");
                assert.equal(ex.message, "session: no \"name\" specified in match", "error message");
            })
            .always(function() {
                dbus.close();
                done();
            });
});

QUnit.test.skipWithPybridge("shared client", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus1 = cockpit.dbus(null, { bus: "session" });
    const dbus2 = cockpit.dbus(null, { bus: "session" });

    /* Is identical */
    assert.strictEqual(dbus1, dbus2, "shared bus returned");

    /* Closing shouldn't close shared */
    dbus1.close();

    dbus2.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
               "HelloWorld", ["Browser-side JS"], { name: "com.redhat.Cockpit.DBusTests.Test" })
            .then(function(reply) {
                assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"],
                                 "call still works");
            }, function(ex) {
                assert.ok(false, "shouldn't fail");
            })
            .always(function() {
                done();
            });
});

QUnit.test("not shared option", function (assert) {
    assert.expect(1);

    const dbus1 = cockpit.dbus(null, { bus: "session" });
    const dbus2 = cockpit.dbus(null, { bus: "session", other: "option" });

    /* Should not be identical */
    assert.notStrictEqual(dbus1, dbus2, "shared bus returned");

    /* Closing shouldn't close shared */
    dbus1.close();
    dbus2.close();
});

QUnit.test.skipWithPybridge("emit signal type", function (assert) {
    const done = assert.async();
    assert.expect(4);

    let received = false;
    const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
    dbus.wait(function() {
        dbus.subscribe({ path: "/bork", name: dbus.unique_name }, function(path, iface, signal, args) {
            assert.equal(path, "/bork", "reflected path");
            assert.equal(iface, "borkety.Bork", "reflected interface");
            assert.equal(signal, "Bork", "reflected signal");
            assert.deepEqual(args, [1, 2, 3, 4, "Bork"], "reflected arguments");
            received = true;
            dbus.close();
            done();
        });

        dbus.addEventListener("close", function(event, ex) {
            if (!received) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
                done();
            }
        });

        dbus.signal("/bork", "borkety.Bork", "Bork", [1, 2, 3, 4, "Bork"],
                    { type: "iiiis" });
    });
});

QUnit.test.skipWithPybridge("emit signal no meta", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const dbus = cockpit.dbus(null, { bus: "session", other: "option" });

    function closed(event, ex) {
        assert.equal(ex.problem, "protocol-error", "correct problem");
        assert.equal(ex.message, "signal argument types for signal borkety.Bork Bork unknown", "correct message");
        dbus.removeEventListener("close", closed);
        dbus.close();
        done();
    }

    dbus.addEventListener("close", closed);
    dbus.signal("/bork", "borkety.Bork", "Bork", [1, 2, 3, 4, "Bork"]);
});

async function internal_test(assert, options) {
    const dbus = cockpit.dbus(null, options);
    const resp = await dbus.call("/", "org.freedesktop.DBus.Introspectable", "Introspect");
    assert.ok(String(resp[0]).indexOf("<node") !== -1, "introspected internal");
}

QUnit.test("internal dbus", async assert => internal_test(assert, { bus: "internal" }));

QUnit.test.skipWithPybridge("internal dbus bus none",
                            async assert => internal_test(assert, { bus: "none" }));

QUnit.test.skipWithPybridge("internal dbus bus none with address",
                            async assert => internal_test(assert, { bus: "none", address: "internal" }));

QUnit.test.skipWithPybridge("separate dbus connections for channel groups", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const channel1 = cockpit.channel({ payload: 'dbus-json3', group: 'foo', bus: 'session' });
    const channel2 = cockpit.channel({ payload: 'dbus-json3', group: 'bar', bus: 'session' });
    const channel3 = cockpit.channel({ payload: 'dbus-json3', group: 'foo', bus: 'session' });
    const channel4 = cockpit.channel({ payload: 'dbus-json3', group: 'baz', bus: 'session' });

    Promise.all([
        channel1.wait(), channel2.wait(), channel3.wait(), channel4.wait()
    ]).then(function ([ready1, ready2, ready3, ready4]) {
        assert.equal(ready1['unique-name'], ready3['unique-name']);
        assert.notEqual(ready1['unique-name'], ready2['unique-name']);
        assert.notEqual(ready1['unique-name'], ready4['unique-name']);
        assert.notEqual(ready2['unique-name'], ready4['unique-name']);
        done();
    });
});

QUnit.test("cockpit.Config internal D-Bus API", async assert => {
    const dbus = cockpit.dbus(null, { bus: "internal" });

    // Get temp config dir to see where to place our test config
    const reply = await dbus.call("/environment", "org.freedesktop.DBus.Properties", "Get",
                                  ["cockpit.Environment", "Variables"]);
    const configDir = reply[0].v.XDG_CONFIG_DIRS;
    await cockpit.file(configDir + "/cockpit/cockpit.conf").replace(`
[SomeSection]
SomeA = one
SomethingElse = 2
LargeNum = 12345

[Other]
Flavor=chocolate
Empty=
`);
    const proxy = dbus.proxy("cockpit.Config", "/config");
    await proxy.wait();
    await proxy.Reload();

    // test GetString()
    assert.equal(await proxy.GetString("SomeSection", "SomeA"), "one");
    assert.equal(await proxy.GetString("Other", "Empty"), "");

    // test GetUInt()

    // this key exists, ignores default
    assert.equal(await proxy.GetUInt("SomeSection", "SomethingElse", 10, 100, 0), 2);
    // this key does not exist, return default
    assert.equal(await proxy.GetUInt("SomeSection", "NotExisting", 10, 100, 0), 10);
    // out of bounds, clamp to minimum
    assert.equal(await proxy.GetUInt("SomeSection", "SomethingElse", 42, 50, 5), 5);
    // out of bounds, clamp to maximum
    assert.equal(await proxy.GetUInt("SomeSection", "LargeNum", 42, 50, 5), 50);
    // not an integer value, returns default
    assert.equal(await proxy.GetUInt("SomeSection", "SomeA", 10, 100, 0), 10);

    // test GetString with non-existing section
    assert.rejects(proxy.GetString("UnknownSection", "SomeKey"),
                   /key.*UnknownSection.*not exist/,
                   "unknown section raises an error");

    // test GetString with non-existing key in existing section
    assert.rejects(proxy.GetString("SomeSection", "UnknownKey"),
                   /key.*UnknownKey.*not exist/,
                   "unknown key raises an error");
});

QUnit.test("nonexisting address", async assert => {
    const dbus = cockpit.dbus("org.freedesktop.DBus", { address: "unix:path=/nonexisting", bus: "none" });

    try {
        await dbus.call("/org/freedesktop/DBus", "org.freedesktop.DBus", "Hello", []);
        assert.ok(false, "should not be reached");
    } catch (ex) {
        if (await QUnit.mock_info("pybridge")) {
            assert.equal(ex.problem, "protocol-error", "got right close code");
            assert.equal(ex.message, "failed to connect to none bus: [Errno 2] sd_bus_start: No such file or directory",
                         "error message");
        } else {
            // C bridge has a weird error code
            assert.equal(ex.problem, "internal-error", "got right close code");
            assert.equal(ex.message, "Could not connect: No such file or directory", "error message");
        }
    }
});

QUnit.start();
