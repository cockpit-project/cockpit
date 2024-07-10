import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import _ from 'lodash';

const srcdir = process.env.SRCDIR || '.';
const libdir = path.resolve(srcdir, "pkg", "lib");

export const cockpitTestHtmlPlugin = ({ testFiles }) => ({
    name: 'CockpitTestHtmlPlugin',
    setup(build) {
        build.onEnd(async () => {
            const data = fs.readFileSync(path.resolve(libdir, "qunit-template.html.in"), "utf8");
            testFiles.forEach(file => {
                const test = path.parse(file).name;
                const output = _.template(data.toString())({
                    title: test,
                    builddir: file.split("/").map(() => "../").join(""),
                    script: test + '.js',
                });
                const outdir = './qunit/' + path.dirname(file);
                const outfile = test + ".html";

                fs.mkdirSync(outdir, { recursive: true });
                fs.writeFileSync(path.resolve(outdir, outfile), output);
            });
        });
    }
});
