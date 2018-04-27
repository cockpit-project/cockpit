/* global $, cockpit, QUnit, unescape, escape */

/* jshint esnext: true */   /* for Promise object */

QUnit.test("cockpit.all with 0 promises", function (assert) {
    assert.expect(3);

    var done = assert.async(2);

    cockpit.all().then(function () {
        assert.equal(arguments.length, 0, "varargs");
        done();
    });

    cockpit.all([]).then(function () {
        assert.equal(arguments.length, 1, "1 argument");
        assert.ok(Array.isArray(arguments[0]), "array");
        done();
    });
});

QUnit.test("cockpit.all with 1 promise", function (assert) {
    assert.expect(2);

    var done = assert.async(2);

    var p = Promise.resolve(1);
    cockpit.all(p).then(function (r) {
        assert.equal(r, 1);
        done();
    });

    p = Promise.resolve(1);
    cockpit.all([p]).then(function (r) {
        assert.strictEqual(r[0], 1);
        done();
    });
});

QUnit.test("cockpit.all with ES6 promises", function (assert) {
    assert.expect(2);

    var done = assert.async(1);

    var es6 = Promise.resolve('es6');
    var cpt = cockpit.defer().resolve('cockpit').promise();

    cockpit.all(es6, cpt).then(function (r1, r2) {
        assert.equal(r1, 'es6', 'es6');
        assert.equal(r2, 'cockpit', 'cockpit');

        done();
    });
});

QUnit.test("cockpit.all varargs vs array", function (assert) {
    assert.expect(7);

    var done = assert.async(2);

    var p1 = Promise.resolve(1);
    var p2 = Promise.resolve(2);

    cockpit.all([p1, p2]).then(function (r) {
        assert.ok(Array.isArray(r), 'returns array');
        assert.equal(r.length, 2, 'of length 2');
        assert.equal(r[0], 1, 'result 1');
        assert.equal(r[1], 2, 'result 2');
        done();
    });

    cockpit.all(p1, p2).then(function (r1, r2) {
        assert.equal(arguments.length, 2, 'returns results as arguments');
        assert.equal(r1, 1, 'result 1');
        assert.equal(r2, 2, 'result 2');
        done();
    });
});

QUnit.start();
