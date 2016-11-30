/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

/* phantom-driver -- A small driver for phantomjs
 *
 * This program reads a line from stdin, executes the command
 * specified by it, and replies back with a line on stdout.
 *
 * The two main commands are "eval" and "wait". "eval" will execute
 * arbitrary JavaScript in the context of the web page.  "Wait" will
 * run the event loop of the browser until the given condition is
 * true.
 *
 * The "wait" command will check the condition only at explicit
 * 'checkpoints'.  These checkpoints must be triggered by calling
 * 'phantom_checkpoint' from the webapp whenever it reaches a
 * interesting point.
 *
 * While phantom-driver is waiting for the next command, nothing
 * happens on the web page.  No websockets are served, no idle or
 * timeout handlers run, etc.  (The web page does not receive any
 * external input events in any case.)
 *
 * The rest of the command are: "open" to load a specified URL,
 * "inject" to load some JavaScript into the web page, "show" to take
 * a screenshot, and "keys" to send key events.
 */

var page = require('webpage').create();
var sys = require('system');
var clearedStorage = false;
var messages = "";
var onCheckpoint;
var waitTimeout;
var didTimeout;

/* Set by page load handlers */
var resourceFailure = null;
var loadStatus = null;

page.viewportSize = { width: 800, height: 480 };

var unique = 1;
function slot() {
    return "phantom-slot-" + (unique++);
}

var canary = slot();
function inject_basics(loading) {

    /*
     * The canary is a value we set on the top level window object
     * of the page. It indicates to us that our javascript code
     * has already been injected.
     *
     * When loading is used, we force a new canary to be used
     */

    /*
     * Get information about the state of our javascript in the page:
     *   true: already injected
     *   null: is returned, not ready to inject
     *   false: not injected, ready to inject
     */
    var injected = page.evaluate(function(canary, loading) {
        if (loading) {
            if (typeof loading !== "string")
                loading = window.location.href;
            if (window.location.href !== loading || document.readyState === "loading") {
                document.onreadystatechange = function() {
                    console.log("-*-CHECKPOINT-*-");
                };
                return null;
            }
        }
        return canary in window;
    }, canary, loading || false);

    /*
     * When loading require that the old canary has been
     * cleared. And once ready create a new one.
     */
    if (loading) {
        if (injected !== false)
            return false;
        canary = slot();

    /* Already injected */
    } else if (injected) {
        return true;
    }

    /* Perform the injection step */
    clearedStorage = page.evaluate(function(clearedStorage) {
        /* Temporarily disable AMD while loading javascript here */
        if (typeof define === "function" && define.amd) {
            define.amd_overridden = define.amd;
            delete define.amd
        }

        /* Clear storage the first time around, if we can */
        try {
            if (!clearedStorage)
                localStorage.clear();
            clearedStorage = true;
        } catch(ex) { };

        return clearedStorage;
    }, clearedStorage);

    var i, len;
    for (var i = 1, len = sys.args.length; i < len; i++)
        page.injectJs(sys.args[i]);

    page.evaluate(function(canary) {
        window.phantom_checkpoint = function() {
            console.log("-*-CHECKPOINT-*-");
        };

        /* Setup the canary for above check */
        window[canary] = canary;

        /* Reenable AMD if disabled above */
        if (typeof define === "function" && define.amd_overridden) {
            define.amd = define.amd_overridden;
            delete define.amd_overridden;
        }
    }, canary);

    /* Yay, everything's injected */
    return true;
}

var driver = {
    open: function(respond, url) {
	page.open(url);
        return this.expect_load(respond, url);
    },

    reload: function(respond) {
        page.reload();
        return this.expect_load(respond);
    },

    expect_load: function(respond, url) {
        return function check() {
            if (inject_basics(url || true)) {
                if (loadStatus === "success" || (loadStatus === null && resourceFailure === null))
                    respond({ result: null });
                else
                    respond({ error: resourceFailure || loadStatus });
            }
        };
    },

    switch_frame: function(respond, name) {
        if (page.switchToFrame(name))
            respond({ result: null });
        else
            respond({ error: "Can't switch to frame: " + name });
    },

    switch_top: function(respond) {
        page.switchToMainFrame();
        respond({ result: null });
    },

    show: function(respond, file) {
        if (!file)
            file = "page.png"
        page.render(file);
        sys.stderr.writeLine("Wrote " + file)
        respond({ result: null });
    },

    quit: function(respond) {
        sys.stdout.writeLine(JSON.stringify({ result: true }));
        phantom.exit(0);
    },

    sit: function(respond) {
        sys.stdout.writeLine(JSON.stringify({ result: true }));
        // fall through to the phantom event loop
    },

    eval: function(respond, code) {
	var x = slot();

        /* Execute the code and put result in slot */
        inject_basics();
        page.evaluate("function(x) { window[x] = (" + code + ") }", x);

        /* Check for value in the slot and/or wait for it if promise */
        return function check() {
            inject_basics();
            var result = page.evaluate(function(x) {
                var res = null, val;

                if (!(x in window))
                    return null; /* not ready */

                val = window[x];
                delete window[x];

                /* A promise */
                if (val && typeof(val.always) === "function") {
                    val.always(function(v) {
                        if (this.state() === "rejected")
                            throw v;
                        else
                            window[x] = v;
                        phantom_checkpoint();
                    });

                    /* Not yet ready */
                    return null;

                /* Any other value besides a promise */
                } else {
                    res = { result: val === undefined ? null : val };
                }

                return res;
            }, x);

            if (result)
                respond(result);
        };
    },

    wait: function(respond, cond) {
        var func = "function () { return " + cond + "}";
        return function check() {
            inject_basics();
            var val = page.evaluate(func);
            if (val)
                respond({ result: val });
        }
    },

    arm_timeout: function(respond, timeout) {
        if (waitTimeout) {
            respond({ error: "already armed timeout" });
            return;
        }

        didTimeout = false;
        waitTimeout = setTimeout(function() {
            waitTimeout = null;
            didTimeout = true;
        }, timeout || 5000);
        respond({ result: true });
    },

    wait_checkpoint: function(respond) {
        var first = true;
        return function check() {
            if (didTimeout)
                respond({ error: "timeout happened" });
            if (!first)
                respond({ result: null });
            first = false;
        };
    },

    disarm_timeout: function(respond) {
        if (!waitTimeout) {
            respond({ error: "no timeout armed" });
            return;
        }

        clearTimeout(waitTimeout);
        waitTimeout = null;
        didTimeout = false;
        respond({ result: true });
    },

    keys: function(respond, type, keys, modifier) {
        var i;
        if (typeof keys == "string") {
            page.sendEvent(type, keys, null, null, modifier || 0);
        } else {
            for (i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (typeof k == "string" && k.length > 1)
                    k = page.event.key[k];
                page.sendEvent(type, k, null, null, modifier || 0);
            }
        }
        respond({ result: null });
    },

    upload_file: function(respond, selector, file) {
        page.uploadFile(selector, file);
        respond({ result: null });
    },

    ping: function(respond) {
        respond({ result: "pong" });
    },

    cookies: function(respond) {
        respond({ result: phantom.cookies });
    }
};

function step() {
    var line = sys.stdin.readLine();
    var cmd = null, args;

    var responded = false;
    var timeout = null;
    var check = null;

    try {
        cmd = JSON.parse(line || "null");
    } catch(ex) {
        sys.stderr.writeLine("ERROR: Couldn't parse message: " + String(ex));
    }

    if (!cmd) {
        phantom.exit(0);
        return;
    }

    /* Timeout is cleared when responding */
    timeout = window.setTimeout(function() {
        if (check)
            check();
        if (responded)
            sys.stderr.writeLine("WARNING: " + line + " was true after timeout, add more checkpoints");
        else
            respond({ error: "timeout" + messages });
    }, cmd.timeout || 60 * 1000);

    /* This function is called when functions want to respond */
    function respond(out) {
        var line = JSON.stringify(out);
        if (responded) {
            sys.stderr.writeLine("WARNING: Already responded, discarding result: " + line);
            return;
        }

        window.clearTimeout(timeout);
        page.onError = null;
        timeout = null;
        messages = "";
        responded = true;
        onCheckpoint = null;
        loadFailure = null;
        loadStatus = null;

        sys.stdout.writeLine(line);
        step();
    };

    page.onError = function(msg, trace) {
        var i, backtrace = "";
        for (i = 0; i < trace.length; i++)
            backtrace += "\n" + trace[i].file + " " + trace[i].line + " " + trace[i].function;
        sys.stderr.writeLine("Page error: " + msg + backtrace);
        respond({ error: msg });
    };

    if (cmd.cmd in driver) {
        args = (cmd.args || []).slice();
        args.unshift(respond);
        check = driver[cmd.cmd].apply(driver, args);
    } else {
        respond({ error: "No such method defined: " + cmd.cmd });
    }

    /* Caller has not responded */
    if (!responded && check) {
        check();
        if (!responded)
            onCheckpoint = check;
    }
}

function checkpoint() {
    if (onCheckpoint)
        onCheckpoint();
}

page.onResourceError = function(ex) {

    /* These are errors that are not really errors */
    if (ex.errorString.indexOf("Host requires authentication") === 0)
        return;

    var prefix = "Resource Error: ";

    /*
     * Certain resource errors seem to be noise caused by
     * cancelled loads, and racy state in phantomjs
     */
    if (ex.errorString === "Network access is disabled." ||
        ex.errorString === "Operation cancelled" ||
        ex.errorString === "Operation canceled") {
        prefix = "Ignoring Resource Error: ";
    } else {
        loadFailure = ex.errorString + " " + ex.url;
    }

    sys.stderr.writeLine(prefix + ex.errorString + " " + ex.url);
    messages += "\n" + ex.errorString + " " + ex.url;
    checkpoint();
};

page.onLoadFinished = function(val) {
    loadStatus = val;
    checkpoint();
};

page.onConsoleMessage = function(msg, lineNum, sourceId) {
    if (msg == "-*-CHECKPOINT-*-") {
        // sys.stderr.writeLine("CHECKPOINT");
        checkpoint();
    } else {
        messages += "\n" + msg;
        sys.stderr.writeLine('> ' + msg);
    }
};

step();
