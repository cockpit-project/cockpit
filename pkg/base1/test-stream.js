import cockpit from "cockpit";
import QUnit, { mock_info } from "qunit-tests";

const QS_REQUEST = "HEAD /mock/qs HTTP/1.0\nHOST: localhost\n\n";

const test_server = {
    address: window.location.hostname,
    port: parseInt(window.location.port, 10)
};

QUnit.test("TCP stream port without a service", async assert => {
    const done = assert.async();
    assert.expect(2);

    const is_pybridge = await mock_info("pybridge");

    const channel = cockpit.channel({ payload: "stream", address: "127.0.0.99", port: 2222 });

    channel.addEventListener("close", (ev, options) => {
        assert.equal(options.problem, "not-found", "channel should have failed");
        if (is_pybridge)
            assert.equal(options.message,
                         "[Errno 111] Connect call failed ('127.0.0.99', 2222)",
                         "detailed error message");
        else
            assert.equal(options.message, undefined, "C bridge does not give detailed error message");
        done();
    });
});

QUnit.test("TCP stream address without a port", assert => {
    const done = assert.async();
    assert.expect(2);

    const channel = cockpit.channel({ payload: "stream", address: "127.0.0.99" });

    channel.addEventListener("close", (ev, options) => {
        assert.equal(options.problem, "protocol-error", "channel should have failed");
        assert.equal(options.message, 'no "port" or "unix" or other address option for channel', "helpful error");
        done();
    });
});

QUnit.test("TCP text stream", async assert => {
    const done = assert.async();
    assert.expect(2);

    const channel = cockpit.channel({
        payload: "stream",
        address: test_server.address,
        port: test_server.port
    });

    channel.addEventListener("message", (ev, data) => {
        assert.ok(data.startsWith("HTTP/1.1 200 OK"), "got successful HTTP response");
        channel.close();
    });

    channel.addEventListener("close", (ev, options) => {
        assert.equal(options.problem, undefined, "channel should have succeeded");
        done();
    });

    channel.send(QS_REQUEST);
    channel.control({ command: "done" });
});

QUnit.test("TCP binary stream", async assert => {
    const done = assert.async();
    assert.expect(2);

    const channel = cockpit.channel({
        payload: "stream",
        binary: true,
        address: test_server.address,
        port: test_server.port
    });

    channel.addEventListener("message", (ev, data) => {
        const text = new TextDecoder().decode(data);
        assert.ok(text.startsWith("HTTP/1.1 200 OK"), "got successful HTTP response");
        channel.close();
    });

    channel.addEventListener("close", (ev, options) => {
        assert.equal(options.problem, undefined, "channel should have succeeded");
        done();
    });

    channel.send(Uint8Array.from(QS_REQUEST.split('').map(c => c.charCodeAt())));
    channel.control({ command: "done" });
});

QUnit.start();
