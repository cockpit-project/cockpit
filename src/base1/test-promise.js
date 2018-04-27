/* global $, cockpit, QUnit, unescape, escape */

QUnit.test("cockpit.all with 0 promises", function (assert) {
    assert.expect(2);

    var done = assert.async(2);

    cockpit.all().then(function () {
        assert.equal(arguments.length, 0, "varargs");
        done();
    });

    cockpit.all([]).then(function () {
        assert.equal(arguments.length, 0, "array");
        QUnit.start();
    });
});

QUnit.start();
