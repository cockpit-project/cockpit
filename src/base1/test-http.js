/* global $, cockpit, QUnit, ArrayBuffer, Uint8Array */

/* To help with future migration */
var assert = QUnit;

/* Set this to a regexp to ignore that warning once */
function console_ignore_warning(exp) {
    var console_warn = console.warn;
    console.warn = function() {
        if (!exp.exec(arguments[0]))
            console_warn.apply(console, arguments);
        console.warn = console_warn;
    };
}

QUnit.test("public api", function() {
    var client = cockpit.http("/test");
    assert.equal(typeof client, "object", "http is an object");
    assert.equal(typeof client.get, "function", "http.get() is a function");
    assert.equal(typeof client.post, "function", "http.post() is a function");
});

QUnit.asyncTest("simple request", function() {
    assert.expect(2);

    cockpit.http({ "internal": "/test-server" }).get("/pkg/playground/manifest.json")
        .done(function(data) {
            assert.deepEqual(JSON.parse(data), {
                version: "@VERSION@",
                'requires': {
                    "cockpit": "122"
                },
                tools: {
                    'patterns': {
                        label: "Design Patterns",
                        path: "jquery-patterns.html"
                    },
                    'react-patterns': {
                        label: "React Patterns"
                    },
                    'translate': {
                        label: "Translating"
                    }
                }
            }, "returned right data");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("with params", function() {
    assert.expect(2);

    cockpit.http({ "internal": "/test-server" })
        .get("/mock/qs", { "key": "value", "name": "Scruffy the Janitor" })
        .done(function(resp) {
            assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("not found", function() {
    assert.expect(6);

    cockpit.http({ "internal": "/test-server" })
        .get("/not/found")
        .response(function(status, headers) {
            assert.equal(status, 404, "status code");
        })
        .fail(function(ex, data) {
            assert.strictEqual(ex.problem, null, "mapped to cockpit code");
            assert.strictEqual(ex.status, 404, "has status code");
            assert.equal(ex.message, "Not Found", "has reason");
            assert.equal(data, "<html><head><title>Not Found</title></head><body>Not Found</body></html>\n", "got body");
        })
        .always(function() {
            assert.equal(this.state(), "rejected", "should fail");
            QUnit.start();
        });
});

QUnit.asyncTest("streaming", function() {
    assert.expect(2);

    var at = 0;
    var got = "";
    cockpit.http({ "internal": "/test-server" })
        .get("/mock/stream")
        .stream(function(resp) {
            got += resp;
            at++;
        })
        .always(function() {
            var expected = "";
            for (var i = 0; i < at; i++)
                expected += String(i) + " ";
            assert.equal(got, expected, "stream got right data");
            assert.equal(this.state(), "resolved", "split response didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("close", function() {
    assert.expect(4);

    var req = cockpit.http({ "internal": "/test-server" }).get("/mock/stream");

    var at = 0;
    req.stream(function(resp) {
            at += 1;
            assert.equal(resp, "0 ", "first stream part");
            req.close("bad-boy");
        })
        .fail(function(ex) {
            assert.equal(ex.problem, "bad-boy", "right problem");
        })
        .always(function() {
            assert.equal(at, 1, "stream got cancelled");
            assert.equal(this.state(), "rejected", "cancelling a response rejects it");
            QUnit.start();
        });
});

QUnit.asyncTest("close all", function() {
    assert.expect(4);

    var http = cockpit.http({ "internal": "/test-server" });
    var req = http.get("/mock/stream");

    var at = 0;
    req.stream(function(resp) {
            at += 1;
            assert.equal(resp, "0 ", "first stream part");
            http.close("bad-boy");
        })
        .fail(function(ex) {
            assert.equal(ex.problem, "bad-boy", "right problem");
        })
        .always(function() {
            assert.equal(at, 1, "stream got cancelled");
            assert.equal(this.state(), "rejected", "cancelling a response rejects it");
            http.close("closed");  // This should be a no-op now
            QUnit.start();
        });
});

QUnit.asyncTest("headers", function() {
    assert.expect(3);

    cockpit.http({ "internal": "/test-server" })
        .get("/mock/headers", null, { "Header1": "booo", "Header2": "yay value" })
        .response(function(status, headers) {
            assert.equal(status, 201, "status code");
            assert.deepEqual(headers, {
                    "Header1": "booo",
                    "Header2": "yay value",
                    "Header3": "three",
                    "Header4": "marmalade"
            }, "got back headers");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "split response didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("escape host header", function() {
    assert.expect(3);

    cockpit.http({ "internal": "/test-server" })
        .get("/mock/host", null, { })
        .response(function(status, headers) {
            assert.equal(status, 201, "status code");
            assert.deepEqual(headers.Host, "%2Ftest-server", "got back escaped headers");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "split response didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("connection headers", function() {
    assert.expect(3);

    cockpit.http({ "internal": "/test-server", "headers": { "Header1": "booo", "Header2": "not this" }})
        .get("/mock/headers", null, { "Header2": "yay value", "Header0": "extra" })
        .response(function(status, headers) {
            assert.equal(status, 201, "status code");
            assert.deepEqual(headers, {
                    "Header0": "extra",
                    "Header1": "booo",
                    "Header2": "yay value",
                    "Header3": "three",
                    "Header4": "marmalade"
            }, "got back combined headers");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "split response didn't fail");
            QUnit.start();
        });
});

QUnit.test("http promise recursive", function() {
    assert.expect(7);

    var promise = cockpit.http({ "internal": "/test-server" }).get("/");

    var target = { };
    var promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.input, "function", "promise2.input()");

    var promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.input, "function", "promise3.input()");
});

QUnit.asyncTest("http keep alive", function() {
    assert.expect(3);

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */

    var first;
    cockpit.http({ "internal": "/test-server", "connection": "marmalade" }).get("/mock/connection")
        .always(function() {
            assert.equal(this.state(), "resolved", "response didn't fail");
        })
        .done(function(data) {
            first = data;
            cockpit.http({ "internal": "/test-server", "connection": "marmalade" }).get("/mock/connection")
                .done(function(data) {
                    assert.equal(first, data, "same connection");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "response didn't fail");
                    QUnit.start();
                });
        });
});

QUnit.asyncTest("http connection different", function() {
    assert.expect(3);

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */

    var first;
    cockpit.http({ "internal": "/test-server", "connection": "one" }).get("/mock/connection")
        .always(function() {
            assert.equal(this.state(), "resolved", "response didn't fail");
        })
        .done(function(data) {
            first = data;
            cockpit.http({ "internal": "/test-server", "connection": "two" }).get("/mock/connection")
                .done(function(data) {
                    assert.notEqual(first, data, "different connection");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "response didn't fail");
                    QUnit.start();
                });
        });
});

QUnit.asyncTest("http connection without address ", function() {
    assert.expect(3);

    /*
     * Able to reuse connection client info and not specify address again.
     */

    var first;
    cockpit.http({ "internal": "/test-server", "connection": "one" }).get("/mock/connection")
        .always(function() {
            assert.equal(this.state(), "resolved", "response didn't fail");
        })
        .done(function(data) {
            first = data;
            cockpit.http({ "connection": "one" }).get("/mock/connection")
                .done(function(data) {
                    assert.equal(first, data, "different connection");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "response didn't fail");
                    QUnit.start();
                });
        });
});

QUnit.asyncTest("no dns address", function() {
    assert.expect(2);

    cockpit.http({ "port": 8080,
                   "address": "the-other-host.example.com" })
        .get("/")
        .fail(function(ex, data) {
            /* Unfortunately we can see either of these errors when running unit tests */
            if (ex.problem === "timeout")
                ex.problem = "not-found";
            assert.strictEqual(ex.problem, "not-found", "can't resolve is not found");
        })
        .always(function() {
            assert.equal(this.state(), "rejected", "should fail");
            QUnit.start();
        });
});

QUnit.asyncTest("address with params", function() {
    // use our window's host and port to request external
    assert.expect(2);

    cockpit.http({ port: parseInt(window.location.port, 10),
                   address: window.location.hostname })
        .get("/mock/qs", { "key": "value", "name": "Scruffy the Janitor" })
        .done(function(resp) {
            assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
        })
        .always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.start();
