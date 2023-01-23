const path = require("path");
const glob = require("glob");
const fs = require("fs");
const gettext_parser = require('gettext-parser');
const Jed = require('jed');
const webpack = require('webpack');

const srcdir = process.env.SRCDIR || path.resolve(__dirname, '..', '..');

module.exports = class {
    constructor(options) {
        if (!options)
            options = {};
        this.subdir = options.subdir || '';
        this.wrapper = options.wrapper || 'cockpit.locale(PO_DATA);';
    }

    get_po_files(compilation) {
        try {
            const linguas_file = path.resolve(srcdir, "po/LINGUAS");
            const linguas = fs.readFileSync(linguas_file, 'utf8').match(/\S+/g);
            compilation.fileDependencies.add(linguas_file); // Only after reading the file
            return linguas.map(lang => path.resolve(srcdir, 'po', lang + '.po'));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }

            /* No LINGUAS file?  Fall back to globbing.
             * Note: we won't detect .po files being added in this case.
             */
            return glob.sync(path.resolve(srcdir, 'po/*.po'));
        }
    }

    apply(compiler) {
        compiler.hooks.thisCompilation.tap('CockpitPoPlugin', compilation => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: 'CockpitPoPlugin',
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                () => Promise.all(this.get_po_files(compilation).map(f => this.buildFile(f, compilation)))
            );
        });
    }

    get_plural_expr(statement) {
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

    buildFile(po_file, compilation) {
        compilation.fileDependencies.add(po_file);

        return new Promise((resolve, reject) => {
            const parsed = gettext_parser.po.parse(fs.readFileSync(po_file), 'utf8');
            delete parsed.translations[""][""]; // second header copy

            const rtl_langs = ["ar", "fa", "he", "ur"];
            const dir = rtl_langs.includes(parsed.headers.language) ? "rtl" : "ltr";

            // cockpit.js only looks at "plural-forms" and "language"
            const chunks = [
                '{\n',
                ' "": {\n',
                `  "plural-forms": ${this.get_plural_expr(parsed.headers['plural-forms'])},\n`,
                `  "language": "${parsed.headers.language}",\n`,
                `  "language-direction": "${dir}"\n`,
                ' }'
            ];
            for (const [msgctxt, context] of Object.entries(parsed.translations)) {
                const context_prefix = msgctxt ? msgctxt + '\u0004' : ''; /* for cockpit.ngettext */

                for (const [msgid, translation] of Object.entries(context)) {
                    /* Only include msgids which appear in this source directory */
                    const references = translation.comments.reference.split(/\s/);
                    if (!references.some(str => str.startsWith(`pkg/${this.subdir}`)))
                        continue;

                    if (translation.comments.flag && translation.comments.flag.match(/\bfuzzy\b/))
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

            const output = this.wrapper.replace('PO_DATA', chunks.join('')) + '\n';

            const lang = path.basename(po_file).slice(0, -3);
            compilation.emitAsset(this.subdir + 'po.' + lang + '.js', new webpack.sources.RawSource(output));
            resolve();
        });
    }
};
