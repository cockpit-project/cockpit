// SPDX-License-Identifier: LGPL-2.1-or-later
import { Channel, ChannelPayload } from "../lib/cockpit/channel";
import QUnit from "qunit-tests";

const QS_REQUEST = "HEAD /mock/qs HTTP/1.0\r\nHOST: localhost\r\n\r\n";

const test_server = {
    address: window.location.hostname,
    port: parseInt(window.location.port, 10)
};

function read_data<P extends ChannelPayload>(channel: Channel<P>): Promise<P> {
    return new Promise(resolve => {
        const disconnect = channel.on('data', data => {
            disconnect();
            resolve(data);
        });
    });
}

QUnit.test("TCP stream port without a service", async assert => {
    const channel = new Channel({ payload: "stream", address: "127.0.0.99", port: 2222 });

    await assert.rejects(
        channel.wait(),
        { problem: "not-found", message: "[Errno 111] Connect call failed ('127.0.0.99', 2222)" },
        "channel should have failed with not-found"
    );
});

QUnit.test("TCP stream address without a port", async assert => {
    const channel = new Channel({ payload: "stream", address: "127.0.0.99" });

    await assert.rejects(
        channel.wait(),
        { problem: "protocol-error", message: 'no "port" or "unix" or other address option for channel' },
        "channel should have failed with protocol-error"
    );
});

QUnit.test("TCP text stream", async assert => {
    const channel = new Channel({
        payload: "stream",
        address: test_server.address,
        port: test_server.port
    });

    channel.send_data(QS_REQUEST);

    const data = await read_data(channel);
    assert.ok(data.startsWith("HTTP/1.1 200 OK"), "got successful HTTP response");

    channel.close();
    await channel.wait();
});

QUnit.test("TCP binary stream", async assert => {
    const channel = new Channel<Uint8Array>({
        payload: "stream",
        binary: true,
        address: test_server.address,
        port: test_server.port
    });

    channel.send_data(new TextEncoder().encode(QS_REQUEST));

    const data = await read_data(channel);
    const text = new TextDecoder().decode(data);
    assert.ok(text.startsWith("HTTP/1.1 200 OK"), "got successful HTTP response");

    channel.close();
    await channel.wait();
});

QUnit.start();
