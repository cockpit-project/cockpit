import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("cockpit object without jQuery", assert => {
    const done = assert.async();
    assert.expect(8);

    assert.equal(typeof jQuery, "undefined", "jQuery is not defined");
    assert.equal(typeof $, "undefined", "$ is not defined");
    assert.equal(typeof cockpit, "object", "cockpit is defined");
    assert.notEqual(cockpit.channel, undefined, "cockpit.channel is defined");
    assert.notEqual(cockpit.spawn, undefined, "cockpit.spawn is defined");

    /* Actually try to do something useful */
    let got_message = false;
    const channel = cockpit.channel({ payload: "stream", spawn: ["sh", "-c", "echo hello"] });
    channel.onmessage = ev => {
        got_message = true;
        assert.equal(ev.detail, "hello\n", "channel message correct");
        channel.onmessage = null;
    };
    channel.onclose = ev => {
        assert.equal(ev.detail.command, "close", "channel close data correct");
        assert.ok(got_message, "channel got message");
        done();
    };
});

QUnit.start();
