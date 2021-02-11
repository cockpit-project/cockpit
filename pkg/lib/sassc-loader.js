const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const srcdir = process.env.SRCDIR || path.resolve(__dirname, '..', '..');
const nodedir = path.resolve(srcdir, 'node_modules');
const production = process.env.NODE_ENV === 'production';

/* source is not used. This must be the first loader in the chain, using this.resource, so that sassc can include the scss file's directory in the include path */
module.exports = function() {
    this.cacheable();

    const workdir = fs.mkdtempSync("sassc-loader.");
    const out = path.join(workdir, "output.css");

    childProcess.execFileSync(
        'sassc',
        [
            '--load-path=' + path.resolve(srcdir, 'pkg/lib'),
            '--load-path=' + nodedir,
            '--load-path=' + path.resolve(nodedir, 'font-awesome-sass/assets/stylesheets'),
            '--load-path=' + path.resolve(nodedir, 'patternfly/dist/sass'),
            '--load-path=' + path.resolve(nodedir, 'bootstrap-sass/assets/stylesheets'),
            '--style=compressed', production ? '--' : '--sourcemap', this.resource, out
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] });

    const css = fs.readFileSync(out, 'utf8');
    fs.unlinkSync(out);

    let cssmap;
    if (!production) {
        cssmap = fs.readFileSync(out + ".map", 'utf8');
        fs.unlinkSync(out + ".map");
    }

    fs.rmdirSync(workdir);

    this.callback(null, css, cssmap);
};
