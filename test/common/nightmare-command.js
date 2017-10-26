#!/usr/bin/env node

/**
 * Invocation: nightmare-command.js [injected .js file ...]
 *
 * Examples:
 *
{ "cmd": "goto", "args": ["http://piware.de/tmp/delayedvar.html"] }
{ "cmd": "wait", "args": ["() => { return window.foo == 'updated'; }"] }
{ "cmd": "wait", "args": ["val => { return window.foo == val; }", "updated"] }

{ "cmd": "goto", "args": ["http://localhost:9090"] }
{ "cmd": "visible", "args": ["#server-field"] }

{ "cmd": "evaluate", "args": ["() => ph_is_visible('#server-field')"] }

{ "cmd": "expect_load" }
*/

const Nightmare = require("nightmare");
var fs = require('fs');

var nightmare;
var loadStatus = null; // null or [result, error] callbacks
var messages = [];

function fatal() {
    console.error.apply(console.error, arguments);
    process.exit(1);
}

function fail(err) {
    var msg;
    if (err.message)
        msg = err.message + ': ' + err.details;
    else
        msg = err;
    process.stdout.write('fail ' + msg + '\n');
}

function success(result) {
    process.stdout.write('success ' + JSON.stringify(result === undefined ? null : result) + '\n');
}

function setupHandlers() {
    nightmare.on("did-finish-load", () => {
        // inject all extra files from CLI after each page load
        let n = nightmare;
        for (let i = 2; i < process.argv.length; i++)
            n = n.inject("js", process.argv[i]);

        // after that's done, finish a pending expectLoad()
        if (loadStatus)
            n.then(loadStatus[0]);
    });
    nightmare.on("did-fail-load", () => { if (loadStatus) loadStatus[1](JSON.stringify(arguments)); });

    nightmare.on("console", (type, ...args) => {
        let msg = type + ": " + args.join(" ");
        messages.push(msg);
        process.stderr.write("> " + msg + "\n")
    });
}

function expectLoad() {
    // on("did-*-load") needs to be set before goto(), so we cannot use these directly here
    // FIXME: can this be rewritten using "new Promise()"?
    loadStatus = [
        () => { loadStatus = null; success(); },
        err => { loadStatus = null; fail(err); }
    ];
}

function dumpLog(file) {
    if (messages.length > 0) {
        if (!file)
            file = "page.js.log";
        fs.writeFileSync(file, messages.join("\n"))
        process.stderr.write("Wrote " + file + "\n");
    }
    success();
}

function processCommand(line) {
    var command = JSON.parse(line);
    var args = command["args"] || [];

    switch (command["cmd"]) {
        // passing JS code as first argument
        case 'wait':
        case 'evaluate':
            args[0] = eval(args[0]);
            break;

        // custom functions
        case 'expect_load':
            return expectLoad();
        case 'dump_log':
            return dumpLog(args[0]);
    };

    //console.debug("processCommand", command);

    var fn = nightmare[command["cmd"]];
    if (!fn)
        fatal('Unknown command:', command["cmd"]);
    fn.apply(nightmare, args)
        .then(success)
        .catch(fail);
}


// main input/process loop
process.stdin.setEncoding('utf8');
input_buf = '';

// FIXME: make this a commmand too, or CLI args
// loadTimeout defaults to "infinite", but one minute should be reasonable even on loaded CI machines
nightmare = Nightmare({ show: false, loadTimeout: 60000 });

setupHandlers();

process.stdin
    .on('data', chunk => {
        input_buf += chunk;
        while (true) {
            let i = input_buf.indexOf('\n');
            if (i < 0)
                break;
            processCommand(input_buf.slice(0, i));
            input_buf = input_buf.slice(i+1);
        }

    })
    .on('end', () => nightmare.end().catch(fatal) );
