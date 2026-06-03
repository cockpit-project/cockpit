// SPDX-License-Identifier: LGPL-2.1-or-later

import fs from 'node:fs';

export const cockpitRemoveRHIconsPlugin = () => ({
    name: 'cockpitRemoveRHIconsPlugin',
    setup(build) {
        build.onLoad({ filter: /-icon\.js$/ }, async ({ path }) => {
            let contents = fs.readFileSync(path, 'utf-8');
            contents = contents.replace(/rhUiIcon: {.*}/g, "undefined");
            return { contents };
        });
    }
});
