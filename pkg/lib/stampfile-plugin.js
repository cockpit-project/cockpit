const fs = require('fs');
const assert = require('assert');

module.exports = class {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('StampfilePlugin', compilation => {
            const stamps = { };

            for (const output in compilation.assets) {
                const path = compilation.assets[output].existsAt;

                /* `output` will be like
                 *
                 *   base1/cockpit.js
                 *
                 * `path` will be like
                 *
                 *   /build/dir/dist/base1/cockpit.js
                 *
                 * We want to get the full absolute path, up to and
                 * including the first directory component of `output`.
                 */
                assert(path.startsWith("/"));
                assert(path.endsWith(output));

                const first_slash = output.indexOf('/');
                const dir_length = path.length - output.length + first_slash;
                const dir = path.slice(0, dir_length);

                /* As per the above example, `dir` would be
                 *
                 *   /build/dir/dist/base1
                 *
                 * Let's put a stamp there.
                 */
                stamps[dir + '/stamp'] = true;
            }

            for (const stampfile in stamps) {
                fs.writeFileSync(stampfile, '');
            }
        });
    }
};
