// SPDX-License-Identifier: LGPL-2.1-or-later
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import gettext_parser from "gettext-parser";

const config = {};

const DEFAULT_WRAPPER = 'cockpit.locale(PO_DATA);';
const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

function get_po_files() {
    const poDir = path.resolve(config.srcdir, 'po');
    try {
        return fs.readdirSync(poDir)
                .filter(file => file.endsWith('.po'))
                .map(file => path.join(poDir, file));
    } catch (error) {
        return [];
    }
}

/**
 * @param {string} statement - a Plural-Forms header value, e.g. "nplurals=2; plural=n != 1;"
 * @returns {string} a JS arrow function wrapping the plural expression, e.g. "((n) => n != 1)"
 * @throws {Error} if the statement is not a valid Plural-Forms header
 */
function plural_forms_as_arrow(statement) {
    const match = statement.match(/^nplurals=[1-9]; plural=([^;]*);?$/);
    if (!match) {
        throw Error(`invalid Plural-Forms: ${JSON.stringify(statement)}`);
    }

    const expr = match[1].trim();
    /* From the docs:
     *
     *   The string following plural is an expression which is using the C
     *   language syntax. Exceptions are that no negative numbers are allowed,
     *   numbers must be decimal, and the only variable allowed is n. Spaces
     *   are allowed in the expression, but backslash-newlines are not.
     *
     * https://www.gnu.org/software/gettext/manual/html_node/Plural-forms.html
     *
     * The described language also happens to be valid JavaScript, but we need
     * to make sure that the user is following the rules.  That's relatively
     * easy to do in a single pass if we keep track of open brackets and don't
     * care about order of operations.
     */
    let i = 0;
    const consume = str => {
        if (expr.startsWith(str, i)) {
            i += str.length;
            return true;
        }
        return false;
    };

    let have_rvalue = false;
    const stack = [];

    while (i < expr.length) {
        if (/\s/.test(expr[i])) {
            i++;
        } else if (have_rvalue) {
            // two-char ops must come before their single-char prefixes
            if (['==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
                '<', '>', '%', '+', '-', '&', '|', '^', '*', '/'].some(consume)) {
                have_rvalue = false;
            } else if (consume('?')) {
                have_rvalue = false;
                stack.push('?');
            } else if (consume(':')) {
                if (stack.pop() !== '?') {
                    throw Error(`unexpected ':' at position ${i-1}`);
                }
                have_rvalue = false;
            } else if (consume(')')) {
                if (stack.pop() !== '(') {
                    throw Error(`unexpected ')' at position ${i-1}`);
                }
            } else {
                throw Error(`expected operator near ${JSON.stringify(expr.slice(i))}`);
            }
        } else {
            // Special case: prevent ++n and --n from being understood as +(+n) and -(-n)
            if (consume('++') || consume('--')) {
                throw Error(`increment/decrement not permitted`);
            } else if (['!', '~', '+', '-'].some(consume)) {
                // stays in operand
            } else if (consume('(')) {
                stack.push('(');
            } else if (consume('n')) {
                have_rvalue = true;
            } else if (/\d/.test(expr[i])) {
                do {
                    i++;
                } while (/\d/.test(expr[i]));
                have_rvalue = true;
            } else {
                throw Error(`expected rvalue near ${JSON.stringify(expr.slice(i))}`);
            }
        }
    }

    if (!have_rvalue) {
        throw Error('incomplete expression');
    }

    if (stack.length !== 0) {
        throw Error(`unclosed '${stack.pop()}'`);
    }

    return `((n) => ${expr})`;
}

function parsePo(po_file) {
    // Read the PO file, remove fuzzy/disabled lines to avoid tripping up the validator
    const po_data = fs.readFileSync(po_file, 'utf8')
            .split('\n')
            .filter(line => !line.startsWith('#~'))
            .join('\n');
    const parsed = gettext_parser.po.parse(po_data, { defaultCharset: 'utf8', validation: true });
    delete parsed.translations[""][""]; // second header copy

    const dir = RTL_LANGS.has(parsed.headers.Language) ? "rtl" : "ltr";

    let plural_forms;
    try {
        plural_forms = plural_forms_as_arrow(parsed.headers['Plural-Forms']);
    } catch (e) {
        throw Error(`${po_file}: Plural-Forms: ${e.message}`);
    }

    return { parsed, dir, plural_forms };
}


function buildFile(data, subdir, filename, filter) {
    const parsed = data.parsed;
    const dir = data.dir;

    // cockpit.js only looks at "plural-forms" and "language"
    const chunks = [
        '{\n',
        ' "": {\n',
        `  "plural-forms": ${data.plural_forms},\n`,
        `  "language": ${JSON.stringify(parsed.headers.Language)},\n`,
        `  "language-direction": "${dir}"\n`,
        ' }'
    ];
    for (const [msgctxt, context] of Object.entries(parsed.translations)) {
        const context_prefix = msgctxt ? msgctxt + '\u0004' : ''; /* for cockpit.ngettext */

        for (const [msgid, translation] of Object.entries(context)) {
            /* Only include msgids which appear in this source directory */
            const references = translation.comments.reference.split(/\s/);
            if (!references.some(str => str.startsWith(`pkg/${subdir}`) || str.startsWith(config.src_directory) || str.startsWith(`pkg/lib`)))
                continue;

            if (translation.comments.flag?.match(/\bfuzzy\b/))
                continue;

            if (!references.some(filter))
                continue;

            const key = JSON.stringify(context_prefix + msgid);
            // cockpit.js always ignores the first item
            chunks.push(`,\n ${key}: [\n  null`);
            for (const str of translation.msgstr) {
                chunks.push(',\n  ' + JSON.stringify(str));
            }
            chunks.push('\n ]');
        }
    }
    chunks.push('\n}');

    const wrapper = config.wrapper?.(subdir) || DEFAULT_WRAPPER;
    const output = wrapper.replace('PO_DATA', chunks.join('')) + '\n';

    const out_path = path.join(subdir ? (subdir + '/') : '', filename);
    fs.writeFileSync(path.resolve(config.outdir, out_path), output);
}

function init(options) {
    config.srcdir = process.env.SRCDIR || './';
    config.subdirs = options.subdirs || [''];
    config.src_directory = options.src_directory || 'src';
    config.wrapper = options.wrapper;
    config.outdir = options.outdir || './dist';
}

function run() {
    const parsedPoFiles = get_po_files().map(po_file => ({
        data: parsePo(po_file),
        lang: path.basename(po_file).slice(0, -3),
    }));

    for (const subdir of config.subdirs) {
        for (const { data, lang } of parsedPoFiles) {
            // Separate translations for the manifest.json file and normal pages
            buildFile(data, subdir, `po.${lang}.js`, str => !str.includes('manifest.json'));
            buildFile(data, subdir, `po.manifest.${lang}.js`, str => str.includes('manifest.json'));
        }
    }
}

export const cockpitPoEsbuildPlugin = options => ({
    name: 'cockpitPoEsbuildPlugin',
    setup(build) {
        init({ ...options, outdir: build.initialOptions.outdir });
        build.onEnd(result => { result.errors.length === 0 && run() });
    },
});

// below this line, tests for the Plural-Forms parser code
function plural_forms_self_test() {
    const pf = expr => `nplurals=2; plural=${expr};`;
    const cases = [
        // real po file expressions
        [true, pf('0')],
        [true, pf('1')],
        [true, pf('n')],
        [true, pf('n != 1')],
        [true, pf('n > 1')],
        [true, pf('(n>1)')],
        [true, pf('(n != 1)')],
        [true, pf('n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5')],
        [true, pf('(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2')],
        [true, pf('n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2')],
        [true, pf('(n == 1) ? 0 : ((n == 2) ? 1 : ((n > 10 && n % 10 == 0) ? 2 : 3))')],
        [true, pf('n==1 ? 0 : (n==0 || (n%100 > 0 && n%100 < 20)) ? 1 : 2')],

        // operator coverage
        [true, pf('n & 1')],
        [true, pf('n | 1')],
        [true, pf('n ^ 1')],
        [true, pf('n << 1')],
        [true, pf('n >> 1')],
        [true, pf('n * 2')],
        [true, pf('n / 2')],
        [true, pf('n + 1')],
        [true, pf('n - 1')],
        [true, pf('!n')],
        [true, pf('~n')],
        [true, pf('+n')],
        [true, pf('-n')],
        [true, pf('!!n')],
        [true, pf('~~~n')],
        [true, pf('+-~!n')],

        // nesting
        [true, pf('((n))')],
        [true, pf('(((n)))')],
        [true, pf('n ? n : n')],
        [true, pf('n ? n ? n : n : n')],
        [true, pf('(n ? n : n)')],

        // whitespace variants
        [true, pf('  n  ')],
        [true, pf('\tn\t')],
        [true, pf('n\n!=\n1')],

        // --- invalid: code injection ---
        [false, pf('n; process.exit(1)')],
        [false, pf('n + require("fs")')],
        [false, pf('(function(){})()')],
        [false, pf('eval(n)')],
        [false, pf('n[0]')], // array subscript
        [false, pf('n[1]')],
        [false, pf('n]')], // close array bracket
        [false, pf('{n}')], // block syntax
        [false, pf('n}')], // close object brace
        [false, pf('n, 1')], // comma operator
        [false, pf('n.length')],
        [false, pf('foo')],
        [false, pf('bar + n')],
        [false, pf('$n')],
        [false, pf('_n')],
        [false, pf('window.n')],
        [false, pf('n || (x=1)')],

        // invalid: multiple n's
        [false, pf('nn')],
        [false, pf('nnn')],
        [false, pf('n n')],

        // invalid: structural
        [false, pf('')], // empty
        [false, pf('?')], // bare operator
        [false, pf(':')],
        [false, pf(')')],
        [false, pf('(')],
        [false, pf('()')], // empty parens
        [false, pf('n ?')], // incomplete ternary
        [false, pf('n ? 1')], // ternary missing else
        [false, pf('(n')], // unclosed paren
        [false, pf('n)')], // unexpected close
        [false, pf('n ? (1 : 2)')], // ? outside, : inside parens
        [false, pf('(n ? 1) : 2')], // ? inside, : outside parens
        [false, pf('n ? 1 : 2 : 3')], // extra colon
        [false, pf(')n(')], // inverted
        [false, pf('((n)')], // mismatched
        [false, pf('n ? ? 1 : 2')], // double ?

        // invalid: operator abuse
        [false, pf('n = 1')], // assignment
        [false, pf('n === 1')], // strict equality
        [false, pf('n += 1')], // compound assignment
        [false, pf('n++')], // post-increment (parses as n + (+...) → incomplete)
        [false, pf('++n')], // pre-increment
        [false, pf('n ** 2')], // exponentiation (not in grammar)
        [false, pf('n >>> 1')], // unsigned right shift
        [false, pf('n;')], // semicolon in expression

        // invalid: literals
        [false, pf('1.5')], // float
        [false, pf('0x10')], // hex
        [false, pf('1e5')], // scientific notation
        [false, pf('"n"')], // string
        [false, pf("'n'")], // string
        [false, pf('`n`')], // template literal

        // invalid: header format
        [false, 'bad'],
        [false, 'plural=n;'], // missing nplurals
        [false, 'nplurals=0; plural=n;'], // nplurals=0 not allowed
        [false, 'nplurals=2; plural=n; extra;'], // trailing content
    ];

    for (const [expected, stmt] of cases) {
        let actual;
        try {
            plural_forms_as_arrow(stmt);
            actual = true;
        } catch (e) {
            actual = false;
        }
        if (actual !== expected) {
            throw Error(`plural_forms_as_arrow self-test failed for ${JSON.stringify(stmt)}: expected ${expected}`);
        }
    }
}

// run the tests on import: it's fast, and it's not a side-effect if it passes.
plural_forms_self_test();
