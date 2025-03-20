import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("cockpit info", async assert => {
    await cockpit.init();

    assert.propContains(cockpit.info.channels, { fsread1: [], fsinfo: [] });

    // We can't really assert the value of any particular thing here, since the
    // tests get run in a wide range of environments, but we can at least make
    // sure everything has the expected type.
    assert.equal(typeof cockpit.info.os_release.NAME, 'string');

    assert.equal(typeof cockpit.info.user.uid, 'number');
    assert.equal(typeof cockpit.info.user.gid, 'number');
    assert.equal(typeof cockpit.info.user.name, 'string');
    assert.equal(typeof cockpit.info.user.group, 'string');
    assert.equal(cockpit.info.user.group, cockpit.info.user.groups[0]);

    assert.equal(typeof cockpit.info.ws.version, 'string');
});

QUnit.start();
