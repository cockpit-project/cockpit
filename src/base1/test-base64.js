/* global $, cockpit, QUnit, Uint8Array */

/* To help with future migration */
var assert = QUnit;

QUnit.test("base64 array", function() {
    var data = new Array(5);
    for (var i = 0; i < 5; i++)
        data[i] = i;
    assert.equal(cockpit.base64_encode(data), "AAECAwQ=", "encoded from Array");

    data = cockpit.base64_decode("AAECAwQFBg==");
    assert.equal(data.length, 7, "right length");

    var match = 1;
    for (i = 0; i < data.length; i++) {
        if (data[i] != i) {
            match = false;
            break;
        }
    }

    assert.ok(match, "right data");
});

QUnit.test("base64 arraybuffer", function() {
    if (!window.Uint8Array)
        return;

    var view = new Uint8Array(5);
    for (var i = 0; i < 5; i++)
        view[i] = i;
    assert.equal(cockpit.base64_encode(view), "AAECAwQ=", "encoded from Uint8Array");

    var data = cockpit.base64_decode("AAECAwQFBg==", window.Uint8Array);
    assert.equal(data.length, 7, "right length");

    var match = 1;
    for (i = 0; i < data.length; i++) {
        if (data[i] != i) {
            match = false;
            break;
        }
    }

    assert.ok(match, "right data");
});

QUnit.test("base64 string", function() {
    assert.equal(cockpit.base64_encode("blah"), "YmxhaA==", "encoded right");
    assert.strictEqual(cockpit.base64_decode("YmxhaA==", String), "blah", "decoded right");
});

QUnit.test("base64 round trip", function() {
    function random_int(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }

    var length = random_int(1000000, 5000000);
    var data = new Array(length);
    for (var i = 0; i < length; i++)
        data[i] = random_int(0, 255);

    var encoded = cockpit.base64_encode(data);
    var decoded = cockpit.base64_decode(encoded);

    assert.equal(decoded.length, length, "right length: " + length);

    var match = true;
    for (i = 0; i < length; i++) {
        if (data[i] != decoded[i]) {
            match = false;
            break;
        }
    }

    assert.ok(match, "data correct");
});

QUnit.start();
