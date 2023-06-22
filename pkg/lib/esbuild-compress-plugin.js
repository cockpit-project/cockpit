/* There is https://www.npmjs.com/package/esbuild-plugin-compress but it does
 * not work together with our PO plugin, they are incompatible due to requiring
 * different values for `write:`. We may be able to change our plugins to work
 * with `write: false`, but this is easy enough to implement ourselves.
*/

import path from 'path';
import fs from "fs";
import util from 'node:util';
import child_process from 'node:child_process';

const NAME = 'cockpitCompressPlugin';

const exec = util.promisify(child_process.execFile);

const getAllFiles = function(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
};

export const cockpitCompressPlugin = ({ subdir = '', exclude = null } = {}) => ({
    name: NAME,
    setup(build) {
        build.onEnd(async () => {
            const gzipPromises = [];
            const path = "./dist/" + subdir;

            for await (const dirent of getAllFiles(path)) {
                if (exclude && exclude.test(dirent))
                    continue;
                if (dirent.endsWith('.js') || dirent.endsWith('.css')) {
                    gzipPromises.push(exec('gzip', ['-n9', dirent]));
                }
            }
            await Promise.all(gzipPromises);
            return null;
        });
    }
});
