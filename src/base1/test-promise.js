/* global $, cockpit, QUnit, unescape, escape */

/* jshint esnext: true */   /* for Promise object */

QUnit.test("cockpit.all with 0 promises", function (assert) {
    assert.expect(2);

    var done = assert.async(2);

    cockpit.all().then(function () {
        assert.equal(arguments.length, 0, "varargs");
        done();
    });

    cockpit.all([]).then(function () {
        assert.equal(arguments.length, 0, "array");
        done();
    });
});

QUnit.test("cockpit.all with ES6 promises", function (assert) {
    assert.expect(2);

    var done = assert.async(1);

    var es6 = Promise.resolve('es6');
    var cpt = cockpit.defer().resolve('cockpit').promise();

    cockpit.all([es6, cpt]).then(function (r1, r2) {
        assert.equal(r1, 'es6', 'es6');
        assert.equal(r2, 'cockpit', 'cockpit');

        done();
    });
});

QUnit.start();
