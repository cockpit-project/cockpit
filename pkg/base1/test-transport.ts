import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("bridge capabilites", async assert => {
    await new Promise(resolve => cockpit.transport.wait(resolve));
    assert.propContains(cockpit.capabilities?.channels, { fsread1: [], fsinfo: [] });
});

QUnit.start();
