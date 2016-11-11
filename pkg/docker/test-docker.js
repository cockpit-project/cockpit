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

(function() {
    "use strict";

    var docker = require("./docker");
    var util = require("./util");
    var QUnit = require("qunit-tests");
    var assert = QUnit;

    QUnit.test("bytes_from_format", function() {
        var checks = [
            [ "999", 999 ],
            [ "1.9 kb", 1945.6],
            [ "2.0 KB", 2048 ],
            [ "1.0 MB", 1048576 ],
            [ "1 GB", 1073741824 ],
            [ "1 Unknown", 1 ],
        ];

        var i;

        assert.expect(checks.length);
        for (i = 0; i < checks.length; i++) {
            assert.strictEqual(docker.bytes_from_format(checks[i][0]), checks[i][1],
                               "bytes_from_format(" + checks[i][0] + ") = " + checks[i][1]);
        }
    });

    QUnit.test("json_skip", function() {
        var checks = [
            [ "number", "0123456789",
                [ 10, 0 ] ],
            [ "number-fancy", "-0123456789.33E-5",
                [ 17, 0 ] ],
            [ "string", "\"string\"",
                [ 8, 0 ] ],
            [ "string-escaped", "\"st\\\"ring\"",
                [ 10, 0 ] ],
            [ "string-truncated", "\"string",
                [ 0 ] ],
            [ "boolean", "true",
                [ 4, 0 ] ],
            [ "null", "null",
                [ 4, 0 ] ],
            [ "string-number", "\"string\"0123456789",
                [ 8, 18, 0 ] ],
            [ "number-string", "0123456789\"string\"",
                [ 10, 18, 0 ] ],
            [ "number-number", "0123456789 123",
                [ 10, 14, 0 ] ],
            [ "string-string-string", "\"string\"\"two\"\"three\"",
                [ 8, 13, 20, 0 ] ],
            [ "string-string-truncated", "\"string\"\"tw",
                [ 8, 0 ] ],
            [ "array", "[\"string\",\"two\",\"three\"]",
                [ 24, 0 ] ],
            [ "array-escaped", "[\"string\",\"two\",\"thr]e\"]",
                [ 24, 0 ] ],
            [ "array-spaces", " [ \"string\", \"two\" ,\"thr]e\" ]\t",
                [ 29, 0 ] ],
            [ "array-truncated", "[\"string\",\"two\",\"thr",
                [ 0 ] ],
            [ "object", "{\"string\":\"two\",\"number\":222}",
                [ 29, 0 ] ],
            [ "object-escaped", "{\"string\":\"two\",\"num]}}ber\":222}",
                [ 32, 0 ] ],
            [ "object-spaces", "{ \"string\": \"two\", \"number\": 222 }",
                [ 34, 0 ] ],
            [ "object-object", "{\"string\":\"two\",\"number\":222}{\"string\":\"two\",\"number\":222}",
                [ 29, 58, 0 ] ],
            [ "object-line-object", "{\"string\":\"two\",\"number\":222}\n{\"string\":\"two\",\"number\":222}",
                [ 29, 59, 0 ] ],
            [ "object-truncated", "{\"stri}ng\"",
                [ 0 ] ],
            [ "whitespace", "  \r\n\t \v",
                [ 0 ] ],
        ];

        assert.expect(checks.length);
        for (var i = 0; i < checks.length; i++) {
            var res = [];
            var pos = undefined;
            var next;
            for (var j = 0; j < 16; j++) {
                next = docker.json_skip(checks[i][1], pos);
                res.push(next);
                if (next === 0)
                    break;
                pos = next;
            }
            assert.deepEqual(res, checks[i][2], "json_skip(): " + checks[i][0]);
        }
    });

    QUnit.test("quote_cmdline", function() {
        var checks = [
            [ [ "foo" ],          "foo" ],
            [ [ "foo", "bar" ],   "foo bar" ],
            [ [ "f o o" ],        "\"f o o\"" ],
            [ [ "f\\o" ],         "f\\\\o" ],
            [ [ "f\"o" ],         "'f\"o'" ],
            [ [ "f\"\'o" ],       "'f\"\\'o'" ],
            [ [ "f \"o" ],        "\"f \\\"o\"" ]
        ];

        assert.expect(checks.length);
        for (var i = 0; i < checks.length; i++)
            assert.strictEqual(docker.quote_cmdline(checks[i][0]), checks[i][1],
                               "quote(" + String(checks[i][0]) + ") = " + checks[i][1]);

    });

    QUnit.test("unquote_cmdline", function() {
        var checks = [
            [ [ "foo" ],            "  foo  " ],
            [ [ "foo", "bar" ],     "foo    bar  " ],
            [ [ "f o o" ],          "\"f o o\"" ],
            [ [ "f o o" ],          "'f o o'" ],
            [ [ "f\\o" ],           "f\\\\o" ],
            [ [ "f\"o" ],           "'f\"o'" ],
            [ [ "f\"\'o" ],         "'f\"\\'o'" ],
            [ [ "f \"o" ],          "\"f \\\"o\"" ],
            [ [ "f o o" ],          "f' 'o\" \"o" ],
            [ [ "f'" , "o\" \"o" ], "f\\' 'o\" \"o" ]
        ];

        assert.expect(checks.length);
        for (var i = 0; i < checks.length; i++)
            assert.deepEqual(docker.unquote_cmdline(checks[i][1]), checks[i][0],
                             "unquote(" + String(checks[i][1]) + ") = " + checks[i][0]);

    });

    QUnit.test("render_container_status", function() {
        var checks = [
            [ { Status: "blah", Running: true }, "blah" ],
            [ { Running: true, Paused: false }, "running" ],
            [ { Running: false, Paused: true }, "paused" ],
            [ { Restarting: true }, "restarting" ],
            [ { FinishedAt: "0001-01-01" }, "created" ],
            [ { FinishedAt: "2016-11-11" }, "exited" ],
            [ {  }, "exited" ],
        ];

        assert.expect(checks.length);
        checks.forEach(function(check) {
            assert.equal(util.render_container_status(check[0]), check[1],
                    "render_container_status = " + check[1]);
        });
    });

    QUnit.start();
}());
