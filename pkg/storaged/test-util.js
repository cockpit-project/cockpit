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

import * as utils from "./utils.js";
import QUnit, { f } from "qunit-tests";

QUnit.test("format_delay", function (assert) {
    const checks = [
        [3000, "less than a minute"],
        [60000, "1 minute"],
        [15550000, "about 4 hours"],
    ];

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.strictEqual(utils.format_delay(checks[i][0]), checks[i][1],
                           "format_delay(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.test("compare_versions", function (assert) {
    const checks = [
        ["", "", 0],
        ["0", "0", 0],
        ["1", "0", 1],
        ["0", "1", -1],
        ["2", "1.9", 1],
        ["2.0", "2", 1],
        ["2.1.6", "2.5", -1],
        ["2..6", "2.0.6", 0],
    ];

    function sign(n) {
        return (n === 0) ? 0 : (n < 0) ? -1 : 1;
    }

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.strictEqual(sign(utils.compare_versions(checks[i][0], checks[i][1])), checks[i][2],
                           "compare_versions(" + checks[i][0] + ", " + checks[i][1] + ") = " + checks[i][2]);
    }
});

QUnit.test("mdraid_name_nohostnamed", function (assert) {
    utils.mock_hostnamed({ StaticHostname: undefined });
    assert.strictEqual(utils.mdraid_name({ Name: "somehost:mydev" }), "mydev", "remote host name is skipped when hostnamed is not available");
    utils.mock_hostnamed(null);
});

QUnit.test("mdraid_name_remote", function (assert) {
    utils.mock_hostnamed({ StaticHostname: "sweethome" });
    assert.strictEqual(utils.mdraid_name({ Name: "somehost:mydev" }), "mydev (from somehost)", "expected name for remote host");
    utils.mock_hostnamed(null);
});

QUnit.test("mdraid_name_local_static", function (assert) {
    utils.mock_hostnamed({ StaticHostname: "sweethome" });
    assert.strictEqual(utils.mdraid_name({ Name: "sweethome:mydev" }), "mydev", "expected name for static local host");
    utils.mock_hostnamed(null);
});

QUnit.test("mdraid_name_local_transient", function (assert) {
    utils.mock_hostnamed({ Hostname: "sweethome" });
    assert.strictEqual(utils.mdraid_name({ Name: "sweethome:mydev" }), "mydev", "expected name for transient local host");
    utils.mock_hostnamed(null);
});

QUnit.test("get_byte_units", function (assert) {
    const mb = 1000 * 1000;
    const gb = mb * 1000;
    const tb = gb * 1000;

    const mb_unit = { factor: mb, name: "MB" };
    const gb_unit = { factor: gb, name: "GB" };
    const tb_unit = { factor: tb, name: "TB" };

    function selected(unit) {
        return { factor: unit.factor, name: unit.name, selected: true };
    }

    const checks = [
        [0 * mb, [selected(mb_unit), gb_unit, tb_unit]],
        [20 * mb, [selected(mb_unit), gb_unit, tb_unit]],
        [200 * mb, [selected(mb_unit), gb_unit, tb_unit]],
        [2000 * mb, [selected(mb_unit), gb_unit, tb_unit]],
        [20000 * mb, [mb_unit, selected(gb_unit), tb_unit]],
        [20 * gb, [mb_unit, selected(gb_unit), tb_unit]],
        [200 * gb, [mb_unit, selected(gb_unit), tb_unit]],
        [2000 * gb, [mb_unit, selected(gb_unit), tb_unit]],
        [20000 * gb, [mb_unit, gb_unit, selected(tb_unit)]]
    ];

    assert.expect(checks.length);
    for (let i = 0; i < checks.length; i++) {
        assert.deepEqual(utils.get_byte_units(checks[i][0]), checks[i][1],
                         "get_byte_units(" + checks[i][0] + ") = " + JSON.stringify(checks[i][1]));
    }
});

QUnit.test("format_fsys_usage", function (assert) {
    const [k, M, G, T] = [1_000, 1_000_000, 1_000_000_000, 1_000_000_000_000];

    const sizes = [5, 200, 5 * k, 200 * k, 5 * M, 200 * M, 5 * G, 200 * G, 5 * T, 200 * T];
    /* For each "total" size, format all of the "used" sizes less than or equal to it.
     * The results table lists the part that should come after and before the slash, respectively.
     * For example: ["5 kB", ["0.01", "0.20", "5"]]
     * means 5, 200 and 5k out of 5k are displayed as "0.01 / 5kB", "0.20 / 5kB" and "5 / 5kB"
     */
    const results = [
        ["5", ["5"]],
        ["200", ["5", "200"]],
        ["5 kB", ["0.01", "0.20", "5"]],
        ["200 kB", ["0.01", "0.20", "5", "200"]],
        ["5 MB", ["0.01", "0.01", "0.01", "0.20", "5"]],
        ["200 MB", ["0.01", "0.01", "0.01", "0.20", "5", "200"]],
        ["5 GB", ["0.01", "0.01", "0.01", "0.01", "0.01", "0.20", "5"]],
        ["200 GB", ["0.01", "0.01", "0.01", "0.01", "0.01", "0.20", "5", "200"]],
        ["5 TB", ["0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.20", "5"]],
        ["200 TB", ["0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.01", "0.20", "5", "200"]],
    ];

    for (let total_i = 0; total_i < results.length; total_i++) {
        const [total_string, used_strings] = results[total_i];
        assert.strictEqual(used_strings.length, total_i + 1);
        for (let used_i = 0; used_i < used_strings.length; used_i++) {
            const used_string = used_strings[used_i];

            const used = sizes[used_i];
            const total = sizes[total_i];
            const expected_string = used_string + " / " + total_string;

            assert.strictEqual(
                utils.format_fsys_usage(used, total),
                expected_string,
                f`format_fsys_usage(${used}, ${total})`
            );
        }
    }
});

/* Wait until the hostnamed dbus proxy is actually ready; otherwise the test
 * finishes and kills the bridge before it can respond to the dbus channel open
 * request for the hostnamed connection, which can cause hangs in
 * ./test-server due to timing out that queued request. */
utils.hostnamed.wait(QUnit.start);
