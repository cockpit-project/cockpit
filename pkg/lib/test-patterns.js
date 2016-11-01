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

var QUnit = require("qunit-tests");
var assert = QUnit;

var $ = require("jquery");
require("patterns");

QUnit.test("update_privileged", function() {
    var p_true = { 'allowed' : true };
    var p_false = { 'allowed' : false };
    var p_unknown = { };

    var b1 = $('<button class="btn" id="b1">');
    var b2 = $('<button class="btn" id="b2" title="A Real title">');

    $(document.body).append(b1, b2);
    $(".btn").update_privileged(p_true, "disabled message");

    assert.equal($("#b1").attr('data-original-title'), "", 'b1 true, normal blank title');
    assert.equal($("#b2").attr('data-original-title'), "A Real title", 'b2 true, normal title');
    assert.ok(!$("#b1").hasClass("disabled"), 'b1 true, no disabled class');
    assert.ok(!$("#b2").hasClass("disabled"), 'b2 true, no disabled class');
    assert.ok(!$("#b1").attr("disabled"), 'b1 true, not disabled');
    assert.ok(!$("#b2").attr("disabled"), 'b2 true, not disabled');

    $(".btn").update_privileged(p_false, "disabled message");

    assert.equal($("#b1").attr('data-original-title'), "disabled message", 'b1 false, disabled title');
    assert.equal($("#b2").attr('data-original-title'), "disabled message", 'b2 false, disabled title');
    assert.ok($("#b1").hasClass("disabled"), 'b1 false, has disabled class');
    assert.ok($("#b2").hasClass("disabled"), 'b2 false, has disabled class');
    assert.ok(!$("#b1").attr("disabled"), 'b1 false, not disabled');
    assert.ok(!$("#b2").attr("disabled"), 'b2 false, not disabled');

    $(".btn").update_privileged(p_unknown, "disabled message");

    assert.equal($("#b1").attr('data-original-title'), "", 'b1 unknown, back to normal blank title');
    assert.equal($("#b2").attr('data-original-title'), "A Real title", 'b2 unknown, back to normal title');
    assert.ok(!$("#b1").hasClass("disabled"), 'b1 unknown, no disabled class');
    assert.ok(!$("#b2").hasClass("disabled"), 'b2 unknown, no disabled class');
    assert.ok(!$("#b1").attr("disabled"), 'b1 unknown, not disabled');
    assert.ok(!$("#b2").attr("disabled"), 'b2 unknown, not disabled');
});

window.setTimeout(function() {
    QUnit.start();
});
