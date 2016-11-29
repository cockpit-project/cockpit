/* global $, cockpit, QUnit, common_dbus_tests, dbus_track_tests */

/* To help with future migration */
var assert = QUnit;

/* with a name */
var options = {
    "bus": "session"
};
common_dbus_tests(options, "com.redhat.Cockpit.DBusTests.Test");
dbus_track_tests(options, "com.redhat.Cockpit.DBusTests.Test");

QUnit.test("proxy no stutter", function() {
    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });

    var proxy = dbus.proxy();
    assert.equal(proxy.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
    assert.equal(proxy.path, "/com/redhat/Cockpit/DBusTests/Test", "path auto chosen");
});

QUnit.test("proxies no stutter", function() {
    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });

    var proxies = dbus.proxies();
    assert.equal(proxies.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
    assert.equal(proxies.path_namespace, "/", "path auto chosen");
});

QUnit.test("exposed client and options", function() {
    var options = { host: "localhost", "bus": "session" };
    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", options);
    var proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
    var proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber");

    assert.deepEqual(dbus.options, options, "client object exposes options");
    assert.strictEqual(proxy.client, dbus, "proxy object exposes client");
    assert.strictEqual(proxies.client, dbus, "proxies object exposes client");
});

QUnit.test("subscriptions on closed client", function() {
    function on_signal() {
    }

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    dbus.close();

    var subscription = dbus.subscribe({
        "interface": "com.redhat.Cockpit.DBusTests.Frobber",
        "path": "/otree/frobber"
    }, on_signal);
    assert.ok(subscription, "can subscribe");

    subscription.remove();
    assert.ok(true, "can unsubscribe");
});

QUnit.test("watch promise recursive", function() {
    assert.expect(7);

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    var promise = dbus.watch("/otree/frobber");

    var target = { };
    var promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.remove, "function", "promise2.remove()");

    var promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.remove, "function", "promise3.remove()");
});

QUnit.asyncTest("owned messages", function() {
    assert.expect(9);

    var name = "yo.x" + new Date().getTime();
    var times_changed = 0;

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    var other = null;
    var org_owner = null;
    function on_owner (event, owner) {
        if (times_changed === 0) {
            assert.strictEqual(typeof owner, "string", "intial owner string");
            assert.ok(owner.length > 1, "intial owner not empty");
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
                  "ClaimOtherName", [ name ])
            .always(function() {
                assert.equal(this.state(), "resolved", "name claimed");
                if (!other) {
                    other = cockpit.dbus(name, { "bus": "session" });
                    $(other).on("owner", on_owner);
                    release_name();
                } else {
                    assert.strictEqual(times_changed, 3, "owner changed three times");
                    QUnit.start();
                }
            });
    }

    function release_name () {
        other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                        "HelloWorld", [ "test" ])
                  .always(function() {
                        assert.equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [ name ])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "name released");
                                acquire_name();
                            });
                  });
    }
    acquire_name();
});

QUnit.asyncTest("bad dbus address", function() {
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "none", "address": "bad" });
    $(dbus).on("close", function(event, options) {
        assert.equal(options.problem, "protocol-error", "bad address closed");
        QUnit.start();
    });
});

QUnit.asyncTest("bad dbus bus", function() {
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "bad" });
    $(dbus).on("close", function(event, options) {
        assert.equal(options.problem, "protocol-error", "bad bus format");
        QUnit.start();
    });
});

QUnit.asyncTest("wait ready", function() {
    assert.expect(1);

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    dbus.wait().then(function(options) {
        assert.ok(!!dbus.unique_name, "wait fills unique_name");
    }, function() {
        assert.ok(false, "shouldn't fail");
    }).always(function() {
        QUnit.start();
    });
});

QUnit.asyncTest("wait fail", function() {
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "none", "address": "bad" });
    dbus.wait().then(function(options) {
        assert.ok(false, "shouldn't succeed");
    }, function() {
        assert.ok(true, "should fail");
    }).always(function() {
        QUnit.start();
    });
});

QUnit.asyncTest("no default name", function() {
    assert.expect(1);

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", [ "Browser-side JS" ], { "name": "com.redhat.Cockpit.DBusTests.Test" }).
        then(function(reply) {
            assert.deepEqual(reply, [ "Word! You said `Browser-side JS'. I'm Skeleton, btw!" ], "replied");
        }, function(ex) {
            assert.ok(false, "shouldn't fail");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("no default name bad", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", [ "Browser-side JS" ], { "name": 5 }).
        then(function(reply) {
            assert.ok(false, "shouldn't succeed");
        }, function(ex) {
            assert.equal(ex.problem, "protocol-error", "error problem");
            assert.equal(ex.message, "the \"name\" field is invalid in dbus call", "error message");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("no default name invalid", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", [ "Browser-side JS" ], { "name": "!invalid!" }).
        then(function(reply) {
            assert.ok(false, "shouldn't succeed");
        }, function(ex) {
            assert.equal(ex.problem, "protocol-error", "error problem");
            assert.equal(ex.message, "the \"name\" field in dbus call is not a valid bus name: !invalid!", "error message");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("no default name missing", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", [ "Browser-side JS" ]).
        then(function(reply) {
            assert.ok(false, "shouldn't succeed");
        }, function(ex) {
            assert.equal(ex.problem, "protocol-error", "error problem");
            assert.equal(ex.message, "the \"name\" field is missing in dbus call", "error message");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("no default name second", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [ ],
            { "name": "com.redhat.Cockpit.DBusTests.Test" })
        .then(function(reply) {
            assert.deepEqual(reply, [ "com.redhat.Cockpit.DBusTests.Test" ], "right name");
            return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [ ],
                    { "name": "com.redhat.Cockpit.DBusTests.Second" })
                .then(function(reply) {
                    assert.deepEqual(reply, [ "com.redhat.Cockpit.DBusTests.Second" ], "second name");
                }, function(ex) {
                    assert.ok(false, "shouldn't fail");
                });
        }, function(ex) {
            console.log(ex);
            assert.ok(false, "shouldn't fail");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("override default name", function() {
    assert.expect(2);

    var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [ ])
        .then(function(reply) {
            assert.deepEqual(reply, [ "com.redhat.Cockpit.DBusTests.Test" ], "right name");
            return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [ ],
                    { "name": "com.redhat.Cockpit.DBusTests.Second" })
                .then(function(reply) {
                    assert.deepEqual(reply, [ "com.redhat.Cockpit.DBusTests.Second" ], "second name");
                }, function(ex) {
                    assert.ok(false, "shouldn't fail");
                });
        }, function(ex) {
            console.log(ex);
            assert.ok(false, "shouldn't fail");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.asyncTest("watch no default name", function() {
    assert.expect(1);

    var cache = { };

    var dbus = cockpit.dbus(null, { "bus": "session" });
    dbus.addEventListener("notify", function(event, data) {
        $.extend(true, cache, data);
    });

    var ret = dbus.watch({ "path": "/otree/frobber", "name": "com.redhat.Cockpit.DBusTests.Second" })
        .then(function() {
            assert.equal(typeof cache["/otree/frobber"], "object", "has path");
        }, function(ex) {
            assert.ok(false, "shouldn't fail");
        })
        .always(function() {
            dbus.close();
            QUnit.start();
        });
});

QUnit.asyncTest("watch missing name", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session", "other": "option" });
    dbus.watch("/otree/frobber")
        .then(function() {
            assert.ok(false, "shouldn't succeed");
        }, function(ex) {
            assert.equal(ex.problem, "protocol-error", "error problem");
            assert.equal(ex.message, "session: no \"name\" specified in match", "error message");
        })
        .always(function() {
            dbus.close();
            QUnit.start();
        });
});

QUnit.asyncTest("shared client", function() {
    assert.expect(2);

    var dbus1 = cockpit.dbus(null, { "bus": "session" });
    var dbus2 = cockpit.dbus(null, { "bus": "session" });

    /* Is identical */
    assert.strictEqual(dbus1, dbus2, "shared bus returned");

    /* Closing shouldn't close shared */
    dbus1.close();

    dbus2.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
              "HelloWorld", [ "Browser-side JS" ], { "name": "com.redhat.Cockpit.DBusTests.Test" }).
        then(function(reply) {
            assert.deepEqual(reply, [ "Word! You said `Browser-side JS'. I'm Skeleton, btw!" ],
                    "call still works");
        }, function(ex) {
            assert.ok(false, "shouldn't fail");
        }).always(function() {
            QUnit.start();
        });
});

QUnit.test("not shared option", function() {
    assert.expect(1);

    var dbus1 = cockpit.dbus(null, { "bus": "session" });
    var dbus2 = cockpit.dbus(null, { "bus": "session", "other": "option" });

    /* Should not be identical */
    assert.notStrictEqual(dbus1, dbus2, "shared bus returned");

    /* Closing shouldn't close shared */
    dbus1.close();
    dbus2.close();
});

QUnit.asyncTest("emit signal meta", function() {
    assert.expect(4);

    var meta = {
        "borkety.Bork": {
            "signals": {
                "Bork": {
                    "in": [ "i", "i", "i", "i", "s" ]
                }
            }
        }
    };

    var received = false;
    var dbus = cockpit.dbus(null, { "bus": "session", "other": "option" });
    dbus.meta(meta);
    dbus.wait(function() {

        dbus.subscribe({ "path": "/bork", "name": dbus.unique_name }, function(path, iface, signal, args) {
            assert.equal(path, "/bork", "reflected path");
            assert.equal(iface, "borkety.Bork", "reflected interface");
            assert.equal(signal, "Bork", "reflected signal");
            assert.deepEqual(args, [ 1, 2, 3, 4, "Bork" ], "reflected arguments");
            received = true;
            dbus.close();
            QUnit.start();
        });

        dbus.addEventListener("close", function(event, ex) {
            if (!received) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
                QUnit.start();
            }
        });

        dbus.signal("/bork", "borkety.Bork", "Bork", [ 1, 2, 3, 4, "Bork" ],
                    { "type": "iiiis" });
    });
});

QUnit.asyncTest("emit signal type", function() {
    assert.expect(4);

    var received = false;
    var dbus = cockpit.dbus(null, { "bus": "session", "other": "option" });
    dbus.wait(function() {

        dbus.subscribe({ "path": "/bork", "name": dbus.unique_name }, function(path, iface, signal, args) {
            assert.equal(path, "/bork", "reflected path");
            assert.equal(iface, "borkety.Bork", "reflected interface");
            assert.equal(signal, "Bork", "reflected signal");
            assert.deepEqual(args, [ 1, 2, 3, 4, "Bork" ], "reflected arguments");
            received = true;
            dbus.close();
            QUnit.start();
        });

        dbus.addEventListener("close", function(event, ex) {
            if (!received) {
                console.log(ex);
                assert.ok(false, "shouldn't fail");
                QUnit.start();
            }
        });

        dbus.signal("/bork", "borkety.Bork", "Bork", [ 1, 2, 3, 4, "Bork" ],
                    { "type": "iiiis" });
    });
});

QUnit.asyncTest("emit signal no meta", function() {
    assert.expect(2);

    var dbus = cockpit.dbus(null, { "bus": "session", "other": "option" });

    function closed(event, ex) {
        assert.equal(ex.problem, "protocol-error", "correct problem");
        assert.equal(ex.message, "signal argument types for signal borkety.Bork Bork unknown", "correct message");
        dbus.removeEventListener("close", closed);
        dbus.close();
        QUnit.start();
    }

    dbus.addEventListener("close", closed);
    dbus.signal("/bork", "borkety.Bork", "Bork", [ 1, 2, 3, 4, "Bork" ]);
});

QUnit.asyncTest("publish object", function() {
    assert.expect(3);

    var info = {
        "org.Interface": {
            "methods": {
                "Add": { "in": [ "i", "i" ], "out": [ "s" ] },
                "Live": { "in": [ "s" ] },
            }
        }
    };

    var received = null;

    var object = {
        Add: function(one, two) {
            return String(one + two);
        },
        Live: function(input) {
            received = input;
        }
    };

    var resolved = false;

    var dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        var published = dbus.publish("/a/path", "org.Interface", object);

        published.then(function() {
            resolved = true;
        }, function() {
            assert.ok(!true, "should not have failed");
        });

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Live", [ "marmalade" ], { name: dbus.unique_name });
        dbus.call("/a/path", "org.Interface", "Add", [ 3, 44 ], { name: dbus.unique_name })
            .then(function(reply) {
                assert.ok(published, "object was published");
                assert.deepEqual(reply, [ "47" ], "got back right reply");
                assert.strictEqual(received, "marmalade", "received right arguments");
            }, function(ex) {
                assert.ok(false, "should not have failed");
            }).always(function() {
                dbus.close();
                QUnit.start();
            });
    });
});

QUnit.asyncTest("publish object promise", function() {
    assert.expect(1);

    var info = {
        "org.Interface": {
            "methods": {
                "Add": { "in": [ "i", "i" ], "out": [ "s", "i", "i" ] },
            }
        }
    };

    var object = {
        Add: function(one, two) {
            var defer = cockpit.defer();
            window.setTimeout(function() {
                defer.resolve(String(one + two), one, two);
            }, 200);
            return defer.promise;
        }
    };

    var dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        var published = dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Add", [ 3, 44 ], { name: dbus.unique_name })
            .then(function(reply) {
                assert.deepEqual(reply, [ "47", 3, 44 ], "got back right reply");
            }, function(ex) {
                assert.ok(false, "should not have failed");
            }).always(function() {
                dbus.close();
                QUnit.start();
            });
    });
});

QUnit.asyncTest("publish object failure", function() {
    assert.expect(2);

    var info = {
        "org.Interface": {
            "methods": {
                "Fails": { "in": [ "i", "i" ], "out": [ "s", "i", "i" ] },
            }
        }
    };

    var object = {
        Fails: function(one, two) {
            var defer = cockpit.defer();
            var ex = new Error("this is the message");
            ex.name = "org.Error";
            window.setTimeout(function() {
                defer.reject(ex);
            }, 5);
            return defer.promise;
        }
    };

    var dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        var published = dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Fails", [ 3, 44 ], { name: dbus.unique_name })
            .then(function(reply) {
                assert.ok(false, "should not have succeeded");
            }, function(ex) {
                assert.strictEqual(ex.name, "org.Error", "got right error name");
                assert.strictEqual(ex.message, "this is the message", "got right error message");
            }).always(function() {
                dbus.close();
                QUnit.start();
            });
    });
});

QUnit.asyncTest("publish object replaces", function() {
    assert.expect(2);

    var info = {
        "org.Interface": {
            "methods": {
                "Bonk": { "in": [ "s" ], "out": [ "s" ] },
            }
        }
    };

    var object1 = {
        Bonk: function(input) {
            return input + " bonked";
        }
    };

    var object2 = {
        Bonk: function(input) {
            return "nope not bonked";
        }
    };

    var dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        dbus.publish("/a/path", "org.Interface", object1);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Bonk", [ "hi" ], { name: dbus.unique_name })
            .then(function(reply) {
                assert.deepEqual(reply, [ "hi bonked" ], "got back reply from first object");
                dbus.publish("/a/path", "org.Interface", object2);
                dbus.call("/a/path", "org.Interface", "Bonk", [ "hi" ], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.deepEqual(reply, [ "nope not bonked" ], "got back reply from second object");
                    }, function() {
                        assert.ok(false, "should not have failed");
                    }).always(function() {
                        dbus.close();
                        QUnit.start();
                    });
            }, function(ex) {
                assert.ok(false, "should not have failed");
            });
    });
});

QUnit.asyncTest("publish object unpublish", function() {
    assert.expect(3);

    var info = {
        "org.Interface": {
            "methods": {
                "Bonk": { "in": [ "s" ], "out": [ "s" ] },
            }
        }
    };

    var object = {
        Bonk: function(input) {
            return input + " bonked";
        }
    };

    var dbus = cockpit.dbus(null, { bus: "session" });
    dbus.meta(info);
    dbus.wait().then(function() {
        var published = dbus.publish("/a/path", "org.Interface", object);

        /* Note that we're calling ourselves, but via the bus */
        dbus.call("/a/path", "org.Interface", "Bonk", [ "hi" ], { name: dbus.unique_name })
            .then(function(reply) {
                assert.deepEqual(reply, [ "hi bonked" ], "got back reply from first object");
                published.remove();

                dbus.call("/a/path", "org.Interface", "Bonk", [ "hi" ], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.ok(false, "should not have succeeded");
                    }, function(ex) {
                        assert.strictEqual(ex.name, "org.freedesktop.DBus.Error.UnknownMethod",
                                           "got right error name");
                        assert.strictEqual(ex.message,
                                "No such interface 'org.Interface' on object at path /a/path",
                                "got right error message");
                    }).always(function() {
                        dbus.close();
                        QUnit.start();
                    });
            }, function(ex) {
                assert.ok(false, "should not have failed");
            });
    });
});

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

QUnit.start();
