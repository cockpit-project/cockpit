// SPDX-License-Identifier: LGPL-2.1-or-later
import fs from 'node:fs';
import path from 'node:path';
export const cockpitTestHtmlPlugin = ({ testFiles }) => ({
    name: 'CockpitTestHtmlPlugin',
    setup(build) {
        build.onEnd(async () => {
            const data = fs.readFileSync(path.resolve(import.meta.dirname, "qunit-template.html.in"), "utf8");
            testFiles.forEach(file => {
                const test = path.parse(file).name;
                const output = data.toString()
                        .replaceAll("%title%", test)
                        .replaceAll("%script%", test + '.js');
                const outdir = path.join(build.initialOptions.outdir, path.dirname(file));
                const outfile = test + ".html";

                fs.mkdirSync(outdir, { recursive: true });
                fs.writeFileSync(path.resolve(outdir, outfile), output);
            });
        });
    }
});
