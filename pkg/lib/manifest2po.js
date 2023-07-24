#!/usr/bin/env node

/*
 * Extracts translatable strings from manifest.json files.
 *
 */

import fs from 'fs';
import path from 'path';
import { ArgumentParser } from 'argparse';

function fatal(message, code) {
    console.log((filename || "manifest2po") + ": " + message);
    process.exit(code || 1);
}

const parser = new ArgumentParser();
parser.add_argument('-d', '--directory', { help: "Base directory for input files" });
parser.add_argument('-o', '--output', { help: 'Output file', required: true });
parser.add_argument('files', { nargs: '+', help: "One or more input files", metavar: "FILE" });
const args = parser.parse_args();

const input = args.files;
const entries = { };

/* Filename being parsed */
let filename = null;

/* Now process each file in turn */
step();

function step() {
    filename = input.shift();
    if (filename === undefined) {
        finish();
        return;
    }

    if (path.basename(filename) != "manifest.json")
        return step();

    /* Qualify the filename if necessary */
    let full = filename;
    if (args.directory)
        full = path.join(args.directory, filename);

    fs.readFile(full, { encoding: "utf-8" }, function(err, data) {
        if (err)
            fatal(err.message);

        // There are variables which when not substituted can cause JSON.parse to fail
        // Dummy replace them. None variable is going to be translated anyway
        const safe_data = data.replace(/@.+?@/gi, 1);
        process_manifest(JSON.parse(safe_data));

        return step();
    });
}

function process_manifest(manifest) {
    if (manifest.menu)
        process_menu(manifest.menu);
    if (manifest.tools)
        process_menu(manifest.tools);
    if (manifest.bridges)
        process_bridges(manifest.bridges);
    if (manifest.docs)
        process_docs(manifest.docs);
}

function process_keywords(keywords) {
    keywords.forEach(v => {
        v.matches.forEach(keyword =>
            push({
                msgid: keyword,
                locations: [filename + ":0"]
            })
        );
    });
}

function process_docs(docs) {
    docs.forEach(doc => {
        push({
            msgid: doc.label,
            locations: [filename + ":0"]
        });
    });
}

function process_menu(menu) {
    for (const m in menu) {
        if (menu[m].label) {
            push({
                msgid: menu[m].label,
                locations: [filename + ":0"]
            });
        }
        if (menu[m].keywords)
            process_keywords(menu[m].keywords);
        if (menu[m].docs)
            process_docs(menu[m].docs);
    }
}

function process_bridges(bridges) {
    for (const b in bridges) {
        if (bridges[b].label) {
            push({
                msgid: bridges[b].label,
                locations: [filename + ":0"]
            });
        }
    }
}

/* Push an entry onto the list */
function push(entry) {
    const key = entry.msgid + "\0" + entry.msgid_plural + "\0" + entry.msgctxt;
    const prev = entries[key];
    if (prev) {
        prev.locations = prev.locations.concat(entry.locations);
    } else {
        entries[key] = entry;
    }
}

/* Escape a string for inclusion in po file */
function escape(string) {
    const bs = string.split('\\')
            .join('\\\\')
            .split('"')
            .join('\\"');
    return bs.split("\n").map(function(line) {
        return '"' + line + '"';
    }).join("\n");
}

/* Finish by writing out the strings */
function finish() {
    const result = [
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: PACKAGE_VERSION\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"X-Generator: Cockpit manifest2po\\n"',
        '',
    ];

    for (const msgid in entries) {
        const entry = entries[msgid];
        result.push('#: ' + entry.locations.join(" "));
        if (entry.msgctxt)
            result.push('msgctxt ' + escape(entry.msgctxt));
        result.push('msgid ' + escape(entry.msgid));
        if (entry.msgid_plural) {
            result.push('msgid_plural ' + escape(entry.msgid_plural));
            result.push('msgstr[0] ""');
            result.push('msgstr[1] ""');
        } else {
            result.push('msgstr ""');
        }
        result.push('');
    }

    const data = result.join('\n');
    if (!args.output) {
        process.stdout.write(data);
        process.exit(0);
    } else {
        fs.writeFile(args.output, data, function(err) {
            if (err)
                fatal(err.message);
            process.exit(0);
        });
    }
}
