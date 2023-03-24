import fs from 'fs';
import path from 'path';

// always start with a fresh dist/ directory, to change between development and production, or clean up gzipped files
export const cleanPlugin = ({ outdir = './dist', subdir = '' } = {}) => ({
    name: 'clean-dist',
    setup(build) {
        build.onStart(() => {
            try {
                fs.rmSync(path.resolve(outdir, subdir), { recursive: true });
            } catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        });
    }
});
