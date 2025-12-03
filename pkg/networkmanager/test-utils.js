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

// Tests for WiFi SSID encoding (encode_nm_property / decode_nm_property)
// These functions are critical for D-Bus communication - 'ay' type requires base64

QUnit.test("encode_nm_property returns base64 string", function (assert) {
    // encode_nm_property must return a string (base64), not an array
    // The D-Bus 'ay' type serialization requires base64, not JSON arrays
    const result = utils.encode_nm_property("HALOS");
    assert.strictEqual(typeof result, "string", "encode_nm_property should return a string");
    // "HALOS" in UTF-8 is [72, 65, 76, 79, 83], base64 is "SEFMT1M="
    assert.strictEqual(result, "SEFMT1M=", "encode_nm_property should return correct base64");
});

QUnit.test("encode_nm_property handles empty string", function (assert) {
    const result = utils.encode_nm_property("");
    assert.strictEqual(typeof result, "string", "empty string should return a string");
    // Empty byte array in base64 is ""
    assert.strictEqual(result, "", "empty string should encode to empty base64");
});

QUnit.test("encode_nm_property handles null/undefined", function (assert) {
    assert.strictEqual(typeof utils.encode_nm_property(null), "string");
    assert.strictEqual(typeof utils.encode_nm_property(undefined), "string");
});

QUnit.test("encode_nm_property handles Unicode", function (assert) {
    // Test with emoji and non-ASCII characters
    const result = utils.encode_nm_property("HaLOS🚢");
    assert.strictEqual(typeof result, "string", "Unicode should return a string");
    // Verify roundtrip works
    assert.strictEqual(utils.decode_nm_property(result), "HaLOS🚢", "Unicode roundtrip should work");
});

QUnit.test("decode_nm_property handles base64 strings", function (assert) {
    // "HALOS" base64 encoded
    const result = utils.decode_nm_property("SEFMT1M=");
    assert.strictEqual(result, "HALOS", "should decode base64 to string");
});

QUnit.test("decode_nm_property handles byte arrays", function (assert) {
    // "HALOS" as byte array
    const bytes = [72, 65, 76, 79, 83];
    const result = utils.decode_nm_property(bytes);
    assert.strictEqual(result, "HALOS", "should decode byte array to string");
});

QUnit.test("decode_nm_property handles empty input", function (assert) {
    assert.strictEqual(utils.decode_nm_property(""), "", "empty string should return empty");
    assert.strictEqual(utils.decode_nm_property([]), "", "empty array should return empty");
    assert.strictEqual(utils.decode_nm_property(null), "", "null should return empty");
});

QUnit.test("encode/decode roundtrip", function (assert) {
    const testCases = [
        "MyNetwork",
        "HALOS-12345",
        "Test WiFi Network",
        "Café Network",
        "日本語ネットワーク",
        "🏠 Home WiFi"
    ];

    assert.expect(testCases.length);
    testCases.forEach(function(ssid) {
        const encoded = utils.encode_nm_property(ssid);
        const decoded = utils.decode_nm_property(encoded);
        assert.strictEqual(decoded, ssid, "roundtrip should preserve: " + ssid);
    });
});

QUnit.start();
