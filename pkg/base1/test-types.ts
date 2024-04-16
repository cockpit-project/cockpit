import cockpit from 'cockpit';
import QUnit from 'qunit-tests';

function as_str(value: string | number): string {
    cockpit.assert(typeof value === "string");
    return value; // only (statically) possible because of the assert
}

QUnit.test("cockpit.assert success", function(assert) {
    as_str("abc");
    assert.ok(true);
});

QUnit.test("cockpit.assert fail", function(assert) {
    assert.throws(function() {
        as_str(123);
    });
    assert.ok(true);
});

QUnit.start();
