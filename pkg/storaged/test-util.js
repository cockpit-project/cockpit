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
var QUnit = require("qunit-tests");
var assert = QUnit;

QUnit.test("format_delay", function() {
    var checks = [
        [ 15550000, "4 hours, 19 minutes, 10 seconds" ]
    ];

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.strictEqual(utils.format_delay(checks[i][0]), checks[i][1],
                           "format_delay(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.test("compare_versions", function() {
    var checks = [
        [ "",      "",      0 ],
        [ "0",     "0",     0 ],
        [ "1",     "0",     1 ],
        [ "0",     "1",    -1 ],
        [ "2",     "1.9",   1 ],
        [ "2.0",   "2",     1 ],
        [ "2.1.6", "2.5",  -1 ],
        [ "2..6",  "2.0.6", 0 ],
    ];

    function sign(n) {
        return (n === 0) ? 0 : (n < 0)? -1 : 1;
    }

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.strictEqual(sign(utils.compare_versions(checks[i][0], checks[i][1])), checks[i][2],
                           "compare_versions(" + checks[i][0] + ", " + checks[i][1] + ") = " + checks[i][2]);
    }
});

QUnit.test("mdraid_name_nohostnamed", function() {
    var orig_hostnamed = utils.hostnamed;
    utils.hostnamed = { StaticHostname: undefined };
    assert.strictEqual(utils.mdraid_name({ "Name": "somehost:mydev" }), "mydev", "remote host name is skipped when hostnamed is not available");
    utils.hostnamed = orig_hostnamed;
});

QUnit.test("mdraid_name_remote", function() {
    var orig_hostnamed = utils.hostnamed;
    utils.hostnamed = { StaticHostname: "sweethome" };
    assert.strictEqual(utils.mdraid_name({ "Name": "somehost:mydev" }), "mydev (from somehost)", "expected name for remote host");
    utils.hostnamed = orig_hostnamed;
});

QUnit.test("mdraid_name_local", function() {
    var orig_hostnamed = utils.hostnamed;
    utils.hostnamed = { StaticHostname: "sweethome" };
    assert.strictEqual(utils.mdraid_name({ "Name": "sweethome:mydev" }), "mydev", "expected name for local host");
    utils.hostnamed = orig_hostnamed;
});

/* Wait until the hostnamed dbus proxy is actually ready; otherwise the test
 * finishes and kills the bridge before it can respond to the dbus channel open
 * request for the hostnamed connection, which can cause hangs in
 * ./test-server due to timing out that queued request. */
utils.hostnamed.wait(QUnit.start);
