#!/usr/bin/env node

/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

/* firefox-cdp-driver -- A command-line JSON input/output wrapper around
 * chrome-remote-interface (Chrome Debug Protocol).
 * See https://chromedevtools.github.io/devtools-protocol/
 * This needs support for protocol version 1.3.
 *
 * Set $TEST_CDP_DEBUG environment variable to enable additional
 * frame/execution context debugging.
 */

const CDP = require('chrome-remote-interface');

var enable_debug = false;
var the_client = null;

function debug(msg) {
    if (enable_debug)
        process.stderr.write("CDP: " + msg + "\n");
}

/**
 * Format response to the client
 */

function fatal() {
    console.error.apply(console.error, arguments);
    process.exit(1);
}

function fail(err) {
    if (typeof err === 'undefined')
        err = null;
    process.stdout.write(JSON.stringify({"error": err}) + '\n');
}

function success(result) {
    if (typeof result === 'undefined')
        result = null;
    process.stdout.write(JSON.stringify({"result": result}) + '\n');
}

/**
 * Record console.*() calls and Log messages so that we can forward them to
 * stderr and dump them on test failure
 */
var messages = [];
var logPromiseResolver;
var nReportedLogMessages = 0;
var unhandledExceptions = [];
var shownMessages = []; // Show every message just once, keep here seen messages

function clearExceptions() {
    unhandledExceptions.length = 0;
    return Promise.resolve();
}

function setupLogging(client) {
    client.Runtime.enable();

    client.Runtime.consoleAPICalled(info => {
        let msg = info.args.map(v => (v.value || "").toString()).join(" ");
        messages.push([ info.type, msg ]);
        if (shownMessages.indexOf(msg) == -1) {
            if (!enable_debug) // disable message de-duplication in --trace mode
                shownMessages.push(msg);
            process.stderr.write("> " + info.type + ": " + msg + "\n")
        }

        resolveLogPromise();
    });

    function processException(info) {
        let details = info.exceptionDetails;
        if (details.exception)
            details = details.exception;

        // don't log test timeouts, they already get handled
        if (details.className === "PhWaitCondTimeout")
            return;

        // HACK: Sometimes on Firefox >= 77 xterm.js can raise following message when Cockpit is reloaded:
        // `InvalidStateError: An attempt was made to use an object that is not, or is no longer, usable`
        // It does not oops, everything is functional, safe to ignore for now
        if (details.className === "InvalidStateError")
            return;

        process.stderr.write(details.description || details.text || JSON.stringify(details) + "\n");

        unhandledExceptions.push(details.message ||
                                 details.description ||
                                 details.value ||
                                 JSON.stringify(details));
    }

    client.Runtime.exceptionThrown(info => processException(info));

    client.Log.enable();
    client.Log.entryAdded(entry => {
        // HACK: Firefox does not implement `Runtime.exceptionThrown` but logs it
        // Lets parse it to have at least some basic check that code did not throw
        // exception
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1549528

        let msg = entry["entry"];
        let text = msg.text;
        if (typeof text !== "string")
            if (text[0] && typeof text[0] === "string")
                text = text[0];

        if (msg.stackTrace !== undefined &&
            typeof text === "string" &&
            text.indexOf("Error: ") !== -1) {
            trace = text.split(": ", 1);
            processException({exceptionDetails: {
                exception: {
                    className: trace[0],
                    message: trace.length > 1 ? trace[1] : "",
                    stacktrace: msg.stackTrace,
                    entry: msg,
                },
            }
            });
        } else {
            messages.push([ "cdp", msg ]);
            /* Ignore authentication failure log lines that don't denote failures */
            if (!(msg.url || "").endsWith("/login") || (text || "").indexOf("401") === -1) {
                const orig = {...msg};
                delete msg.timestamp;
                delete msg.args;
                const msgstr = JSON.stringify(msg);
                if (shownMessages.indexOf(msgstr) == -1) {
                    if (!enable_debug) // disable message de-duplication in --trace mode
                        shownMessages.push(msgstr);
                    process.stderr.write("CDP: " + JSON.stringify(orig) + "\n");
                }
            }
            resolveLogPromise();
        }
    });
}

/**
 * Resolve the log promise created with waitLog().
 */
function resolveLogPromise() {
    if (logPromiseResolver) {
        logPromiseResolver(messages.slice(nReportedLogMessages));
        nReportedLogMessages = messages.length;
        logPromiseResolver = undefined;
    }
}

/**
 * Returns a promise that resolves when log messages are available. If there
 * are already some unreported ones in the global messages variable, resolves
 * immediately.
 *
 * Only one such promise can be active at a given time. Once the promise is
 * resolved, this function can be called again to wait for further messages.
 */
function waitLog() {
    console.assert(logPromiseResolver === undefined);

    return new Promise((resolve, reject) => {
        logPromiseResolver = resolve;

        if (nReportedLogMessages < messages.length)
            resolveLogPromise();
    });
}

/**
 * Frame tracking
 *
 * For tests to be able to select the current frame (by its name) and make
 * subsequent queries apply to that, we need to track frame name → frameId →
 * executionContextId. Frame and context IDs can even change through page
 * operations (e. g. in systemd/logs.js when reporting a crash is complete),
 * so we also need a helper function to explicitly wait for a particular frame
 * to load. This is very laborious, see this issue for discussing improvements:
 * https://github.com/ChromeDevTools/devtools-protocol/issues/72
 */
var scriptsOnNewContext = [];
var frameIdToContextId = {};
var frameNameToFrameId = {};

// set these to wait for a frame to be loaded
var frameWaitName = null;
var frameWaitPromiseResolve = null;
// set this to wait for a page load
var pageLoadPromise = null;
var pageLoadResolve = null;
var pageLoadReject = null;

function setupFrameTracking(client) {
    client.Page.enable();

    // map frame names to frame IDs; root frame has no name, no need to track that
    client.Page.frameNavigated(info => {
        debug("frameNavigated " + JSON.stringify(info));
        frameNameToFrameId[info.frame.name || "cockpit1"] = info.frame.id;

        // were we waiting for this frame to be loaded?
        if (frameWaitPromiseResolve && frameWaitName === info.frame.name) {
            frameWaitPromiseResolve();
            frameWaitPromiseResolve = null;
        }
    });

    client.Page.loadEventFired(() => {
        if (pageLoadResolve) {
            debug("loadEventFired (waited for)");
            pageLoadResolve();
            pageLoadResolve = null;
            pageLoadReject = null;
        } else {
            debug("loadEventFired (no listener)");
        }
    });

    // track execution contexts so that we can map between context and frame IDs
    client.Runtime.executionContextCreated(info => {
        debug("executionContextCreated " + JSON.stringify(info));
        frameIdToContextId[info.context.auxData.frameId] = info.context.id;
        scriptsOnNewContext.forEach(s => {
            client.Runtime.evaluate({expression: s, contextId: info.context.id})
                .catch(ex => {
                    // race condition with short-lived frames -- OK if the frame is already gone
                    if (ex.response && ex.response.message && ex.response.message.indexOf("Cannot find context") >= 0)
                        debug(`scriptsOnNewContext for context ${info.context.id} failed, ignoring: ${JSON.stringify(ex.response)}`);
                    else
                        throw ex;
                });
        });
    });

    client.Runtime.executionContextDestroyed(info => {
        debug("executionContextDestroyed " + info.executionContextId);
        for (let frameId in frameIdToContextId) {
            if (frameIdToContextId[frameId] == info.executionContextId) {
                delete frameIdToContextId[frameId];
                break;
            }
        }
    });
}

// helper functions for testlib.py which are too unwieldy to be poked in from Python
function getFrameExecId(frame) {
    if (frame === null)
        frame = "cockpit1";
    var frameId = frameNameToFrameId[frame];
    if (!frameId)
        throw Error(`Frame ${frame} is unknown`);
    var execId = frameIdToContextId[frameId];
    if (!execId)
        throw Error(`Frame ${frame} (${frameId}) has no executionContextId`);
    return execId;
}

function expectLoad(timeout) {
    var tm = setTimeout( () => pageLoadReject("timed out waiting for page load"), timeout);
    pageLoadPromise.then( () => { clearTimeout(tm); pageLoadPromise = null; });
    return pageLoadPromise;
}

function expectLoadFrame(name, timeout) {
    return new Promise((resolve, reject) => {
        let tm = setTimeout( () => reject("timed out waiting for frame load"), timeout );

        // we can only have one Page.frameNavigated() handler, so let our handler above resolve this promise
        frameWaitName = name;
        new Promise((fwpResolve, fwpReject) => { frameWaitPromiseResolve = fwpResolve })
            .then(() => {
                // For the frame to be fully valid for queries, it also needs the corresponding
                // executionContextCreated() signal. This might happen before or after frameNavigated(), so wait in case
                // it happens afterwards.
               function pollExecId() {
                    if (frameIdToContextId[frameNameToFrameId[name]]) {
                        clearTimeout(tm);
                        resolve();
                    } else {
                        setTimeout(pollExecId, 100);
                    }
                }
                pollExecId();
            });
    });
}

/**
 * Main input/process loop
 *
 * Read one line with a JS expression, eval() it, and respond with the result:
 *    success <JSON formatted return value>
 *    fail <JSON formatted error>
 * EOF shuts down the client.
 */
process.stdin.setEncoding('utf8');

if (process.env["TEST_CDP_DEBUG"])
    enable_debug = true;

options = { };
if (process.argv.length >= 3) {
    options.port = parseInt(process.argv[2]);
    if (!options.port) {
        process.stderr.write("Usage: firefox-cdp-driver.js [port]\n");
        process.exit(1);
    }
}

// HACK: `addScriptToEvaluateOnNewDocument` is not implemented in Firefox
// thus save all scripts in array and on each new context just execute these
// scripts in them
// https://bugzilla.mozilla.org/show_bug.cgi?id=1549465
function addScriptToEvaluateOnNewDocument(script) {
    return new Promise((resolve, reject) => {
        scriptsOnNewContext.push(script.source);
        resolve();
    });
}

// This should work on different targets (meaning tabs)
// CDP takes {target:target} so we can pick target
// Problem is that CDP.New() which creates new target works only for chrome/ium
// But we should be able to use CPD.List to list all targets and then pick one
// Firefox just gives them ascending numbers, so we can pick the one with highest number
// and if we feel fancy we can check that url is `about:newtab`.
// That still though does not create new tab - but we can just call `firefox about:blank`
// from cdline and since firefox would open it in the same browser, it should work.
// This would work just fine in CI (as there would be only one browser) but on our machines it may
// pick a wrong window (no idea if they can be somehow distinguish and execute it in a specific
// one). But I guess we can live with it (and it seems it picks the last opened window anyway,
// so having your own browser running should not interfere)
//
// Just calling executable to open another tab in the same browser works also for chromium, so
// should be fine
CDP(options)
    .then(client => {
        the_client = client;
        setupLogging(client);
        setupFrameTracking(client);
        // TODO: Security handling not yet supported in Firefox

        let input_buf = '';
        process.stdin
            .on('data', chunk => {
                input_buf += chunk;
                while (true) {
                    let i = input_buf.indexOf('\n');
                    if (i < 0)
                        break;
                    let command = input_buf.slice(0, i);

                    // initialize loadEventFired promise for every command except expectLoad() itself (as that
                    // waits for a load event from the *previous* command); but if the previous command already
                    // was an expectLoad(), reinitialize also, as there are sometimes two consecutive expectLoad()s
                    if (!pageLoadPromise || !command.startsWith("expectLoad("))
                        pageLoadPromise = new Promise((resolve, reject) => { pageLoadResolve = resolve; pageLoadReject = reject; });

                    // HACKS: See description of related functions
                    if (command.startsWith("client.Page.addScriptToEvaluateOnNewDocument"))
                        command = command.substring(12);

                    // run the command
                    eval(command).then(reply => {
                        if (unhandledExceptions.length === 0) {
                            success(reply);
                        } else {
                            let message = unhandledExceptions[0];
                            fail(message.split("\n")[0]);
                            clearExceptions();
                        }
                    }, err => {
                        // HACK: Runtime.evaluate() fails with "Debugger: expected Debugger.Object, got Proxy"
                        // translate that into a proper timeout exception
                        if (err.response && err.response.data && err.response.data.indexOf("setTimeout handler*ph_wait_cond") > 0) {
                            success({exceptionDetails: {
                                exception: {
                                    type: "string",
                                    value: "timeout",
                                }
                            }});
                        } else
                            fail(err);
                    });

                    input_buf = input_buf.slice(i+1);
                }

            })
           .on('end', () => { process.exit(0) });
    })
    .catch(fatal);
