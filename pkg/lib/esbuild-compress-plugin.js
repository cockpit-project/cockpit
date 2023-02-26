/* There is https://www.npmjs.com/package/esbuild-plugin-compress but it does
 * not work together with our PO plugin, they are incompatible due to requiring
 * different values for `write:`. We may be able to change our plugins to work
 * with `write: false`, but this is easy enough to implement ourselves.
*/

import { opendir } from 'node:fs/promises';
import util from 'node:util';
import child_process from 'node:child_process';

const NAME = 'cockpitCompressPlugin';

const exec = util.promisify(child_process.execFile);

export const cockpitCompressPlugin = ({
    name: NAME,
    setup(build) {
        build.onEnd(async () => {
            const gzipPromises = [];
            for await (const dirent of await opendir('dist')) {
                if (dirent.name.endsWith('.js') || dirent.name.endsWith('.css')) {
                    gzipPromises.push(exec('gzip', ['-9', 'dist/' + dirent.name]));
                }
            }
            await Promise.all(gzipPromises);
            return null;
        });
    }
});
