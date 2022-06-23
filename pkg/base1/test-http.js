import cockpit from "cockpit";
import QUnit from "qunit-tests";

/* Set this to a regexp to ignore that warning once */
/*
function console_ignore_warning(exp) {
    const console_warn = console.warn;
    console.warn = function() {
        if (!exp.exec(arguments[0]))
            console_warn.apply(console, arguments);
        console.warn = console_warn;
    };
}
*/

QUnit.test("public api", function (assert) {
    const client = cockpit.http("/test");
    assert.equal(typeof client, "object", "http is an object");
    assert.equal(typeof client.get, "function", "http.get() is a function");
    assert.equal(typeof client.post, "function", "http.post() is a function");
});

const test_server = {
    address: window.location.hostname,
    port: parseInt(window.location.port, 10)
};

QUnit.test("simple request", function (assert) {
    const done = assert.async();
    assert.expect(2);

    cockpit.http(test_server).get("/pkg/playground/manifest.json")
            .done(function(data) {
                assert.deepEqual(JSON.parse(data), {
                    requires: {
                        cockpit: "122"
                    },

                    tools: {
                        index: {
                            label: "Development"
                        }
                    },

                    playground: {
                        "react-patterns": {
                            label: "React Patterns"
                        },
                        translate: {
                            label: "Translating"
                        },
                        exception: {
                            label: "Exceptions"
                        },
                        pkgs: {
                            label: "Packages"
                        },
                        preloaded: {
                            label: "Preloaded"
                        },
                        "notifications-receiver": {
                            label: "Notifications Receiver"
                        },
                        metrics: {
                            label: "Monitoring"
                        },
                        plot: {
                            label: "Plots"
                        },
                        service: {
                            label: "Generic Service Monitor"
                        },
                        speed: {
                            label: "Speed Tests"
                        },
                        journal: {
                            label: "Logs Box"
                        },
                        test: {
                            label: "Playground"
                        }
                    },
                    preload: ["preloaded"],
                    "content-security-policy": "img-src 'self' data:"
                }, "returned right data");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("with params", function (assert) {
    const done = assert.async();
    assert.expect(2);

    cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" })
            .done(function(resp) {
                assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("not found", function (assert) {
    const done = assert.async();
    assert.expect(7);

    const promise = cockpit.http(test_server)
            .get("/not/found")
            .response(function(status, headers) {
                assert.equal(status, 404, "status code");
                assert.strictEqual(this, promise, "got right this");
            })
            .fail(function(ex, data) {
                assert.strictEqual(ex.problem, null, "mapped to cockpit code");
                assert.strictEqual(ex.status, 404, "has status code");
                assert.equal(ex.message, "Not Found", "has reason");
                assert.true(data !== undefined && data.includes('<h1>Not Found</h1>'), "got body");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "should fail");
                done();
            });
});

QUnit.test("streaming", function (assert) {
    const done = assert.async();
    assert.expect(3);

    let at = 0;
    let got = "";
    const promise = cockpit.http(test_server)
            .get("/mock/stream")
            .stream(function(resp) {
                if (at === 0)
                    assert.strictEqual(this, promise, "got right this");
                got += resp;
                at++;
            })
            .always(function() {
                let expected = "";
                for (let i = 0; i < at; i++)
                    expected += String(i) + " ";
                assert.equal(got, expected, "stream got right data");
                assert.equal(this.state(), "resolved", "split response didn't fail");
                done();
            });
});

QUnit.test("close", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const req = cockpit.http(test_server).get("/mock/stream");

    let at = 0;
    req.stream(function(resp) {
        at += 1;
        assert.equal(resp, "0 ", "first stream part");
        this.close("bad-boy");
    })
            .fail(function(ex) {
                assert.equal(ex.problem, "bad-boy", "right problem");
            })
            .always(function() {
                assert.equal(at, 1, "stream got cancelled");
                assert.equal(this.state(), "rejected", "cancelling a response rejects it");
                done();
            });
});

QUnit.test("close all", function (assert) {
    const done = assert.async();
    assert.expect(4);

    const http = cockpit.http(test_server);
    const req = http.get("/mock/stream");

    let at = 0;
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
                http.close("closed"); // This should be a no-op now
                done();
            });
});

QUnit.test("headers", function (assert) {
    const done = assert.async();
    assert.expect(3);

    cockpit.http(test_server)
            .get("/mock/headers", null, { Header1: "booo", Header2: "yay value" })
            .response(function(status, headers) {
                assert.equal(status, 201, "status code");
                assert.deepEqual(headers, {
                    Header1: "booo",
                    Header2: "yay value",
                    Header3: "three",
                    Header4: "marmalade",
                    "Referrer-Policy": "no-referrer",
                    "X-DNS-Prefetch-Control": "off",
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "sameorigin",
                    "Cross-Origin-Resource-Policy": "same-origin",
                }, "got back headers");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "split response didn't fail");
                done();
            });
});

QUnit.test("escape host header", function (assert) {
    const done = assert.async();
    assert.expect(3);

    cockpit.http(test_server)
            .get("/mock/host", null, { })
            .response(function(status, headers) {
                assert.equal(status, 201, "status code");
                assert.deepEqual(headers.Host, window.location.host, "got back escaped headers");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "split response didn't fail");
                done();
            });
});

QUnit.test("connection headers", function (assert) {
    const done = assert.async();
    assert.expect(3);

    cockpit.http({ port: test_server.port, headers: { Header1: "booo", Header2: "not this" } })
            .get("/mock/headers", null, { Header2: "yay value", Header0: "extra" })
            .response(function(status, headers) {
                assert.equal(status, 201, "status code");
                assert.deepEqual(headers, {
                    Header0: "extra",
                    Header1: "booo",
                    Header2: "yay value",
                    Header3: "three",
                    Header4: "marmalade",
                    "Referrer-Policy": "no-referrer",
                    "X-DNS-Prefetch-Control": "off",
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "sameorigin",
                    "Cross-Origin-Resource-Policy": "same-origin",
                }, "got back combined headers");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "split response didn't fail");
                done();
            });
});

QUnit.test("http promise recursive", function (assert) {
    assert.expect(7);

    const promise = cockpit.http(test_server).get("/");

    const target = { };
    const promise2 = promise.promise(target);
    assert.strictEqual(promise2, target, "used target");
    assert.equal(typeof promise2.done, "function", "promise2.done()");
    assert.equal(typeof promise2.promise, "function", "promise2.promise()");
    assert.equal(typeof promise2.input, "function", "promise2.input()");

    const promise3 = promise2.promise();
    assert.equal(typeof promise3.done, "function", "promise3.done()");
    assert.equal(typeof promise3.promise, "function", "promise3.promise()");
    assert.equal(typeof promise3.input, "function", "promise3.input()");
});

QUnit.test("http keep alive", async function (assert) {
    assert.expect(1);

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */
    const first = await cockpit.http({ port: test_server.port, connection: "marmalade" }).get("/mock/connection");
    const second = await cockpit.http({ port: test_server.port, connection: "marmalade" }).get("/mock/connection");
    assert.equal(first, second, "same connection");
});

QUnit.test("http connection different", async function (assert) {
    assert.expect(1);

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */
    const first = await cockpit.http({ port: test_server.port, connection: "one" }).get("/mock/connection");
    const second = await cockpit.http({ port: test_server.port, connection: "two" }).get("/mock/connection");
    assert.notEqual(first, second, "different connection");
});

QUnit.test("http connection without address", async function (assert) {
    assert.expect(1);

    /*
     * Able to reuse connection client info and not specify address again.
     */
    const first = await cockpit.http({ port: test_server.port, connection: "one" }).get("/mock/connection");
    const second = await cockpit.http({ connection: "one" }).get("/mock/connection");
    assert.equal(first, second, "same connection");
});

QUnit.test("no dns address", function (assert) {
    assert.expect(1);

    assert.rejects(cockpit.http({ port: 8080, address: "the-other-host.example.com" }).get("/"),
                   /* Unfortunately we can see either of these errors when running unit tests */
                   ex => { return ex.problem === "timeout" || ex.problem === "not-found" });
});

QUnit.test("address with params", function (assert) {
    const done = assert.async();
    // use our window's host and port to request external
    assert.expect(2);

    cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" })
            .done(function(resp) {
                assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.start();
