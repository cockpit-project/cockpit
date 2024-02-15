import fs from "fs";
import glob from "glob";
import path from "path";

import Jed from "jed";
import gettext_parser from "gettext-parser";

const config = {};

const DEFAULT_WRAPPER = 'cockpit.locale(PO_DATA);';

function get_po_files() {
    try {
        const linguas_file = path.resolve(config.srcdir, "po/LINGUAS");
        const linguas = fs.readFileSync(linguas_file, 'utf8').match(/\S+/g);
        return linguas.map(lang => path.resolve(config.srcdir, 'po', lang + '.po'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }

        /* No LINGUAS file?  Fall back to globbing.
         * Note: we won't detect .po files being added in this case.
         */
        return glob.sync(path.resolve(config.srcdir, 'po/*.po'));
    }
}

function get_plural_expr(statement) {
    try {
        /* Check that the plural forms isn't being sneaky since we build a function here */
        Jed.PF.parse(statement);
    } catch (ex) {
        console.error("bad plural forms: " + ex.message);
        process.exit(1);
    }

    const expr = statement.replace(/nplurals=[1-9]; plural=([^;]*);?$/, '(n) => $1');
    if (expr === statement) {
        console.error("bad plural forms: " + statement);
        process.exit(1);
    }

    return expr;
}

function buildFile(po_file, subdir, filename, filter) {
    return new Promise((resolve, reject) => {
        // Read the PO file, remove fuzzy/disabled lines to avoid tripping up the validator
        const po_data = fs.readFileSync(po_file, 'utf8')
                .split('\n')
                .filter(line => !line.startsWith('#~'))
                .join('\n');
        const parsed = gettext_parser.po.parse(po_data, { defaultCharset: 'utf8', validation: true });
        delete parsed.translations[""][""]; // second header copy

        const rtl_langs = ["ar", "fa", "he", "ur"];
        const dir = rtl_langs.includes(parsed.headers.Language) ? "rtl" : "ltr";

        // cockpit.js only looks at "plural-forms" and "language"
        const chunks = [
            '{\n',
            ' "": {\n',
            `  "plural-forms": ${get_plural_expr(parsed.headers['Plural-Forms'])},\n`,
            `  "language": "${parsed.headers.Language}",\n`,
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
        return resolve();
    });
}

function init(options) {
    config.srcdir = process.env.SRCDIR || './';
    config.subdirs = options.subdirs || [''];
    config.src_directory = options.src_directory || 'src';
    config.wrapper = options.wrapper;
    config.outdir = options.outdir || './dist';
}

function run() {
    const promises = [];
    for (const subdir of config.subdirs) {
        for (const po_file of get_po_files()) {
            const lang = path.basename(po_file).slice(0, -3);
            promises.push(Promise.all([
                // Separate translations for the manifest.json file and normal pages
                buildFile(po_file, subdir, `po.${lang}.js`, str => !str.includes('manifest.json')),
                buildFile(po_file, subdir, `po.manifest.${lang}.js`, str => str.includes('manifest.json'))
            ]));
        }
    }
    return Promise.all(promises);
}

export const cockpitPoEsbuildPlugin = options => ({
    name: 'cockpitPoEsbuildPlugin',
    setup(build) {
        init({ ...options, outdir: build.initialOptions.outdir });
        build.onEnd(async result => { result.errors.length === 0 && await run() });
    },
});
