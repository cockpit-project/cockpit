import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("base64 array", function (assert) {
    let data = new Array(5);
    for (let i = 0; i < 5; i++)
        data[i] = i;
    assert.equal(cockpit.base64_encode(data), "AAECAwQ=", "encoded from Array");

    data = cockpit.base64_decode("AAECAwQFBg==");
    assert.equal(data.length, 7, "right length");

    let match = 1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] != i) {
            match = false;
            break;
        }
    }

    assert.ok(match, "right data");
});

QUnit.test("base64 arraybuffer", function (assert) {
    const view = new Uint8Array(5);
    for (let i = 0; i < 5; i++)
        view[i] = i;
    assert.equal(cockpit.base64_encode(view), "AAECAwQ=", "encoded from Uint8Array");

    const data = cockpit.base64_decode("AAECAwQFBg==", Uint8Array);
    assert.equal(data.length, 7, "right length");

    let match = 1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] != i) {
            match = false;
            break;
        }
    }

    assert.ok(match, "right data");
});

QUnit.test("base64 string", function (assert) {
    assert.equal(cockpit.base64_encode("blah"), "YmxhaA==", "encoded right");
    assert.strictEqual(cockpit.base64_decode("YmxhaA==", String), "blah", "decoded right");
});

QUnit.test("base64 round trip", function (assert) {
    function random_int(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }

    const length = random_int(1000000, 5000000);
    const data = new Array(length);
    for (let i = 0; i < length; i++)
        data[i] = random_int(0, 255);

    const encoded = cockpit.base64_encode(data);
    const decoded = cockpit.base64_decode(encoded);

    assert.equal(decoded.length, length, "right length: " + length);

    let match = true;
    for (let i = 0; i < length; i++) {
        if (data[i] != decoded[i]) {
            match = false;
            break;
        }
    }

    assert.ok(match, "data correct");
});

QUnit.start();
