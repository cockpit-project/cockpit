/* global $, cockpit, QUnit, unescape, escape */

/* To help with future migration */
var assert = QUnit;

QUnit.test("format", function() {
    assert.equal(cockpit.format("My $adj message with ${amount} of things", { adj: "special", amount: "lots" }),
          "My special message with lots of things", "named keys");
    assert.equal(cockpit.format("My $0 message with $1 of things", [ "special", "lots" ]),
          "My special message with lots of things", "number keys");
    assert.equal(cockpit.format("My $0 message with $1 of things", "special", "lots"),
          "My special message with lots of things", "vararg keys");
    assert.equal(cockpit.format("My $0 message with lots of things", "special"),
          "My special message with lots of things", "vararg one key");
    assert.equal(cockpit.format("Undefined $value", { }), "Undefined ", "missing value");

    /* All falsy values except `0` should return the empty string */
    assert.equal(cockpit.format("$0", 0), "0", "`0` as argument");
    assert.equal(cockpit.format("$0", 0.0), "0", "`0.0` as argument");
    assert.equal(cockpit.format("$0", false), "", "`false` as argument");
    assert.equal(cockpit.format("$0", null), "", "`null` as argument");
});

QUnit.test("format_number", function () {
    var checks = [
        [ 23.4, "23.4", "23,4" ],
        [ 23.46, "23.5", "23,5" ],
        [ 23.44, "23.4", "23,4" ],

        [ -23.4, "-23.4", "-23,4" ],
        [ -23.46, "-23.5", "-23,5" ],
        [ -23.44, "-23.4", "-23,4" ],

        [ 0, "0", "0" ],
        [ 0.001, "0.001" , "0,001"],
        [ -0.001, "-0.001", "-0,001" ],

        [ 123.0, "123", "123" ],
        [ 123.01, "123", "123" ],
        [ -123.0, "-123", "-123" ],
        [ -123.01, "-123", "-123" ],
        [ null, "", "" ],
        [ undefined, "", "" ],
    ];

    var saved_language = cockpit.language;
    var i;

    assert.expect(checks.length * 2);

    cockpit.language = 'en';
    for (i = 0; i < checks.length; i++) {
        assert.strictEqual(cockpit.format_number(checks[i][0]), checks[i][1],
                    "format_number@en(" + checks[i][0] + ") = " + checks[i][1]);
    }

    cockpit.language = 'de';
    for (i = 0; i < checks.length; i++) {
        assert.strictEqual(cockpit.format_number(checks[i][0]), checks[i][2],
                    "format_number@de(" + checks[i][0] + ") = " + checks[i][2]);
    }

  /* restore this as not to break the other tests */
  cockpit.language = saved_language;
});

QUnit.test("format_bytes", function() {
    var checks = [
        [ 999, 1000, "999" ],
        [ 1934, undefined, "1.89 KiB" ],
        [ 1934, 1000, "1.93 KB" ],
        [ 2000, 1024, "1.95 KiB" ],
        [ 1999, 1000, "2.00 KB" ],
        [ 1999, 1024, "1.95 KiB" ],
        [ 1000000, 1000, "1 MB" ],
        [ 1000001, 1000, "1.00 MB" ],
        [ 1000000, 1024, "977 KiB" ],
        [ 2000000, 1024, "1.91 MiB" ],
        [ 2000000, 1000, "2 MB" ],
        [ 2000001, 1000, "2.00 MB" ],
        [ 2000000, "MB", "2 MB" ],
        [ 2000000, "MiB", "1.91 MiB" ],
        [ 2000000, "KB", "2000 KB" ],
        [ 2000000, "KiB", "1953 KiB" ],
        [ 1, "KB", "0.001 KB" ],
        [ 0, "KB", "0 KB" ],
        [ undefined, "KB", "" ],
        [ null, "KB", "" ],
    ];

    var i, split;

    assert.expect(checks.length * 2);
    for (i = 0; i < checks.length; i++) {
        assert.strictEqual(cockpit.format_bytes(checks[i][0], checks[i][1]), checks[i][2],
                    "format_bytes(" + checks[i][0] + ", " + String(checks[i][1]) + ") = " + checks[i][2]);
    }
    for (i = 0; i < checks.length; i++) {
        split = checks[i][2].split(" ");
        assert.deepEqual(cockpit.format_bytes(checks[i][0], checks[i][1], true), split,
                   "format_bytes(" + checks[i][0] + ", " + String(checks[i][1]) + ", true) = " + split);
    }
});

QUnit.test("get_byte_units", function() {
    var mib = 1024*1024;
    var gib = mib*1024;
    var tib = gib*1024;

    var mib_unit = { factor: mib, name: "MiB" };
    var gib_unit = { factor: gib, name: "GiB" };
    var tib_unit = { factor: tib, name: "TiB" };

    function selected(unit) {
        return { factor: unit.factor, name: unit.name, selected: true };
    }

    var checks = [
        [     0*mib, 1024,    [ selected(mib_unit), gib_unit, tib_unit ] ],
        [    20*mib, 1024,    [ selected(mib_unit), gib_unit, tib_unit ] ],
        [   200*mib, 1024,    [ selected(mib_unit), gib_unit, tib_unit ] ],
        [  2000*mib, 1024,    [ selected(mib_unit), gib_unit, tib_unit ] ],
        [ 20000*mib, 1024,    [ mib_unit, selected(gib_unit), tib_unit ] ],
        [    20*gib, 1024,    [ mib_unit, selected(gib_unit), tib_unit ] ],
        [   200*gib, 1024,    [ mib_unit, selected(gib_unit), tib_unit ] ],
        [  2000*gib, 1024,    [ mib_unit, selected(gib_unit), tib_unit ] ],
        [ 20000*gib, 1024,    [ mib_unit, gib_unit, selected(tib_unit) ] ]
    ];

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.deepEqual(cockpit.get_byte_units(checks[i][0], checks[i][1]), checks[i][2],
                  "get_byte_units(" + checks[i][0] + ", " + checks[i][1] + ") = " + JSON.stringify(checks[i][2]));
    }
});

QUnit.test("format_bytes_per_sec", function() {
    var checks = [
        [ 2555, "2.50 KiB/s" ]
    ];

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.strictEqual(cockpit.format_bytes_per_sec(checks[i][0]), checks[i][1],
                    "format_bytes_per_sec(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.test("format_bits_per_sec", function() {
    var checks = [
        [ 55, "55 bps" ],
        [ 55.23456789, "55.2 bps" ],
        [ 55.98765432, "56.0 bps" ],
        [ 2555, "2.56 Kbps" ],
        [ 2000, "2 Kbps" ],
        [ 2003, "2.00 Kbps" ]
    ];

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.strictEqual(cockpit.format_bits_per_sec(checks[i][0]), checks[i][1],
                    "format_bits_per_sec(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.start();
