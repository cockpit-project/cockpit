/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import * as utils from "./utils.js";
import cockpit from "cockpit";
import QUnit from "qunit-tests";

function assert_throws(assert, func, checks) {
    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.throws(function() {
            func(c);
        });
    });
}

QUnit.test("ip_prefix_from_text", function (assert) {
    const checks = [
        ["0", 0],
        ["12", 12],
        [" 12  ", 12]
    ];

    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip_prefix_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip_prefix_from_text invalids", function (assert) {
    const checks = [
        "",
        "-1",
        "foo",
        "1foo",
        "1.5",
        "1 2 3"
    ];

    assert_throws(assert, utils.ip_prefix_from_text, checks);
});

QUnit.test("ip_metric_from_text", function (assert) {
    const checks = [
        ["", 0],
        ["0", 0],
        ["12", 12],
        [" 12  ", 12]
    ];

    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip_metric_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip_metric_from_text invalids", function (assert) {
    const checks = [
        "-1",
        "foo",
        "1foo",
        "1.5",
        "1 2 3"
    ];

    assert_throws(assert, utils.ip_metric_from_text, checks);
});

QUnit.test("ip4_to/from_text be", function (assert) {
    const checks = [
        ["0.0.0.0", 0x00000000],
        ["255.255.255.255", 0xFFFFFFFF],
        ["1.2.3.4", 0x01020304],
        [" 1.2.3.4 ", 0x01020304],
        [" 1 . 2 . 3. 4 ", 0x01020304]
    ];

    assert.expect(2 * checks.length);

    utils.set_byteorder("be");
    checks.forEach(function(c) {
        assert.strictEqual(utils.ip4_to_text(c[1]), c[0].replaceAll(" ", ""));
        assert.strictEqual(utils.ip4_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip4_to/from_text le", function (assert) {
    const checks = [
        ["0.0.0.0", 0x00000000],
        ["255.255.255.255", 0xFFFFFFFF],
        ["1.2.3.4", 0x04030201],
        [" 1.2.3.4 ", 0x04030201],
        [" 1 . 2 . 3. 4 ", 0x04030201]
    ];

    assert.expect(2 * checks.length);

    utils.set_byteorder("le");
    checks.forEach(function(c) {
        assert.strictEqual(utils.ip4_to_text(c[1]), c[0].replaceAll(" ", ""));
        assert.strictEqual(utils.ip4_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip4_from_text invalids", function (assert) {
    const checks = [
        "",
        "0",
        "0.0",
        "0.0.0",
        "0.0.0.0.0",
        "-1.2.3.4",
        "foo",
        "1.foo.3.4",
        "1foo.2.3.4",
        "1.2.3.400",
        "1,2,3,4",
        "1 1.2.3 3.4"
    ];

    assert_throws(assert, utils.ip4_from_text, checks);
});

QUnit.test("ip4_to_text zero", function (assert) {
    utils.set_byteorder("be");
    assert.strictEqual(utils.ip4_to_text(0, true), "");
});

QUnit.test("ip4_from_text empty", function (assert) {
    utils.set_byteorder("be");
    assert.strictEqual(utils.ip4_from_text("", true), 0);
});

QUnit.test("ip4_to/from_text invalid byteorder", function (assert) {
    utils.set_byteorder(undefined);
    assert.throws(function() { utils.ip4_from_text("1.2.3.4") });
    assert.throws(function() { utils.ip4_to_text(0x01020304) });
});

QUnit.test("ip4_prefix_from_text", function (assert) {
    const checks = [
        "0.0.0.0",

        " 128.0.0.0",
        "192.0.0.0 ",
        "224. 0. 0.0",
        "240. 0.0 .0",
        "248.0.0.0",
        "252. 0.0.0",
        "254.0.0.0",
        "255.0.0.0",

        "255.128.0.0",
        "255.192.0.0",
        "255.224.0.0",
        "255.240.0.0",
        "255.248.0.0",
        "255.252.0.0",
        "255.254.0.0",
        "255.255.0.0",

        "255.255.128.0",
        "255.255.192.0",
        "255.255.224.0",
        "255.255.240.0",
        "255.255.248.0",
        "255.255.252.0",
        "255.255.254.0",
        "255.255.255.0",

        "255.255.255.128",
        "255.255.255.192",
        "255.255.255.224",
        "255.255.255.240",
        "255.255.255.248",
        "255.255.255.252",
        "255.255.255.254",
        "255.255.255.255"
    ];

    assert.expect(checks.length);

    checks.forEach(function(c, i) {
        assert.strictEqual(utils.ip4_prefix_from_text(c), i);
    });
});

QUnit.test("ip4_prefix_from_text invalids", function (assert) {
    const checks = [
        "",
        "-1",
        "foo",
        "1foo",
        "1.5",

        "0.0",
        "0.0.0",
        "0.0.0.0.0",
        "1.2.3.4",
        "255.255.255.8",
        "255.192.0.10"
    ];

    assert_throws(assert, utils.ip4_prefix_from_text, checks);
});

QUnit.test("ip6_to/from_text", function (assert) {
    const checks = [
        [[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        "::"
        ],
        [[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F],
        "1:203:405:607:809:a0b:c0d:e0f"
        ],
        [[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F],
        " 1: 203 :  405: 607: 809:a0b :c0d:e0f"
        ],
    ];

    assert.expect(2 * checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip6_to_text(cockpit.base64_encode(c[0])), c[1].replaceAll(" ", ""));
        assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text(c[1])), c[0]);
    });
});

QUnit.test("ip6_from_text abbrevs", function (assert) {
    const checks = [
        ["::",
            [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        ],
        ["::1",
            [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
        ],
        ["1::",
            [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        ],
        ["1:2:3::2:1",
            [0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
        ],
        ["2001::1",
            [0x20, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
        ],
    ];

    checks.forEach(function(c) {
        assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text(c[0])), c[1]);
    });
});

QUnit.test("ip6_from_text invalids", function (assert) {
    const checks = [
        "",
        "0",
        "0:0",
        "0:0:0",
        "0:0:0:0",
        "0:0:0:0:0",
        "0:0:0:0:0:0",
        "0:0:0:0:0:0:0",
        "0:0:0:0:0:0:0:0:0",
        "foo",
        "1:2:3:four:5:6:7:8",
        "1:2:3:-4:5:6:7:8",
        "1:2:3:4.0:5:6:7:8",
        "1:2:3:4foo:5:6:7:8",
        "1:2:3:10000:5:6:7:8",
        "1::4::8",
        "::8::",
        "1:2:3:4 4:5:6:7:8",
    ];

    assert_throws(assert, utils.ip6_from_text, checks);
});

QUnit.test("ip6_to_text zero", function (assert) {
    const zero = [0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0
    ];
    assert.strictEqual(utils.ip6_to_text(cockpit.base64_encode(zero), true), "");
});

QUnit.test("ip6_from_text empty", function (assert) {
    const zero = [0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0
    ];
    assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text("", true)), zero);
});

// WiFi SSID encoding/decoding tests
QUnit.test("decode_nm_property - ASCII SSID", function (assert) {
    const tests = [
        // Plain ASCII string
        { input: "TestNetwork", expected: "TestNetwork" },
        // SSID with spaces
        { input: "My Network", expected: "My Network" },
        // SSID with special chars
        { input: "Network-5GHz_2.4", expected: "Network-5GHz_2.4" },
    ];

    tests.forEach(function(t) {
        const encoded = cockpit.base64_encode(new TextEncoder().encode(t.input));
        assert.strictEqual(utils.decode_nm_property(encoded), t.expected,
                           `decode_nm_property('${t.input}') should return '${t.expected}'`);
    });
});

QUnit.test("decode_nm_property - UTF-8 SSID", function (assert) {
    const tests = [
        // UTF-8 characters
        { input: "Café WiFi", expected: "Café WiFi" },
        // Emoji
        { input: "🏠 Home", expected: "🏠 Home" },
        // Mixed
        { input: "Test-网络-123", expected: "Test-网络-123" },
    ];

    tests.forEach(function(t) {
        const encoded = cockpit.base64_encode(new TextEncoder().encode(t.input));
        assert.strictEqual(utils.decode_nm_property(encoded), t.expected,
                           `decode_nm_property('${t.input}') should return '${t.expected}'`);
    });
});

QUnit.test("decode_nm_property - empty and null", function (assert) {
    assert.strictEqual(utils.decode_nm_property(""), "");
    assert.strictEqual(utils.decode_nm_property(null), "");
    assert.strictEqual(utils.decode_nm_property(undefined), "");
    assert.strictEqual(utils.decode_nm_property(cockpit.base64_encode([])), "");
});

QUnit.test("encode_nm_property - ASCII SSID", function (assert) {
    const tests = [
        { input: "TestNetwork", bytes: [84, 101, 115, 116, 78, 101, 116, 119, 111, 114, 107] },
        { input: "WiFi", bytes: [87, 105, 70, 105] },
    ];

    tests.forEach(function(t) {
        const expected = cockpit.base64_encode(t.bytes);
        assert.strictEqual(utils.encode_nm_property(t.input), expected,
                           `encode_nm_property('${t.input}') should return correct base64-encoded bytes`);
    });
});

QUnit.test("encode_nm_property - UTF-8 SSID", function (assert) {
    const tests = [
        // Café - é is 2 bytes in UTF-8: 0xC3, 0xA9
        { input: "Café", bytes: [67, 97, 102, 195, 169] },
    ];

    tests.forEach(function(t) {
        const expected = cockpit.base64_encode(t.bytes);
        assert.strictEqual(utils.encode_nm_property(t.input), expected,
                           `encode_nm_property('${t.input}') should return correct base64-encoded UTF-8 bytes`);
    });
});

QUnit.test("encode_nm_property - empty and null", function (assert) {
    const emptyBase64 = cockpit.base64_encode([]);
    assert.strictEqual(utils.encode_nm_property(""), emptyBase64);
    assert.strictEqual(utils.encode_nm_property(null), emptyBase64);
    assert.strictEqual(utils.encode_nm_property(undefined), emptyBase64);
});

QUnit.test("encode/decode_nm_property roundtrip", function (assert) {
    const tests = [
        "Simple Network",
        "Stairway to Heaven",
        "Café WiFi",
        "🏠 Home Network",
        "Test-网络-123",
        "",
    ];

    tests.forEach(function(original) {
        const encoded = utils.encode_nm_property(original); // Returns base64 string
        const decoded = utils.decode_nm_property(encoded); // Accepts base64 string
        assert.strictEqual(decoded, original,
                           `Roundtrip for '${original}' should preserve the string`);
    });
});

QUnit.start();
