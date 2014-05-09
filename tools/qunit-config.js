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

var qunit_started = false;
var qunit_included = true;

/* Always use explicit start */
QUnit.config.autostart = false;

/*
 * HACK: phantomjs doesn't handle uncaught exceptions as it should if
 * window.onerror is non-null, even when that handler returns false
 * (expecting that the browser default behavior will occur).
 *
 * So remove the qunit window.onerror handler until the tests actually
 * start, and any errors become part of the test suite results.
 */
var qunit_onerror = window.onerror;
window.onerror = null;
QUnit.begin(function() {
    window.onerror = function(error, file, line) {
        var ret = false;
        if (qunit_onerror)
            ret = qunit_onerror(error, file, line);

        /*
         * If a global exception happens during an async test
         * then that test won't be able to call the start() function
         * to move to the next test, so call it here.
         */
        if (QUnit.config.current && QUnit.config.current.async)
            QUnit.start();

        return ret;
    }
});
QUnit.done(function() {
    window.onerror = null;
});

/*
 * Now initialize qunit-tap
 *
 * When not running under tap-phantom this stuff will just show up in
 * the console. We print out a special canary at the end of the tests
 * so that tap-phantom can know when the testing is done.
 *
 * In addition double check for a test file that doesn't properly call
 * QUnit.start() after its done setting up its tests.
 */
qunitTap(QUnit, function() {
    console.log.apply(console, arguments);
});
QUnit.moduleStart(function() {
    qunit_started = true;
});
QUnit.done(function() {
    console.log("qunit-tap-done");
});
window.setTimeout(function() {
    if (!qunit_started) {
        console.log("QUnit not started by test");
        console.log("qunit-tap-error");
    }
}, 5000);
