/* global QUnit, qunitTap */

let qunit_started = false;

/* Always use explicit start */
QUnit.config.autostart = false;

QUnit.moduleStart(function() {
    qunit_started = true;
});

QUnit.done(function() {
    /*
     * QUnit-Tap writes the summary line right after this function returns.
     * Delay printing the end marker until after that summary is out.
     */
    window.setTimeout(function () {
        console.log("cockpittest-tap-done");
    }, 0);
});
/*
 * Now initialize qunit-tap
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
qunitTap(QUnit, function() {
    if (arguments.length == 1 && QUnit.config.current) {
        const match = tap_regex.exec(arguments[0]);
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
        console.log("cockpittest-tap-error");
    }
}, 20000);
