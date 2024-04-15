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

import * as readline from 'readline';
import CDP from 'chrome-remote-interface';

let enable_debug = false;

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

// We keep sequence numbers so that we never get the protocol out of
// synch with re-ordered or duplicate replies.  This only matters for
// duplicate replies due to destroyed contexts, but that is already so
// hairy that this big hammer seems necessary.

let cur_cmd_seq = 0;
let next_reply_seq = 1;

function fail(seq, err) {
    if (seq != next_reply_seq)
        return;
    next_reply_seq++;

    if (typeof err === 'undefined')
        err = null;
    process.stdout.write(JSON.stringify({ error: err }) + '\n');
}

function success(seq, result) {
    if (seq != next_reply_seq)
        return;
    next_reply_seq++;

    if (typeof result === 'undefined')
        result = null;
    process.stdout.write(JSON.stringify({ result }) + '\n');
}

/**
 * Record console.*() calls and Log messages so that we can forward them to
 * stderr and dump them on test failure
 */
const messages = [];
let logPromiseResolver;
let nReportedLogMessages = 0;
const unhandledExceptions = [];

function clearExceptions() {
    unhandledExceptions.length = 0;
    return Promise.resolve();
}

function stringifyConsoleArg(arg) {
    if (arg.type === 'string')
        return arg.value;
    if (arg.type === 'object')
        return JSON.stringify(arg.value);
    return JSON.stringify(arg);
}

function setupLogging(client) {
    client.Runtime.enable();

    client.Runtime.consoleAPICalled(info => {
        const msg = info.args.map(stringifyConsoleArg).join(" ");
        messages.push([info.type, msg]);
        process.stderr.write("> " + info.type + ": " + msg + "\n");

        resolveLogPromise();
    });

    function processException(info) {
        let details = info.exceptionDetails;
        if (details.exception)
            details = details.exception;

        // don't log test timeouts, they already get handled
        if (details.className === "PhWaitCondTimeout")
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

        const msg = entry.entry;
        let text = msg.text;
        if (typeof text !== "string")
            if (text[0] && typeof text[0] === "string")
                text = text[0];

        if (msg.stackTrace !== undefined &&
            typeof text === "string" &&
            text.indexOf("Error: ") !== -1) {
            const trace = text.split(": ", 1);
            processException({
                exceptionDetails: {
                    exception: {
                        className: trace[0],
                        message: trace.length > 1 ? trace[1] : "",
                        stacktrace: msg.stackTrace,
                        entry: msg,
                    },
                }
            });
        } else {
            messages.push(["cdp", msg]);
            /* Ignore authentication failure log lines that don't denote failures */
            if (!(msg.url || "").endsWith("/login") || (text || "").indexOf("401") === -1) {
                process.stderr.write("CDP: " + JSON.stringify(msg) + "\n");
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
function waitLog() { // eslint-disable-line no-unused-vars
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
const scriptsOnNewContext = [];
const frameIdToContextId = {};
const frameNameToFrameId = {};

let pageLoadHandler = null;
let currentExecId = null;

function setupFrameTracking(client) {
    client.Page.enable();

    // map frame names to frame IDs; root frame has no name, no need to track that
    client.Page.frameNavigated(info => {
        if (info.frame?.url?.startsWith("about:")) {
            debug("frameNavigated: ignoring about: frame " + JSON.stringify(info));
            return;
        }
        debug("frameNavigated " + JSON.stringify(info));
        frameNameToFrameId[info.frame.name || "cockpit1"] = info.frame.id;
    });

    client.Page.loadEventFired(() => {
        if (pageLoadHandler) {
            debug("loadEventFired, calling pageLoadHandler");
            pageLoadHandler();
        } else {
            debug("loadEventFired, but no pageLoadHandler");
        }
    });

    // track execution contexts so that we can map between context and frame IDs
    client.Runtime.executionContextCreated(info => {
        debug("executionContextCreated " + JSON.stringify(info));
        frameIdToContextId[info.context.auxData.frameId] = info.context.id;
        scriptsOnNewContext.forEach(s => {
            client.Runtime.evaluate({ expression: s, contextId: info.context.id })
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
        for (const frameId in frameIdToContextId) {
            if (frameIdToContextId[frameId] == info.executionContextId) {
                delete frameIdToContextId[frameId];
                break;
            }
        }

        // Firefox does not report an error when the execution context
        // of a Runtime.evaluate call gets destroyed.  It will never
        // ever resolve or be rejected.  So let's provide the failure
        // reply from here.
        //
        // However, if the timing is just right, the context gets
        // destroyed before Runtime.evaluate has started the real
        // processing, and in that case it will return an error.  Then
        // we would send the reply here, and would also send the
        // error. This would drive the protocol out of synch. Also, our driver
        // might immediately send more commands after seeing the first reply,
        // and the unwanted second reply might be triggered in the middle of one
        // of the next commands.  To reliably suppress the second reply we have
        // the pretty general sequence number checks.
        //
        if (info.executionContextId == currentExecId) {
            currentExecId = null;
            fail(cur_cmd_seq, { response: { message: "Execution context was destroyed." } });
        }
    });
}

function setupLocalFunctions(client) {
    client.setupPageLoadHandler = timeout => {
        if (pageLoadHandler !== null)
            return Promise.reject("setupPageLoadHandler: already pending"); // eslint-disable-line prefer-promise-reject-errors

        client.pageLoadPromise = new Promise((resolve, reject) => {
            const timeout_timer = setTimeout(() => {
                pageLoadHandler = null;
                reject("Timeout waiting for page load"); // eslint-disable-line prefer-promise-reject-errors
            }, timeout * 1000);

            pageLoadHandler = () => {
                clearTimeout(timeout_timer);
                pageLoadHandler = null;
                resolve({});
            };
        });

        return Promise.resolve({});
    };
}

// helper functions for testlib.py which are too unwieldy to be poked in from Python
function getFrameExecId(frame) { // eslint-disable-line no-unused-vars
    const frameId = frameNameToFrameId[frame || "cockpit1"];
    const execId = frameIdToContextId[frameId];
    if (execId !== undefined)
        currentExecId = execId;
    else
        debug(`WARNING: getFrameExecId: frame ${frame} ID ${frameId} has no known execution context`);
    return execId;
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

if (process.env.TEST_CDP_DEBUG)
    enable_debug = true;

const options = { };
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
function addScriptToEvaluateOnNewDocument(script) { // eslint-disable-line no-unused-vars
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
            setupLogging(client);
            setupFrameTracking(client);
            setupLocalFunctions(client);
            // TODO: Security handling not yet supported in Firefox

            readline.createInterface(process.stdin)
                    .on('line', command => {
                        // HACKS: See description of related functions
                        if (command.startsWith("client.Page.addScriptToEvaluateOnNewDocument"))
                            command = command.substring(12);

                        // run the command
                        const seq = ++cur_cmd_seq;
                        eval(command).then(reply => { // eslint-disable-line no-eval
                            currentExecId = null;
                            if (unhandledExceptions.length === 0) {
                                success(seq, reply);
                            } else {
                                const message = unhandledExceptions[0];
                                fail(seq, message.split("\n")[0]);
                                clearExceptions();
                            }
                        }, err => {
                            currentExecId = null;
                            fail(seq, err);
                        });
                    })
                    .on('close', () => process.exit(0));
        })
        .catch(fatal);
