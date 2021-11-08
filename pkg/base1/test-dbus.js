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

QUnit.test("bad dbus address", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const dbus = cockpit.dbus(null, { bus: "none", address: "bad" });
    dbus.addEventListener("close", (event, options) => {
        assert.equal(options.problem, "protocol-error", "bad address closed");
        done();
    });
});

QUnit.test("bad dbus bus", function (assert) {
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

    const dbus = cockpit.dbus(null, { bus: "none", address: "bad" });
    dbus.wait().then(function(options) {
        assert.ok(false, "shouldn't succeed");
    }, function() {
        assert.ok(true, "should fail");
    })
            .always(function() {
                done();
            });
});

QUnit.test("no default name", function (assert) {
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

QUnit.test("no default name bad", function (assert) {
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

QUnit.test("no default name invalid", function (assert) {
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

QUnit.test("no default name missing", function (assert) {
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

QUnit.test("no default name second", function (assert) {
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

QUnit.test("override default name", function (assert) {
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

QUnit.test("watch no default name", function (assert) {
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

QUnit.test("watch missing name", function (assert) {
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

QUnit.test("shared client", function (assert) {
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

QUnit.test("emit signal meta", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const meta = {
        "borkety.Bork": {
            signals: {
                Bork: {
                    in: ["i", "i", "i", "i", "s"]
                }
            }
        }
    };

    let received = false;
    const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
    dbus.meta(meta);
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

QUnit.test("emit signal type", function (assert) {
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

QUnit.test("emit signal no meta", function (assert) {
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

QUnit.test("publish object", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const info = {
        "org.Interface": {
            methods: {
                Add: { in: ["i", "i"], out: ["s"] },
                Live: { in: ["s"] },
            }
        }
    };

    let received = null;

    const object = {
        Add: function(one, two) {
            return String(one + two);
        },
        Live: function(input) {
            received = input;
        }
    };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        const published = dbus.publish("/a/path", "org.Interface", object);

        published.then(function() {
            assert.ok(true, "should resolve");
        }, function() {
            assert.ok(!true, "should not have failed");
        });

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Live", ["marmalade"], { name: dbus.unique_name });
        dbus.call("/a/path", "org.Interface", "Add", [3, 44], { name: dbus.unique_name })
                .then(function(reply) {
                    assert.ok(published, "object was published");
                    assert.deepEqual(reply, ["47"], "got back right reply");
                    assert.strictEqual(received, "marmalade", "received right arguments");
                }, function(ex) {
                    assert.ok(false, "should not have failed");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });
});

QUnit.test("publish object promise", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const info = {
        "org.Interface": {
            methods: {
                Add: { in: ["i", "i"], out: ["s", "i", "i"] },
            }
        }
    };

    const object = {
        Add: function(one, two) {
            const defer = cockpit.defer();
            window.setTimeout(function() {
                defer.resolve(String(one + two), one, two);
            }, 200);
            return defer.promise;
        }
    };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Add", [3, 44], { name: dbus.unique_name })
                .then(function(reply) {
                    assert.deepEqual(reply, ["47", 3, 44], "got back right reply");
                }, function(ex) {
                    assert.ok(false, "should not have failed");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });
});

QUnit.test("publish object failure", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const info = {
        "org.Interface": {
            methods: {
                Fails: { in: ["i", "i"], out: ["s", "i", "i"] },
            }
        }
    };

    const object = {
        Fails: function(one, two) {
            const defer = cockpit.defer();
            const ex = new Error("this is the message");
            ex.name = "org.Error";
            window.setTimeout(function() {
                defer.reject(ex);
            }, 5);
            return defer.promise;
        }
    };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Fails", [3, 44], { name: dbus.unique_name })
                .then(function(reply) {
                    assert.ok(false, "should not have succeeded");
                }, function(ex) {
                    assert.strictEqual(ex.name, "org.Error", "got right error name");
                    assert.strictEqual(ex.message, "this is the message", "got right error message");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });
});

QUnit.test("publish object replaces", function (assert) {
    const done = assert.async();
    assert.expect(2);

    const info = {
        "org.Interface": {
            methods: {
                Bonk: { in: ["s"], out: ["s"] },
            }
        }
    };

    const object1 = {
        Bonk: function(input) {
            return input + " bonked";
        }
    };

    const object2 = {
        Bonk: function(input) {
            return "nope not bonked";
        }
    };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        dbus.publish("/a/path", "org.Interface", object1);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                .then(function(reply) {
                    assert.deepEqual(reply, ["hi bonked"], "got back reply from first object");
                    dbus.publish("/a/path", "org.Interface", object2);
                    dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                            .then(function(reply) {
                                assert.deepEqual(reply, ["nope not bonked"], "got back reply from second object");
                            }, function() {
                                assert.ok(false, "should not have failed");
                            })
                            .always(function() {
                                dbus.close();
                                done();
                            });
                }, function(ex) {
                    assert.ok(false, "should not have failed");
                });
    });
});

QUnit.test("publish object unpublish", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const info = {
        "org.Interface": {
            methods: {
                Bonk: { in: ["s"], out: ["s"] },
            }
        }
    };

    const object = {
        Bonk: function(input) {
            return input + " bonked";
        }
    };

    const dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        const published = dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                .then(function(reply) {
                    assert.deepEqual(reply, ["hi bonked"], "got back reply from first object");
                    published.remove();

                    dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                            .then(function(reply) {
                                assert.ok(false, "should not have succeeded");
                            }, function(ex) {
                                assert.strictEqual(ex.name, "org.freedesktop.DBus.Error.UnknownMethod",
                                                   "got right error name");
                                assert.ok(ex.message.includes("No such interface") ||
                                          ex.message.includes("Object does not exist"),
                                          "unexpected error: " + ex.message);
                                assert.ok(ex.message.indexOf("/a/path") > 0, "unexpected error: " + ex.message);
                            })
                            .always(function() {
                                dbus.close();
                                done();
                            });
                }, function(ex) {
                    assert.ok(false, "should not have failed");
                });
    });
});

function internal_test(assert, options) {
    const done = assert.async();
    assert.expect(2);
    const dbus = cockpit.dbus(null, options);
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
    internal_test(assert, { bus: "internal" });
});

QUnit.test("internal dbus bus none", function (assert) {
    internal_test(assert, { bus: "none" });
});

QUnit.test("internal dbus bus none with address", function (assert) {
    internal_test(assert, { bus: "none", address: "internal" });
});

QUnit.test("separate dbus connections for channel groups", function (assert) {
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

QUnit.test("cockpit.Config internal D-Bus API", function (assert) {
    const done = assert.async();
    assert.expect(6);

    const dbus = cockpit.dbus(null, { bus: "internal" });
    let configDir;
    let proxy;

    // Get temp config dir to see where to place our test config
    dbus.call("/environment", "org.freedesktop.DBus.Properties", "Get", ["cockpit.Environment", "Variables"])
            .then(reply => {
                configDir = reply[0].v.XDG_CONFIG_DIRS;
                return cockpit.file(configDir + "/cockpit/cockpit.conf").replace(`
[SomeSection]
SomeA = one
SomethingElse = 2

[Other]
Flavor=chocolate
Empty=
`);
            })
            .then(() => {
                proxy = dbus.proxy("cockpit.Config", "/config");
                return proxy.wait();
            })
            // the above changes the config after bridge startup, so reload
            .then(() => proxy.Reload())

            // test GetString()
            .then(() => proxy.GetString("SomeSection", "SomeA"))
            .then(result => {
                assert.equal(result, "one");
                return proxy.GetString("Other", "Empty");
            })

            // test GetUInt()
            .then(result => {
                assert.equal(result, "");
                // this key exists, ignores default
                return proxy.GetUInt("SomeSection", "SomethingElse", 10, 100, 0);
            })
            .then(result => {
                assert.equal(result, 2);
                // this key does not exist, return default
                return proxy.GetUInt("SomeSection", "NotExisting", 10, 100, 0);
            })
            .then(result => {
                assert.equal(result, 10);
                // out of bounds, clamp to minimum
                return proxy.GetUInt("SomeSection", "SomethingElse", 42, 50, 5);
            })
            .catch(err => console.error("unexpected error:", JSON.stringify(err)))

            .then(result => {
                assert.equal(result, 5);

                // test GetString with non-existing section/key
                assert.rejects(proxy.GetString("SomeSection", "UnknownKey"),
                               /key.*UnknownKey.*not exist/,
                               "unknown key raises an error");
            })
            .finally(done);
});

QUnit.start();
