import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("should be able to dispatch es2015 promises", function (assert) {
    // https://github.com/cockpit-project/cockpit/issues/10956

    assert.expect(1);

    const done = assert.async();
    const dfd = cockpit.defer();

    dfd.promise.then(() => Promise.resolve(42))
            .then(result => {
                assert.equal(result, 42);
                done();
            });

    dfd.resolve();
});

QUnit.start();
