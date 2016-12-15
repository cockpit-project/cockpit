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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

var utils = require("./utils");
var cockpit = require("cockpit");
var QUnit = require("qunit-tests");
var assert = QUnit;

function assert_throws(func, checks) {
    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.throws(function() {
            func(c);
        });
    });
}

QUnit.test("ip_prefix_from_text", function() {
    var checks = [
        [ "0",      0 ],
        [ "12",    12 ],
        [ " 12  ", 12 ]
    ];

    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip_prefix_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip_prefix_from_text invalids", function() {
    var checks = [
        "",
        "-1",
        "foo",
        "1foo",
        "1.5",
        "1 2 3"
    ];

    assert_throws(utils.ip_prefix_from_text, checks);
});

QUnit.test("ip_metric_from_text", function() {
    var checks = [
        [ "",       0 ],
        [ "0",      0 ],
        [ "12",    12 ],
        [ " 12  ", 12 ]
    ];

    assert.expect(checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip_metric_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip_metric_from_text invalids", function() {
    var checks = [
        "-1",
        "foo",
        "1foo",
        "1.5",
        "1 2 3"
    ];

    assert_throws(utils.ip_metric_from_text, checks);
});

QUnit.test("ip4_to/from_text be", function() {
    var checks = [
        [ "0.0.0.0",           0x00000000 ],
        [ "255.255.255.255",   0xFFFFFFFF ],
        [ "1.2.3.4",           0x01020304 ],
        [ " 1.2.3.4 ",         0x01020304 ],
        [ " 1 . 2 . 3. 4 ",    0x01020304 ]
    ];

    assert.expect(2*checks.length);

    utils.set_byteorder("be");
    checks.forEach(function(c) {
        assert.strictEqual(utils.ip4_to_text(c[1]), c[0].replace(/ /g, ""));
        assert.strictEqual(utils.ip4_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip4_to/from_text le", function() {
    var checks = [
        [ "0.0.0.0",           0x00000000 ],
        [ "255.255.255.255",   0xFFFFFFFF ],
        [ "1.2.3.4",           0x04030201 ],
        [ " 1.2.3.4 ",         0x04030201 ],
        [ " 1 . 2 . 3. 4 ",    0x04030201 ]
    ];

    assert.expect(2*checks.length);

    utils.set_byteorder("le");
    checks.forEach(function(c) {
        assert.strictEqual(utils.ip4_to_text(c[1]), c[0].replace(/ /g, ""));
        assert.strictEqual(utils.ip4_from_text(c[0]), c[1]);
    });
});

QUnit.test("ip4_from_text invalids", function() {
    var checks = [
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

    assert_throws(utils.ip4_from_text, checks);
});

QUnit.test("ip4_to_text zero", function() {
    utils.set_byteorder("be");
    assert.strictEqual(utils.ip4_to_text(0, true), "");
});

QUnit.test("ip4_from_text empty", function() {
    utils.set_byteorder("be");
    assert.strictEqual(utils.ip4_from_text("", true), 0);
});

QUnit.test("ip4_prefix_from_text", function() {
    var checks = [
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

QUnit.test("ip4_prefix_from_text invalids", function() {
    var checks = [
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

    assert_throws(utils.ip4_prefix_from_text, checks);
});

QUnit.test("ip6_to/from_text", function() {
    var checks = [
        [ [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ],
          "0:0:0:0:0:0:0:0"
        ],
        [ [ 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F ],
          "1:203:405:607:809:a0b:c0d:e0f"
        ],
        [ [ 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F ],
          " 1: 203 :  405: 607: 809:a0b :c0d:e0f"
        ],
    ];

    assert.expect(2*checks.length);

    checks.forEach(function(c) {
        assert.strictEqual(utils.ip6_to_text(cockpit.base64_encode(c[0])), c[1].replace(/ /g, ""));
        assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text(c[1])), c[0]);
    });
});

QUnit.test("ip6_from_text abbrevs", function() {
    var checks = [
        [ "::",
          [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ],
        ],
        [ "::1",
          [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 ],
        ],
        [ "1::",
          [ 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ],
        ],
        [ "1:2:3::2:1",
          [ 0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01 ],
        ],
        [ "2001::1",
          [ 0x20, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 ],
        ],
    ];

    checks.forEach(function(c) {
        assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text(c[0])), c[1]);
    });
});

QUnit.test("ip6_from_text invalids", function() {
    var checks = [
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

    assert_throws(utils.ip6_from_text, checks);
});

QUnit.test("ip6_to_text zero", function() {
    var zero = [ 0, 0, 0, 0, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0, 0, 0
               ];
    assert.strictEqual(utils.ip6_to_text(cockpit.base64_encode(zero), true), "");
});

QUnit.test("ip6_from_text empty", function() {
    var zero = [ 0, 0, 0, 0, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0, 0, 0
               ];
    assert.deepEqual(cockpit.base64_decode(utils.ip6_from_text("", true)), zero);
});

QUnit.start();
