#!/usr/bin/env node

/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

/* cdp-driver -- A command-line JSON input/output wrapper around
 * chrome-remote-interface (Chrome Debug Protocol).
 * See https://chromedevtools.github.io/devtools-protocol/
 * This needs support for protocol version 1.3.
 *
 * Set $TEST_CDP_DEBUG environment variable to enable additional
 * frame/execution context debugging.
 */

const CDP = require('chrome-remote-interface');

var enable_debug = false;

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
    process.stdout.write(JSON.stringify({"error": err}) + '\n');
}

function success(result) {
    process.stdout.write(JSON.stringify({"result": result === undefined ? null : result}) + '\n');
}

/**
 * Record console.*() calls and Log messages so that we can forward them to
 * stderr and dump them on test failure
 */
var messages = [];
var logPromiseResolver;
var nReportedLogMessages = 0;

function setupLogging(client) {
    client.Runtime.enable();

    client.Runtime.consoleAPICalled(info => {
        let msg = info.args.map(v => (v.value || "").toString()).join(" ");
        messages.push([ info.type, msg ]);
        process.stderr.write("> " + info.type + ": " + msg + "\n")
        resolveLogPromise();
    });

    client.Log.enable();
    client.Log.entryAdded(entry => {
        let msg = entry["entry"];
        messages.push([ "cdp", msg ]);
        /* Ignore authentication failure log lines that don't denote failures */
        if (!(msg.url || "").endsWith("/login") || (msg.text || "").indexOf("401") === -1)
            process.stderr.write("CDP: " + JSON.stringify(msg) + "\n");
        resolveLogPromise();
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
var frameIdToContextId = {};
var frameNameToFrameId = {};

// set these to wait for a frame to be loaded
var frameWaitName = null;
var frameWaitPromiseResolve = null;

function setupFrameTracking(client) {
    client.Page.enable();

    // map frame names to frame IDs; root frame has no name, no need to track that
    client.Page.frameNavigated(info => {
        debug("frameNavigated " + JSON.stringify(info));
        if (info.frame.name)
            frameNameToFrameId[info.frame.name] = info.frame.id;

        // were we waiting for this frame to be loaded?
        if (frameWaitPromiseResolve && frameWaitName === info.frame.name) {
            frameWaitPromiseResolve();
            frameWaitPromiseResolve = null;
        }
    });

    // track execution contexts so that we can map between context and frame IDs
    client.Runtime.executionContextCreated(info => {
        debug("executionContextCreated " + JSON.stringify(info));
        frameIdToContextId[info.context.auxData.frameId] = info.context.id;
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
    var frameId = frameNameToFrameId[frame];
    if (!frameId)
        throw Error(`Frame ${frame} is unknown`);
    var execId = frameIdToContextId[frameId];
    if (!execId)
        throw Error(`Frame ${frame} (${frameId}) has no executionContextId`);
    return execId;
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
 * SSL handling
 */

// secure by default; tests can override to "continue"
// https://chromedevtools.github.io/devtools-protocol/1-3/Security/#type-CertificateErrorAction
var ssl_bad_certificate_action = "cancel";

function setupSSLCertHandling(client) {
    client.Security.enable();

    client.Security.setOverrideCertificateErrors({override: true});
    client.Security.certificateError(info => {
        process.stderr.write(`CDP: Security.certificateError ${JSON.stringify(info)}; action: ${ssl_bad_certificate_action}\n`);
        client.Security.handleCertificateError({ eventId: info.eventId, action: ssl_bad_certificate_action });
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
        process.stderr.write("Usage: cdp-driver.js [port]\n");
        process.exit(1);
    }
}

CDP.New(options)
    .then(target => {
        target.port = options.port;
        CDP({target: target})
            .then(client => {
                setupLogging(client);
                setupFrameTracking(client);
                setupSSLCertHandling(client);

                let input_buf = '';
                process.stdin
                    .on('data', chunk => {
                        input_buf += chunk;
                        while (true) {
                            let i = input_buf.indexOf('\n');
                            if (i < 0)
                                break;

                            // run the command
                            eval(input_buf.slice(0, i))
                                .then(success)
                                .catch(fail);

                            input_buf = input_buf.slice(i+1);
                        }

                    })
                   .on('end', () => {
                       CDP.Close(target)
                           .then(() => process.exit(0))
                           .catch(fatal);
                   });
            })
            .catch(fatal);
    })
    .catch(fatal);
