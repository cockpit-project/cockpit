import fs from "node:fs/promises";
import path from 'node:path';

import sha256 from "js-sha256";

const NAME = 'cockpitFilelistPlugin';

const getAllFiles = async function(dirPath, arrayOfFiles) {
    for (const file of await fs.readdir(dirPath)) {
        if ((await fs.stat(path.join(dirPath, file))).isDirectory())
            arrayOfFiles = await getAllFiles(path.join(dirPath, file), arrayOfFiles);
        else
            arrayOfFiles.push(path.join(dirPath, file));
    }

    return arrayOfFiles;
};

export const cockpitFilelistPlugin = ({ subdirs = [''], exclude = null } = {}) => ({
    name: NAME,
    setup(build) {
        build.onEnd(async result => {
            for (const subdir of subdirs) {
                const path = "dist/" + subdir;
                const path_len = path.length + 1; // strip off extra '/' at the end
                const checksums = {};

                for await (const dirent of await getAllFiles(path, [])) {
                    // don't include manifest.json, as they can be overridden or hidden
                    if (dirent.endsWith("manifest.json"))
                        continue;
                    if (exclude?.test(dirent))
                        continue;
                    const fd = await fs.open(dirent, 'r');
                    checksums[dirent.substring(path_len)] = sha256.hex(await fd.readFile());
                    await fd.close();
                }

                // write file list with checksums to file
                const fd = await fs.open(path + "/index.json", 'w');
                await fd.writeFile(JSON.stringify(checksums, null, 2));
                await fd.close();
            }

            return null;
        });
    }
});
