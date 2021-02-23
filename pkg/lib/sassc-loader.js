const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const srcdir = process.env.SRCDIR || path.resolve(__dirname, '..', '..');
const nodedir = path.resolve(srcdir, 'node_modules');

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
            '--style=compressed', '--sourcemap', this.resource, out
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] });

    const css = fs.readFileSync(out, 'utf8');
    const cssmap = fs.readFileSync(out + ".map", 'utf8');

    // source map contains included files, add them as dependencies
    (JSON.parse(cssmap).sources || []).forEach(f => {
        if (f.indexOf('node_modules/') < 0)
            this.addDependency(path.resolve(workdir, f));
    });

    fs.unlinkSync(out);
    fs.unlinkSync(out + ".map");
    fs.rmdirSync(workdir);

    this.callback(null, css, cssmap);
};
