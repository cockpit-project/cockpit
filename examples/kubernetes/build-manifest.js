#!/usr/bin/node

var fs = require('fs');

var input;

function fatal(message, code) {
    console.log((input || "build-manifest") + ": " + message);
    process.exit(code || 1);
}

if (process.argv.length < 3) {
    console.log("usage: build-manifest file ...");
    process.exit(2);
}

var files = process.argv.slice(2);

var manifest = {
    "kind": "List",
    "apiVersion": "v1beta3",
    "items": []
};

function step() {
    if (files.length == 0) {
        input = null;
        process.stdout.write(JSON.stringify(manifest, null, 4));
        process.exit(0);
        return;
    }

    input = files.shift();

    fs.readFile(input, { encoding: "utf-8" }, function(err, data) {
        if (err)
            fatal(err.message);
        var item;
        try {
            item = JSON.parse(data);
        } catch(ex) {
            fatal(ex.message);
        }
        manifest.items.push(item);
        step();
    });
}

step();
