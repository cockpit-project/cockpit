#!/usr/bin/env node

/*
 * Extracts translatable strings from HTML files in the following forms:
 *
 * <tag translate>String</tag>
 * <tag translate context="value">String</tag>
 * <tag translate="...">String</tag>
 * <tag translate-attr attr="String"></tag>
 *
 * Supports the following angular-gettext compatible forms:
 *
 * <translate>String</translate>
 * <tag translate-plural="Plural">Singular</tag>
 *
 * Note that some of the use of the translated may not support all the strings
 * depending on the code actually using these strings to translate the HTML.
 */

import fs from 'fs';
import path from 'path';
import htmlparser from 'htmlparser';
import { ArgumentParser } from 'argparse';

function fatal(message, code) {
    console.log((filename || "html2po") + ": " + message);
    process.exit(code || 1);
}

const parser = new ArgumentParser();
parser.add_argument('-d', '--directory', { help: "Base directory for input files" });
parser.add_argument('-o', '--output', { help: 'Output file', required: true });
parser.add_argument('files', { nargs: '+', help: "One or more input files", metavar: "FILE" });
const args = parser.parse_args();

const input = args.files;
const entries = { };

/* Filename being parsed and offset of line number */
let filename = null;
let offsets = 0;

/* The HTML parser we're using */
const handler = new htmlparser.DefaultHandler(function(error, dom) {
    if (error)
        fatal(error);
    else
        walk(dom);
});

/* Now process each file in turn */
step();

function step() {
    filename = input.shift();
    if (filename === undefined) {
        finish();
        return;
    }

    /* Qualify the filename if necessary */
    let full = filename;
    if (args.directory)
        full = path.join(args.directory, filename);

    fs.readFile(full, { encoding: "utf-8" }, function(err, data) {
        if (err)
            fatal(err.message);

        const parser = new htmlparser.Parser(handler, { includeLocation: true });
        parser.parseComplete(data);
        step();
    });
}

/* Process an array of nodes */
function walk(children) {
    if (!children)
        return;

    children.forEach(function(child) {
        const line = (child.location || { }).line || 0;
        const offset = line - 1;

        /* Scripts get their text processed as HTML */
        if (child.type == 'script' && child.children) {
            const parser = new htmlparser.Parser(handler, { includeLocation: true });

            /* Make note of how far into the outer HTML file we are */
            offsets += offset;

            child.children.forEach(function(node) {
                parser.parseChunk(node.raw);
            });
            parser.done();

            offsets -= offset;

        /* Tags get extracted as usual */
        } else if (child.type == 'tag') {
            tag(child);
        }
    });
}

/* Process a single loaded tag */
function tag(node) {
    let tasks, line, entry;
    const attrs = node.attribs || { };
    let nest = true;

    /* Extract translate strings */
    if ("translate" in attrs || "translatable" in attrs) {
        tasks = (attrs.translate || attrs.translatable || "yes").split(" ");

        /* Calculate the line location taking into account nested parsing */
        line = (node.location || { }).line || 0;
        line += offsets;

        entry = {
            msgctxt: attrs['translate-context'] || attrs.context,
            msgid_plural: attrs['translate-plural'],
            locations: [filename + ":" + line]
        };

        /* For each thing listed */
        tasks.forEach(function(task) {
            const copy = Object.assign({}, entry);

            /* The element text itself */
            if (task == "yes" || task == "translate") {
                copy.msgid = extract(node.children);
                nest = false;

            /* An attribute */
            } else if (task) {
                copy.msgid = attrs[task];
            }

            if (copy.msgid)
                push(copy);
        });
    }

    /* Walk through all the children */
    if (nest)
        walk(node.children);
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

/* Extract the given text */
function extract(children) {
    if (!children)
        return null;

    const str = [];
    children.forEach(function(node) {
        if (node.type == 'tag' && node.children)
            str.push(extract(node.children));
        else if (node.type == 'text' && node.data)
            str.push(node.data);
    });

    const msgid = str.join("");

    if (msgid != msgid.trim()) {
        console.error("FATAL: string contains leading or trailing whitespace:", msgid);
        process.exit(1);
    }

    return msgid;
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
        '"X-Generator: Cockpit html2po\\n"',
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
