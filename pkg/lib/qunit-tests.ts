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

"use strict";

import QUnit from "qunit";
import qunitTap from "qunit-tap";
import "qunit/qunit/qunit.css";

export const mock_info = async (key: string) => {
    const response = await fetch(`http://${window.location.hostname}:${window.location.port}/mock/info`);
    return (await response.json())[key];
};

// Convenience for skipping tests that the python bridge can't yet
// handle.

let is_pybridge: boolean | null = null;

export const skipWithPybridge = async (name: string, callback: (assert: unknown) => void | Promise<void>) => {
    if (is_pybridge === null)
        is_pybridge = await mock_info("pybridge");

    if (is_pybridge)
        QUnit.skip(name, callback);
    else
        QUnit.test(name, callback);
};

/* Always use explicit start */
QUnit.config.autostart = false;

let qunit_started = false;

QUnit.moduleStart(() => {
    qunit_started = true;
});

window.setTimeout(() => {
    if (!qunit_started) {
        console.log("QUnit not started by test");
        console.log("cockpittest-tap-error");
    }
}, 20000);

/* QUnit-Tap writes the summary line right after this function returns.
* Delay printing the end marker until after that summary is out.
*/
QUnit.done(() => { window.setTimeout(() => console.log("cockpittest-tap-done"), 0) });

/* Now initialize qunit-tap
 *
 * When not running under a tap driver this stuff will just show up in
 * the console. We print out a special canary at the end of the tests
 * so that the tap driver can know when the testing is done.
 *
 * In addition double check for a test file that doesn't properly call
 * QUnit.start() after its done setting up its tests.
 *
 * We also want to insert the current test name into all tap lines.
 */
const tap_regex = /^((not )?ok [0-9]+ (- )?)(.*)$/;
qunitTap(QUnit, function(message: string, ...args: unknown[]) {
    if (args.length == 0 && QUnit.config.current) {
        const match = tap_regex.exec(message);
        if (match) {
            console.log(match[1] + QUnit.config.current.testName + ": " + match[4]);
            return;
        }
    }
    console.log(message, args);
});

export default QUnit;
