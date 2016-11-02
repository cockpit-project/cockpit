/* global $, cockpit, QUnit, unescape, escape */

/* To help with future migration */
var assert = QUnit;

QUnit.test("utf8 basic", function() {
    var str = "Base 64 \u2014 Mozilla Developer Network";
    var expect = [ 66, 97, 115, 101, 32, 54, 52, 32, 226, 128, 148, 32, 77,
                   111, 122, 105, 108, 108, 97, 32, 68, 101, 118, 101, 108,
                   111, 112, 101, 114, 32, 78, 101, 116, 119, 111, 114, 107 ];

    var encoded = cockpit.utf8_encoder().encode(str);
    assert.deepEqual(encoded, expect, "encoded");

    assert.equal(cockpit.utf8_decoder().decode(encoded), str, "decoded");
});

// Copyright 2014 Joshua Bell. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Inspired by:
// http://ecmanaut.blogspot.com/2006/07/encoding-decoding-utf8-in-javascript.html

// Helpers for test_utf_roundtrip.

QUnit.test("utf8 round trip", function() {
    var MIN_CODEPOINT = 0;
    var MAX_CODEPOINT = 0x10FFFF;
    var BLOCK_SIZE = 0x1000;
    var SKIP_SIZE = 31;
    var encoder = cockpit.utf8_encoder();
    var decoder = cockpit.utf8_decoder();

    function cpname(n) {
        if (n + 0 !== n)
            return n.toString();
        var w = (n <= 0xFFFF) ? 4 : 6;
        return 'U+' + ('000000' + n.toString(16).toUpperCase()).slice(-w);
    }

    function genblock(from, len, skip) {
        var block = [];
        for (var i = 0; i < len; i += skip) {
            var cp = from + i;
            if (0xD800 <= cp && cp <= 0xDFFF)
                continue;
            if (cp < 0x10000) {
                block.push(String.fromCharCode(cp));
                continue;
            }
            cp = cp - 0x10000;
            block.push(String.fromCharCode(0xD800 + (cp >> 10)));
            block.push(String.fromCharCode(0xDC00 + (cp & 0x3FF)));
        }
        return block.join('');
    }
    function old_encode(string) {
        var utf8 = unescape(encodeURIComponent(string));
        var octets = new Array(utf8.length), i;
        for (i = 0; i < utf8.length; i += 1) {
            octets[i] = utf8.charCodeAt(i);
        }
        return octets;
    }

    function old_decode(octets) {
        var utf8 = String.fromCharCode.apply(null, octets);
        return decodeURIComponent(escape(utf8));
    }

    for (var i = MIN_CODEPOINT; i < MAX_CODEPOINT; i += BLOCK_SIZE) {
        var block_tag = cpname(i) + " - " + cpname(i + BLOCK_SIZE - 1);
        var block = genblock(i, BLOCK_SIZE, SKIP_SIZE);
        var encoded = encoder.encode(block);
        var decoded = decoder.decode(encoded);

        var length = block.length;
        for (var j = 0; j < length; j++) {
            if (block[j] != decoded[j]) {
                assert.deepEqual(block, decoded, "round trip " + block_tag);
                return;
            }
        }
    }

    assert.ok(true, "round trip all code points");
});

QUnit.test("utf8 samples", function() {
    // z, cent, CJK water, G-Clef, Private-use character
    var sample = "z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD";
    var expected = [0x7A, 0xC2, 0xA2, 0xE6, 0xB0, 0xB4, 0xF0, 0x9D, 0x84, 0x9E, 0xF4, 0x8F, 0xBF, 0xBD];

    var encoded = cockpit.utf8_encoder().encode(sample);
    assert.deepEqual(encoded, expected, "encoded");

    var decoded = cockpit.utf8_decoder().decode(expected);
    assert.deepEqual(decoded, sample, "decoded");
});

QUnit.test("utf8 stream", function() {
    // z, cent, CJK water, G-Clef, Private-use character
    var sample = "z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD";
    var expected = [0x7A, 0xC2, 0xA2, 0xE6, 0xB0, 0xB4, 0xF0, 0x9D, 0x84, 0x9E, 0xF4, 0x8F, 0xBF, 0xBD];

    var decoder = cockpit.utf8_decoder();
    var decoded = "";

    for (var i = 0; i < expected.length; i += 2)
        decoded += decoder.decode(expected.slice(i, i + 2), { stream: true });
    decoded += decoder.decode();

    assert.deepEqual(decoded, sample, "decoded");
});

QUnit.test("utf8 invalid", function() {
    var sample = "Base 64 \ufffd\ufffd Mozilla Developer Network";
    var data = [ 66, 97, 115, 101, 32, 54, 52, 32, 226, /* 128 */ 148, 32, 77,
                   111, 122, 105, 108, 108, 97, 32, 68, 101, 118, 101, 108,
                   111, 112, 101, 114, 32, 78, 101, 116, 119, 111, 114, 107 ];

    var decoded = cockpit.utf8_decoder().decode(data);

    assert.deepEqual(decoded, sample, "decoded");
});

QUnit.test("utf8 fatal", function() {
    var data = [ 66, 97, 115, 101, 32, 54, 52, 32, 226, /* 128 */ 148, 32, 77,
                   111, 122, 105, 108, 108, 97, 32, 68, 101, 118, 101, 108,
                   111, 112, 101, 114, 32, 78, 101, 116, 119, 111, 114, 107 ];

    assert.throws(function() { cockpit.utf8_decoder(true).decode(data); }, "fatal throws error");
});

QUnit.start();
