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

import QUnit from "qunit/qunit/qunit.js";
import qunitTap from "qunit-tap/lib/qunit-tap.js";
import "qunit/qunit/qunit.css";

/* QUnit needs to have 'window' as 'this' in order to load */
window.QUnit = QUnit;
window.qunitTap = qunitTap;

require("./qunit-config.js");

QUnit.mock_info = async key => {
    const response = await fetch(`http://${window.location.hostname}:${window.location.port}/mock/info`);
    return (await response.json())[key];
};

// Convenience for skipping tests that the python bridge can't yet
// handle.

if (await QUnit.mock_info("pybridge"))
    QUnit.test.skipWithPybridge = QUnit.test.skip;
else
    QUnit.test.skipWithPybridge = QUnit.test;

export default QUnit;
