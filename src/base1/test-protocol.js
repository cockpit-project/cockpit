/* global QUnit */

function connect() {
    let ws = new WebSocket(`ws://${window.location.host}/cockpit/socket`, "cockpit1");

    let connection = {
        oncontrol: () => {},
        onmessage: () => {},
        onclose: () => {},
        send: (channel, data) => ws.send(channel + "\n" + data),
        control: message => connection.send("", JSON.stringify(message)),
        close: () => ws.close()
    };

    ws.onmessage = event => {
        let message = event.data;

        let pos = message.indexOf("\n");
        if (pos < 0)
            throw new Error("invalid message");

        let channel = message.substring(0, pos);
        let data = message.substring(pos + 1);

        if (channel === "")
            connection.oncontrol(JSON.parse(data));
        else
            connection.onmessage(channel, data);
    };

    ws.onclose = () => connection.onclose();

    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve(connection);
        ws.onerror = () => reject();
    });
}

QUnit.test("first message from host is init", async function (assert) {
    assert.expect(5);
    let done = assert.async();

    let connection = await connect();

    connection.oncontrol = message => {
        assert.strictEqual(message.command, "init");
        assert.strictEqual(message.version, 1);
        assert.ok("channel-seed" in message);
        assert.ok("host" in message);
        assert.ok("csrf-token" in message);

        connection.close();
        done();
    };

    connection.onmessage = () => { throw new Error("should not be reached") };
});

QUnit.test("host must ensure that init is the first message", async function (assert) {
    assert.expect(2);
    let done = assert.async(2);

    let connection = await connect();

    // ensure that the server closes the connection on protocol error
    connection.onclose = () => done();

    // send something first that's not "init"
    connection.control({ command: "ping" });

    connection.oncontrol = message => {
        if (message.command === "init")
            return;

        assert.equal(message.command, "close");
        assert.equal(message.problem, "protocol-error");

        done();
    };
});

QUnit.start();
