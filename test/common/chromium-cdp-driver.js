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

/* chromium-cdp-driver -- A command-line JSON input/output wrapper around
 * chrome-remote-interface (Chrome Debug Protocol).
 * See https://chromedevtools.github.io/devtools-protocol/
 * This needs support for protocol version 1.3.
 *
 * Set $TEST_CDP_DEBUG environment variable to enable additional
 * frame/execution context debugging.
 */

import * as readline from 'node:readline/promises';
import CDP from 'chrome-remote-interface';

let enable_debug = false;

function debug(msg) {
    if (enable_debug)
        process.stderr.write("CDP: " + msg + "\n");
}

/**
 * Format response to the client
 */

function fail(err) {
    if (typeof err === 'undefined')
        err = null;
    process.stdout.write(JSON.stringify({ error: err }) + '\n');
}

function success(result) {
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
    try {
        if (arg.type === 'string')
            return arg.value;
        if (arg.type === 'number')
            return arg.value;
        if (arg.type === 'undefined')
            return "undefined";
        if (arg.value === null)
            return "null";
        if (arg.type === 'object' && arg.preview?.properties) {
            const obj = {};
            arg.preview.properties.forEach(prop => {
                obj[prop.name] = prop.value.toString();
            });
            return JSON.stringify(obj);
        }
        return JSON.stringify(arg);
    } catch (error) {
        return "[error stringifying argument: " + error.toString() + "]";
    }
}

function setupLogging(client) {
    client.Runtime.enable();

    client.Runtime.consoleAPICalled(info => {
        const msg = info.args.map(stringifyConsoleArg).join(" ");
        messages.push([info.type, msg]);
        process.stderr.write("> " + info.type + ": " + msg + "\n");

        resolveLogPromise();
    });

    client.Runtime.exceptionThrown(info => {
        const details = info.exceptionDetails;
        // don't log test timeouts, they already get handled
        if (details.exception && details.exception.className === "PhWaitCondTimeout")
            return;

        process.stderr.write(details.description || JSON.stringify(details) + "\n");

        unhandledExceptions.push(details.exception.message ||
                                 details.exception.description ||
                                 details.exception.value ||
                                 JSON.stringify(details.exception));
    });

    client.Log.enable();
    client.Log.entryAdded(entry => {
        const msg = entry.entry;

        messages.push(["cdp", msg]);
        /* Ignore authentication failure log lines that don't denote failures */
        if (!(msg.url || "").endsWith("/login") || (msg.text || "").indexOf("401") === -1) {
            process.stderr.write("CDP: " + JSON.stringify(msg) + "\n");
        }
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
const frameIdToContextId = {};
const frameNameToFrameId = {};

let pageLoadHandler = null;

function setupFrameTracking(client) {
    client.Page.enable();

    // map frame names to frame IDs; root frame has no name, no need to track that
    client.Page.frameNavigated(info => {
        debug("frameNavigated " + JSON.stringify(info));
        frameNameToFrameId[info.frame.name || "cockpit1"] = info.frame.id;
    });

    client.Page.loadEventFired(() => {
        if (pageLoadHandler) {
            debug("loadEventFired, resolving pageLoadHandler");
            pageLoadHandler();
        } else {
            debug("loadEventFired, but no pageLoadHandler");
        }
    });

    // track execution contexts so that we can map between context and frame IDs
    client.Runtime.executionContextCreated(info => {
        debug("executionContextCreated " + JSON.stringify(info));
        frameIdToContextId[info.context.auxData.frameId] = info.context.id;
    });

    client.Runtime.executionContextDestroyed(info => {
        debug("executionContextDestroyed " + info.executionContextId);
        for (const frameId in frameIdToContextId) {
            if (frameIdToContextId[frameId] == info.executionContextId) {
                delete frameIdToContextId[frameId];
                break;
            }
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

    async function setCSS({ text, frame }) {
        await client.DOM.enable();
        await client.CSS.enable();
        const id = (await client.CSS.createStyleSheet({ frameId: frameNameToFrameId[frame] })).styleSheetId;
        await client.CSS.setStyleSheetText({
            styleSheetId: id,
            text
        });
    }

    client.setCSS = setCSS;
}

// helper functions for testlib.py which are too unwieldy to be poked in from Python

// eslint-disable-next-line no-unused-vars
const getFrameExecId = frame => frameIdToContextId[frameNameToFrameId[frame ?? "cockpit1"]];

/**
 * SSL handling
 */

// secure by default; tests can override to "continue"
// https://chromedevtools.github.io/devtools-protocol/1-3/Security/#type-CertificateErrorAction
let ssl_bad_certificate_action = "cancel";

/**
 * Change what happens when the browser opens a page with an invalid SSL certificate.
 * Defaults to "cancel", can be set to "continue".
 */
function setSSLBadCertificateAction(action) { // eslint-disable-line no-unused-vars
    ssl_bad_certificate_action = action;
    return Promise.resolve();
}

function setupSSLCertHandling(client) {
    client.Security.enable();

    client.Security.setOverrideCertificateErrors({ override: true });
    client.Security.certificateError(info => {
        process.stderr.write(`CDP: Security.certificateError ${JSON.stringify(info)}; action: ${ssl_bad_certificate_action}\n`);
        client.Security.handleCertificateError({ eventId: info.eventId, action: ssl_bad_certificate_action })
                .catch(ex => {
                // some race condition in Chromium, ok if the event is already gone
                    if (ex.response && ex.response.message && ex.response.message.indexOf("Unknown event id") >= 0)
                        debug(`setupSSLCertHandling for event ${info.eventId} failed, ignoring: ${JSON.stringify(ex.response)}`);
                    else
                        throw ex;
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
async function main() {
    process.stdin.setEncoding('utf8');

    if (process.env.TEST_CDP_DEBUG)
        enable_debug = true;

    const options = { };
    if (process.argv.length >= 3) {
        options.port = parseInt(process.argv[2]);
        if (!options.port) {
            process.stderr.write("Usage: chromium-cdp-driver.js [port]\n");
            process.exit(1);
        }
    }

    const target = await CDP.New(options);
    target.port = options.port;
    const client = await CDP({ target });
    setupLogging(client);
    setupFrameTracking(client);
    setupSSLCertHandling(client);
    setupLocalFunctions(client);

    for await (const command of readline.createInterface(process.stdin)) {
        try {
            const reply = await eval(command); // eslint-disable-line no-eval
            if (unhandledExceptions.length === 0) {
                success(reply);
            } else {
                const message = unhandledExceptions[0];
                fail(message.split("\n")[0]);
                clearExceptions();
            }
        } catch (err) {
            fail(err);
        }
    }
    await CDP.Close(target);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
