import fs from "fs";
import glob from "glob";
import path from "path";

import Jed from "jed";
import gettext_parser from "gettext-parser";

const config = {};

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

function buildFile(po_file, webpack_module, webpack_compilation) {
    if (webpack_compilation)
        webpack_compilation.fileDependencies.add(po_file);

    return new Promise((resolve, reject) => {
        const parsed = gettext_parser.po.parse(fs.readFileSync(po_file), 'utf8');
        delete parsed.translations[""][""]; // second header copy

        const rtl_langs = ["ar", "fa", "he", "ur"];
        const dir = rtl_langs.includes(parsed.headers.language) ? "rtl" : "ltr";

        // cockpit.js only looks at "plural-forms" and "language"
        const chunks = [
            '{\n',
            ' "": {\n',
            `  "plural-forms": ${get_plural_expr(parsed.headers['plural-forms'])},\n`,
            `  "language": "${parsed.headers.language}",\n`,
            `  "language-direction": "${dir}"\n`,
            ' }'
        ];
        for (const [msgctxt, context] of Object.entries(parsed.translations)) {
            const context_prefix = msgctxt ? msgctxt + '\u0004' : ''; /* for cockpit.ngettext */

            for (const [msgid, translation] of Object.entries(context)) {
                /* Only include msgids which appear in this source directory */
                const references = translation.comments.reference.split(/\s/);
                if (!references.some(str => str.startsWith(`pkg/${config.subdir}`) || str.startsWith('src')))
                    continue;

                if (translation.comments.flag?.match(/\bfuzzy\b/))
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

        const output = config.wrapper.replace('PO_DATA', chunks.join('')) + '\n';

        const lang = path.basename(po_file).slice(0, -3);
        const out_path = config.subdir + 'po.' + lang + '.js';
        if (webpack_compilation)
            webpack_compilation.emitAsset(out_path, new webpack_module.sources.RawSource(output));
        else
            fs.writeFileSync(path.resolve(config.outdir, out_path), output);
        return resolve();
    });
}

function init(options) {
    config.srcdir = process.env.SRCDIR || './';
    config.subdir = options.subdir || '';
    config.wrapper = options.wrapper || 'cockpit.locale(PO_DATA)';
    config.outdir = options.outdir || './dist';
}

function run(webpack_module, webpack_compilation) {
    return Promise.all(get_po_files().map(f => buildFile(f, webpack_module, webpack_compilation)));
}

export const cockpitPoEsbuildPlugin = options => ({
    name: 'cockpitPoEsbuildPlugin',
    setup(build) {
        init({ ...options, outdir: build.initialOptions.outdir });
        build.onEnd(async result => { result.errors.length === 0 && await run() });
    },
});

export class CockpitPoWebpackPlugin {
    constructor(options) {
        init(options || {});
    }

    apply(compiler) {
        compiler.hooks.thisCompilation.tap('CockpitPoWebpackPlugin', async compilation => {
            const webpack = (await import('webpack')).default;
            compilation.hooks.processAssets.tapPromise(
                {
                    name: 'CockpitPoWebpackPlugin',
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                () => run(webpack, compilation)
            );
        });
    }
}
