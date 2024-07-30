import cockpit from "cockpit";
import QUnit, { mock_info } from "qunit-tests";

const EXPECT_MOCK_STREAM = "0 1 2 3 4 5 6 7 8 9 ";

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

QUnit.test("public api", assert => {
    const client = cockpit.http("/test");
    assert.equal(typeof client, "object", "http is an object");
    assert.equal(typeof client.get, "function", "http.get() is a function");
    assert.equal(typeof client.post, "function", "http.post() is a function");
});

const test_server = {
    address: window.location.hostname,
    port: parseInt(window.location.port, 10)
};

QUnit.test("simple request", assert => {
    const done = assert.async();
    assert.expect(1);

    cockpit.http(test_server).get("/pkg/playground/manifest.json")
            .then(data => {
                assert.deepEqual(JSON.parse(data), {
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
                        remote: {
                            label: "Remote channel"
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
            .finally(done);
});

QUnit.test("with params", assert => {
    const done = assert.async();
    assert.expect(1);

    cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" })
            .then(resp => assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string"))
            .finally(done);
});

QUnit.test("not found", assert => {
    const done = assert.async();
    assert.expect(5);

    cockpit.http(test_server)
            .get("/not/found")
            .response(status => assert.equal(status, 404, "status code"))
            .catch((ex, data) => {
                assert.strictEqual(ex.problem, null, "mapped to cockpit code");
                assert.strictEqual(ex.status, 404, "has status code");
                assert.equal(ex.message, "Not Found", "has reason");
                assert.true(data !== undefined && data.includes('<h1>Not Found</h1>'), "got body");
            })
            .finally(done);
});

QUnit.test("streaming", assert => {
    const done = assert.async();
    assert.expect(3);

    let num_chunks = 0;
    let got = "";
    cockpit.http(test_server)
            .get("/mock/stream")
            .stream(resp => {
                got += resp;
                num_chunks++;
            })
            .finally(() => {
                assert.true(num_chunks > 1, "got at least two chunks");
                assert.true(num_chunks <= 10, "got at most 10 chunks");
                assert.equal(got, EXPECT_MOCK_STREAM, "stream got right data");
                done();
            });
});

QUnit.test("split UTF8 frames", assert => {
    const done = assert.async();
    assert.expect(1);

    cockpit.http(test_server)
            .get("/mock/split-utf8")
            .then(resp => assert.equal(resp, "initialfirst half é second halffinal", "correct response"))
            .finally(done);
});

QUnit.test("truncated UTF8 frame", assert => {
    const done = assert.async();
    assert.expect(3);
    let received = "";

    cockpit.http(test_server)
            .get("/mock/truncated-utf8")
            .stream(block => { received += block })
            .then(() => assert.ok(false, "should not have succeeded"))
            // does not include the first byte of é
            .catch(ex => {
                // does not include the first byte of é
                assert.equal(received, "initialfirst half ", "received expected data");
                assert.equal(ex.problem, "protocol-error", "error code");
                assert.ok(ex.message.includes("unexpected end of data"), ex.message);
            })
            .finally(done);
});

QUnit.test("close", assert => {
    const done = assert.async();
    assert.expect(3);

    let at = 0;
    const http = cockpit.http(test_server);

    http.get("/mock/stream")
            .stream(resp => {
                at += 1;
                assert.equal(resp, "0 ", "first stream part");
                http.close("bad-boy");
            })
            .catch(ex => assert.equal(ex.problem, "bad-boy", "right problem"))
            .finally(() => {
                assert.equal(at, 1, "stream got cancelled");
                done();
            });
});

QUnit.test("close all", assert => {
    const done = assert.async();
    assert.expect(3);

    const http = cockpit.http(test_server);
    const req = http.get("/mock/stream");

    let at = 0;
    req
            .stream(resp => {
                at += 1;
                assert.equal(resp, "0 ", "first stream part");
                http.close("bad-boy");
            })
            .catch(ex => assert.equal(ex.problem, "bad-boy", "right problem"))
            .finally(() => {
                assert.equal(at, 1, "stream got cancelled");
                http.close("closed"); // This should be a no-op now
                done();
            });
});

QUnit.test("headers", assert => {
    const done = assert.async();
    assert.expect(3);

    cockpit.http(test_server)
            .get("/mock/headers", null, { Header1: "booo", Header2: "yay value" })
            .response((status, headers) => {
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
            .then(() => assert.ok(true, "split response succeeded"))
            .finally(done);
});

QUnit.test("escape host header", assert => {
    const done = assert.async();
    assert.expect(3);

    cockpit.http(test_server)
            .get("/mock/host", null, { })
            .response((status, headers) => {
                assert.equal(status, 201, "status code");
                assert.deepEqual(headers.Host, window.location.host, "got back escaped headers");
            })
            .then(() => assert.ok(true, "split response succeeded"))
            .finally(done);
});

QUnit.test("connection headers", assert => {
    const done = assert.async();
    assert.expect(2);

    cockpit.http({ port: test_server.port, headers: { Header1: "booo", Header2: "not this" } })
            .get("/mock/headers", null, { Header2: "yay value", Header0: "extra" })
            .response((status, headers) => {
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
            .finally(done);
});

QUnit.test("http promise recursive", assert => {
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

QUnit.test("http keep alive", async assert => {
    assert.expect(1);

    // connection sharing is not implemented in the pybridge
    if (await mock_info("pybridge")) {
        assert.rejects(
            cockpit.http({ port: test_server.port, connection: "one" }).get("/mock/connection"),
            ex => ex.problem == "protocol-error" && ex.status == undefined,
            "rejects connection option on python bridge");
        return;
    }

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */
    const first = await cockpit.http({ port: test_server.port, connection: "marmalade" }).get("/mock/connection");
    const second = await cockpit.http({ port: test_server.port, connection: "marmalade" }).get("/mock/connection");
    assert.equal(first, second, "same connection");
});

QUnit.test("http connection different", async assert => {
    assert.expect(1);

    // connection sharing is not implemented in the pybridge
    if (await mock_info("pybridge")) {
        assert.ok(true);
        return;
    }

    /*
     * The /mock/connection handler returns an identifier that changes if
     * a different connection is used.
     */
    const first = await cockpit.http({ port: test_server.port, connection: "one" }).get("/mock/connection");
    const second = await cockpit.http({ port: test_server.port, connection: "two" }).get("/mock/connection");
    assert.notEqual(first, second, "different connection");
});

QUnit.test("http connection without address", async assert => {
    assert.expect(1);

    // connection sharing is not implemented in the pybridge
    if (await mock_info("pybridge")) {
        assert.ok(true);
        return;
    }

    // Able to reuse connection client info and not specify address again.
    const first = await cockpit.http({ port: test_server.port, connection: "one" }).get("/mock/connection");
    const second = await cockpit.http({ connection: "one" }).get("/mock/connection");
    assert.equal(first, second, "same connection");
});

QUnit.test("no dns address", assert => {
    assert.expect(1);

    assert.rejects(cockpit.http({ port: 8080, address: "the-other-host.example.com" }).get("/"),
                   /* Unfortunately we can see either of these errors when running unit tests */
                   ex => { return ex.problem === "timeout" || ex.problem === "not-found" });
});

QUnit.test("address with params", assert => {
    const done = assert.async();
    assert.expect(1);

    cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" })
            .then(resp => assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string"))
            .finally(done);
});

QUnit.test("HEAD method", assert => {
    const done = assert.async();
    assert.expect(4);

    assert.rejects(
        cockpit.http(test_server).get("/mock/headonly"),
        ex => ex.status == 400 && ex.reason == "Only HEAD allowed on this path",
        "rejects GET request on /headonly path");

    const InputData = "some chars";

    cockpit.http(test_server).request({
        path: "/mock/headonly",
        method: "HEAD",
        headers: { InputData },
        body: "",
    })
            .response((status, headers) => {
                assert.equal(status, 200);
                assert.equal(headers.InputDataLength, InputData.length);
            })
            .then(data => assert.equal(data, ""))
            .finally(done);
});

QUnit.test("wrong options", async assert => {
    assert.rejects(
        cockpit.http({}).get("/"),
        // unfortunately cockpit.js does not propagate the detailed error message
        ex => ex.problem == "protocol-error" && ex.status == undefined,
        "rejects request without port or unix option");

    assert.rejects(
        cockpit.http({ port: 1234, unix: "/nonexisting/socket" }).get("/"),
        ex => ex.problem == "protocol-error" && ex.status == undefined,
        "rejects request with both port and unix option");

    // This is disallowed in the pybridge, but allowed in the C bridge
    if (await mock_info("pybridge")) {
        assert.rejects(
            cockpit.http({ unix: "/nonexisting/socket", tls: {} }).get("/"),
            ex => ex.problem == "protocol-error" && ex.status == undefined,
            "rejects request with both unix and tls option");
    } else {
        assert.ok(true, "skipping on python bridge, not implemented");
    }
});

QUnit.test("parallel stress test", async assert => {
    // This is way too slow under valgrind
    if (await mock_info("skip_slow_tests")) {
        assert.ok(true, "skipping on python bridge, not implemented");
        return;
    }

    const num = 1000;
    assert.expect(num + 1);

    const promises = [];
    for (let i = 0; i < num; ++i)
        promises.push(cockpit.http(test_server).get("/mock/stream"));

    const results = await Promise.all(promises);
    assert.equal(results.length, num, "got correct number of responses");
    for (let i = 0; i < num; ++i)
        assert.equal(results[i], EXPECT_MOCK_STREAM);
});

QUnit.start();
