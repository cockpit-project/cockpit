// Replace with plugin from npmjs once they become good enough
// Candidate 1: requires https://github.com/to-codando/esbuild-plugin-linter/issues/1 and https://github.com/to-codando/esbuild-plugin-linter/issues/3 to get fixed
// Candidate 2: requires https://github.com/robinloeffel/esbuild-plugin-eslint/issues/4 and https://github.com/robinloeffel/esbuild-plugin-eslint/issues/5 to get fixed

import { ESLint } from 'eslint';

const NAME = 'eslintPlugin';

export const eslintPlugin = ({ filter = /src\/.*\.(jsx?|js?)$/ } = {}) => ({
    name: NAME,
    setup(build) {
        const filesToLint = [];
        const eslint = new ESLint();

        build.onLoad({ filter }, ({ path }) => {
            filesToLint.push(path);
        });

        build.onEnd(async () => {
            const result = await eslint.lintFiles(filesToLint);
            const formatter = await eslint.loadFormatter('stylish');
            const output = formatter.format(result);
            if (output.length > 0) {
                console.log(output); // eslint-disable no-console
                return {
                    errors: [{ pluginName: NAME, text: 'ESLint errors found' }]
                };
            }
            return null;
        });
    },
});
