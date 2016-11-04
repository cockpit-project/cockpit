/* global QUnit, qunitTap */

var qunit_started = false;

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
    };
});

QUnit.moduleStart(function() {
    qunit_started = true;
});

QUnit.done(function() {
    console.log("phantom-tap-done");
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
 *
 * We also want to insert the current test name into all tap lines.
 */
var tap_regex = /^((not )?ok [0-9]+ (- )?)(.*)$/;
qunitTap(QUnit, function() {
    if (arguments.length == 1 && QUnit.config.current) {
        var match = tap_regex.exec(arguments[0]);
        if (match) {
            console.log(match[1] + QUnit.config.current.testName + ": " + match[4]);
            return;
        }
    }
    console.log.apply(console, arguments);
});

window.setTimeout(function() {
    if (!qunit_started) {
        console.log("QUnit not started by test");
        console.log("phantom-tap-error");
    }
}, 20000);

window.tests_included = true;

if (module && module.exports)
    module.exports = QUnit;
