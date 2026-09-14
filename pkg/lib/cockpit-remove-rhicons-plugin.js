// SPDX-License-Identifier: LGPL-2.1-or-later

import fs from 'node:fs';

export const cockpitRemoveRHIconsPlugin = () => ({
    name: 'cockpitRemoveRHIconsPlugin',
    setup(build) {
        build.onLoad({ filter: /-icon\.js$/ }, async ({ path }) => {
            const contents = await fs.promises.readFile(path, 'utf-8');
            return { contents: contents.replace(/rhUiIcon: {.*}/g, "undefined") };
        });
    }
});
