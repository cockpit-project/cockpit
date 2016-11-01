/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

var QUnit = require("qunit-tests");
var assert = QUnit;

var machines = require("machines");

QUnit.test("colors.parse()", function() {
    var colors = [
        [ "#960064", "rgb(150, 0, 100)" ],
        [ "rgb(150, 0, 100)", "rgb(150, 0, 100)" ],
        [ "#ccc", "rgb(204, 204, 204)" ],
    ];
    assert.expect(colors.length);
    colors.forEach(function(color) {
        assert.equal(machines.colors.parse(color[0]), color[1], "parsed color " + color[0]);
    });
});

QUnit.start();
