// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import QUnit, { mock_info } from "qunit-tests";

const EXPECT_MOCK_STREAM = "0 1 2 3 4 5 6 7 8 9 ";

const test_server = {
    address: window.location.hostname,
    port: parseInt(window.location.port, 10)
};

/* Normalize header keys to lowercase for comparison (py-ws returns lowercase) */
function lc_headers(headers) {
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/* Case-insensitive check that expected headers are present (ignores extras like date, server) */
function assert_headers_contain(assert, actual, expected, message) {
    const actual_lc = lc_headers(actual);
    const expected_lc = lc_headers(expected);
    const filtered = Object.fromEntries(
        Object.entries(actual_lc).filter(([k]) => k in expected_lc)
    );
    assert.deepEqual(filtered, expected_lc, message);
}

QUnit.test("public api", assert => {
    const client = cockpit.http("/test");
    assert.equal(typeof client, "object", "http is an object");
    assert.equal(typeof client.get, "function", "http.get() is a function");
    assert.equal(typeof client.post, "function", "http.post() is a function");
});

QUnit.test("simple request", async assert => {
    const data = await cockpit.http(test_server).get("/pkg/playground/manifest.json");
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
            terminal: {
                label: "Terminal"
            },
            journal: {
                label: "Logs Box"
            },
            test: {
                label: "Playground"
            },
            packagemanager: {
                label: "PackageManager (install dialog)"
            },
            dialog: {
                label: "Dialog Implementation Convenience Kit"
            },
        },
        preload: ["preloaded"],
        "content-security-policy": "img-src 'self' data:"
    }, "returned right data");
});

QUnit.test("with params", async assert => {
    const resp = await cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" });
    assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
});

QUnit.test("not found", async assert => {
    let response_status;
    try {
        await cockpit.http(test_server)
                .get("/not/found")
                .response(status => { response_status = status });
        assert.ok(false, "should not have succeeded");
    } catch (ex) {
        assert.equal(response_status, 404, "status code");
        assert.strictEqual(ex.problem, null, "mapped to cockpit code");
        assert.strictEqual(ex.status, 404, "has status code");
        assert.equal(ex.message, "Not Found", "has reason");
    }
});

QUnit.test("streaming", async assert => {
    let num_chunks = 0;
    let got = "";
    await cockpit.http(test_server)
            .get("/mock/stream")
            .stream(resp => {
                got += resp;
                num_chunks++;
            });
    assert.true(num_chunks > 1, "got at least two chunks");
    assert.true(num_chunks <= 10, "got at most 10 chunks");
    assert.equal(got, EXPECT_MOCK_STREAM, "stream got right data");
});

QUnit.test("split UTF8 frames", async assert => {
    const resp = await cockpit.http(test_server).get("/mock/split-utf8");
    assert.equal(resp, "initialfirst half é second halffinal", "correct response");
});

QUnit.test("truncated UTF8 frame", async assert => {
    let received = "";
    try {
        await cockpit.http(test_server)
                .get("/mock/truncated-utf8")
                .stream(block => { received += block });
        assert.ok(false, "should not have succeeded");
    } catch (ex) {
        // does not include the first byte of é
        assert.equal(received, "initialfirst half ", "received expected data");
        assert.equal(ex.problem, "protocol-error", "error code");
        assert.ok(ex.message.includes("unexpected end of data"), ex.message);
    }
});

QUnit.test("binary data", async assert => {
    const data = await cockpit.http({ ...test_server, binary: true }).get("/mock/binary-data");
    assert.deepEqual(data, new Uint8Array([255, 1, 255, 2]));
});

QUnit.test("invalid UTF-8", async assert => {
    await assert.rejects(
        cockpit.http(test_server).get("/mock/binary-data"),
        ex => ex.problem == "protocol-error" && ex.message.includes("can't decode byte 0xff"),
        "rejects non-UTF-8 data on text channel");
});

QUnit.test("close", async assert => {
    let at = 0;
    const http = cockpit.http(test_server);

    try {
        await http.get("/mock/stream")
                .stream(resp => {
                    at += 1;
                    assert.equal(resp, "0 ", "first stream part");
                    http.close("bad-boy");
                });
        assert.ok(false, "should not have succeeded");
    } catch (ex) {
        assert.equal(ex.problem, "bad-boy", "right problem");
    }
    assert.equal(at, 1, "stream got cancelled");
});

QUnit.test("close all", async assert => {
    const http = cockpit.http(test_server);

    let at = 0;
    try {
        await http.get("/mock/stream")
                .stream(resp => {
                    at += 1;
                    assert.equal(resp, "0 ", "first stream part");
                    http.close("bad-boy");
                });
        assert.ok(false, "should not have succeeded");
    } catch (ex) {
        assert.equal(ex.problem, "bad-boy", "right problem");
    }
    assert.equal(at, 1, "stream got cancelled");
    http.close("closed"); // This should be a no-op now
});

QUnit.test("headers", async assert => {
    let status, headers;
    await cockpit.http(test_server)
            .get("/mock/headers", null, { Header1: "booo", Header2: "yay value" })
            .response((s, h) => { status = s; headers = h });
    assert.equal(status, 201, "status code");
    assert_headers_contain(assert, headers, {
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
});

QUnit.test("escape host header", async assert => {
    let status, headers;
    await cockpit.http(test_server)
            .get("/mock/host", null, { })
            .response((s, h) => { status = s; headers = h });
    assert.equal(status, 201, "status code");
    assert.deepEqual(lc_headers(headers).host, window.location.host, "got back escaped headers");
});

QUnit.test("connection headers", async assert => {
    let status, headers;
    await cockpit.http({ port: test_server.port, headers: { Header1: "booo", Header2: "not this" } })
            .get("/mock/headers", null, { Header2: "yay value", Header0: "extra" })
            .response((s, h) => { status = s; headers = h });
    assert.equal(status, 201, "status code");
    assert_headers_contain(assert, headers, {
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
});

QUnit.test("http promise recursive", assert => {
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

QUnit.test("no dns address", async assert => {
    await assert.rejects(cockpit.http({ port: 8080, address: "the-other-host.example.com" }).get("/"),
                         /* Unfortunately we can see either of these errors when running unit tests */
                         ex => { return ex.problem === "timeout" || ex.problem === "not-found" });
});

QUnit.test("address with params", async assert => {
    const resp = await cockpit.http(test_server)
            .get("/mock/qs", { key: "value", name: "Scruffy the Janitor" });
    assert.equal(resp, "key=value&name=Scruffy+the+Janitor", "right query string");
});

QUnit.test("HEAD method", async assert => {
    await assert.rejects(
        cockpit.http(test_server).get("/mock/headonly"),
        ex => ex.status == 400,
        "rejects GET request on /headonly path");

    const InputData = "some chars";

    let status, headers;
    const data = await cockpit.http(test_server).request({
        path: "/mock/headonly",
        method: "HEAD",
        headers: { InputData },
        body: "",
    })
            .response((s, h) => { status = s; headers = h });
    assert.equal(status, 200);
    assert.equal(lc_headers(headers).inputdatalength, InputData.length);
    assert.equal(data, "");
});

QUnit.test("wrong options", async assert => {
    await assert.rejects(
        cockpit.http({}).get("/"),
        // unfortunately cockpit.js does not propagate the detailed error message
        ex => ex.problem == "protocol-error" && ex.status == undefined,
        "rejects request without port or unix option");

    await assert.rejects(
        cockpit.http({ port: 1234, unix: "/nonexisting/socket" }).get("/"),
        ex => ex.problem == "protocol-error" && ex.status == undefined,
        "rejects request with both port and unix option");

    await assert.rejects(
        cockpit.http({ unix: "/nonexisting/socket", tls: {} }).get("/"),
        ex => ex.problem == "protocol-error" && ex.status == undefined,
        "rejects request with both unix and tls option");
});

QUnit.test("parallel stress test", async assert => {
    // This is way too slow under valgrind
    if (await mock_info("skip_slow_tests")) {
        assert.ok(true, "skipping on python bridge, not implemented");
        return;
    }

    assert.timeout(6000);

    const num = 1000;

    const promises = [];
    for (let i = 0; i < num; ++i)
        promises.push(cockpit.http(test_server).get("/mock/stream"));

    const results = await Promise.all(promises);
    assert.equal(results.length, num, "got correct number of responses");
    for (let i = 0; i < num; ++i)
        assert.equal(results[i], EXPECT_MOCK_STREAM);
});

QUnit.start();
