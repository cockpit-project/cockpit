// SPDX-License-Identifier: LGPL-2.1-or-later
import QUnit from "qunit-tests";

interface ControlMessage {
    command: string;
    problem?: string;
    [key: string]: unknown;
}

function connect(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://${window.location.host}/cockpit/socket`, "cockpit1");
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });
}

function send_control(ws: WebSocket, message: ControlMessage): void {
    ws.send("\n" + JSON.stringify(message));
}

function read_control(ws: WebSocket): Promise<ControlMessage> {
    return new Promise(resolve => {
        ws.onmessage = event => {
            const message = event.data as string;
            const pos = message.indexOf("\n");
            if (pos < 0)
                throw new Error("invalid message");

            const channel = message.substring(0, pos);
            const data = message.substring(pos + 1);

            if (channel === "") {
                resolve(JSON.parse(data) as ControlMessage);
            }
        };
    });
}

/* Wait for close, returning the last message received */
async function wait_close(ws: WebSocket): Promise<ControlMessage> {
    const close_promise = new Promise(resolve => {
        ws.onclose = resolve;
    });
    const message = await read_control(ws);
    await close_promise;
    return message;
}

QUnit.test("first message from host is init", async assert => {
    const ws = await connect();

    try {
        const message = await read_control(ws);
        assert.strictEqual(message.command, "init");
        assert.strictEqual(message.version, 1);
        assert.ok("channel-seed" in message);
        assert.ok("host" in message);
        assert.ok("csrf-token" in message);
    } finally {
        ws.close();
    }
});

QUnit.test("host must ensure that init is the first message", async assert => {
    const ws = await connect();
    await read_control(ws); // skip the init

    // send something first that's not "init"
    send_control(ws, { command: "ping" });

    // make sure we get shut down
    const message = await wait_close(ws);
    assert.equal(message.command, "close");
    assert.equal(message.problem, "protocol-error");
});

QUnit.test("server accepts extra init messages", async assert => {
    /* Old versions of the shell used to accidentally forward the init message
     * from each iframe to the webserver, and since a new webserver may be used
     * with old versions of the shell, we need to make sure the webserver
     * continues to accept multiple init messages without error.
     */
    const ws = await connect();

    try {
        // skip the init
        const init = await read_control(ws);
        assert.strictEqual(init.command, "init");

        // we need to send init first
        send_control(ws, { command: "init", version: 1 });

        // but after that additional init is ignored
        send_control(ws, { command: "init", version: 1 });

        // send a ping: if we get the pong then we survived the extra inits
        send_control(ws, { command: "ping", still: "alive" });
        const pong = await read_control(ws);
        assert.equal(pong.command, "pong", "got pong");
        assert.equal(pong.still, "alive", "still alive");
    } finally {
        ws.close();
    }
});

QUnit.module("tests that need test-server warnings disabled", hooks => {
    /*
     * Some of these tests will trigger cockpit-ws or cockpit-bridge to print out
     * warnings (on protocol errors, for example). Let the test server know that
     * before starting the tests, so it doesn't treat those messages as fatal.
     */

    // hooks wait for the promise to be resolved before continuing
    hooks.before(async () => { await fetch("/mock/expect-warnings") });
    hooks.after(async () => { await fetch("/mock/dont-expect-warnings") });

    QUnit.test("host must return an error when 'channel' is not given in 'open'", async assert => {
        const ws = await connect();
        await read_control(ws); // skip the init

        send_control(ws, { command: "init", version: 1 });

        // this is broken
        send_control(ws, { command: "open", payload: "fsread", path: "/etc/passwd" });

        // wait for the shutdown
        const message = await wait_close(ws);
        assert.equal(message.command, "close");
        assert.equal(message.problem, "protocol-error");
    });
});

QUnit.start();
