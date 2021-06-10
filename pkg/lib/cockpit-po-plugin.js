const path = require("path");
const glob = require("glob");
const fs = require("fs");
const childProcess = require("child_process");
const po2json = require('po2json');
const Jed = require('jed');
const webpack = require('webpack');

const srcdir = process.env.SRCDIR || path.resolve(__dirname, '..', '..');

module.exports = class {
    constructor(options) {
        if (!options)
            options = {};
        this.subdir = options.subdir || '';
        this.msggrep_options = options.msggrep_options;
        this.wrapper = options.wrapper || 'cockpit.locale(PO_DATA);';
    }

    apply(compiler) {
        if (!webpack.Compilation) {
            // webpack v4
            compiler.hooks.emit.tapPromise(
                'CockpitPoPlugin',
                compilation => Promise.all(glob.sync(path.resolve(srcdir, 'po/*.po')).map(f => this.buildFile(f, compilation)))
            );
        } else {
            // webpack v5
            compiler.hooks.thisCompilation.tap('CockpitPoPlugin', compilation => {
                compilation.hooks.processAssets.tapPromise(
                    {
                        name: 'CockpitPoPlugin',
                        stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                    },
                    () => Promise.all(glob.sync(path.resolve(srcdir, 'po/*.po')).map(f => this.buildFile(f, compilation)))
                );
            });
        }
    }

    prepareHeader(header) {
        if (!header)
            return null;

        var statement;
        var ret = null;
        const plurals = header["plural-forms"];

        if (plurals) {
            try {
                /* Check that the plural forms isn't being sneaky since we build a function here */
                Jed.PF.parse(plurals);
            } catch (ex) {
                console.error("bad plural forms: " + ex.message);
                process.exit(1);
            }

            /* A lambda for the front end */
            statement = header["plural-forms"];
            ret = statement.replace(/nplurals=[1-9]; plural=([^;]*);?$/, '(n) => $1');
            if (ret === statement) {
                /* didn't match */
                console.error("bad plural forms: " + statement);
                process.exit(1);
            }

            /* Added back in later */
            delete header["plural-forms"];
        }

        /* We don't need to be transferring this */
        delete header["project-id-version"];
        delete header["report-msgid-bugs-to"];
        delete header["pot-creation-date"];
        delete header["po-revision-date"];
        delete header["last-translator"];
        delete header["language-team"];
        delete header["mime-version"];
        delete header["content-type"];
        delete header["content-transfer-encoding"];
        delete header["x-generator"];

        return ret;
    }

    filterMessages(po_file, compilation) {
        // all translations for that page, including manifest.json and *.html
        const argv = ["-N", "*/" + this.subdir + "*"];
        // FIXME: https://github.com/cockpit-project/cockpit/issues/13906
        argv.push("-N", "pkg/base1/cockpit.js");
        // add translations from libraries outside of page directory
        compilation.getStats().compilation.fileDependencies.forEach(path => {
            if (path.startsWith(srcdir) && path.indexOf('node_modules/') < 0)
                argv.push("-N", path.slice(srcdir.length + 1));
        });
        if (this.msggrep_options)
            Array.prototype.push.apply(argv, this.msggrep_options);
        argv.push(po_file);
        return childProcess.execFileSync('msggrep', argv);
    }

    buildFile(po_file, compilation) {
        return new Promise((resolve, reject) => {
            const poData = this.subdir
                ? this.filterMessages(po_file, compilation)
                : fs.readFileSync(po_file);

            const jsonData = po2json.parse(poData);
            const plurals = this.prepareHeader(jsonData[""]);

            let output = JSON.stringify(jsonData, null, 1);

            // We know the brace in is the location to insert our function
            if (plurals) {
                const pos = output.indexOf('{', 1);
                output = output.substr(0, pos + 1) + "'plural-forms':" + String(plurals) + "," + output.substr(pos + 1);
            }

            output = this.wrapper.replace('PO_DATA', output) + '\n';

            const lang = path.basename(po_file).slice(0, -3);
            if (webpack.sources) {
                // webpack v5
                compilation.emitAsset(this.subdir + 'po.' + lang + '.js', new webpack.sources.RawSource(output));
            } else {
                // webpack v4
                compilation.assets[this.subdir + 'po.' + lang + '.js'] = { source: () => output, size: () => output.length };
            }
            resolve();
        });
    }
};
