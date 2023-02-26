// FIXME: replace when issues get fixed:
// - https://github.com/ordros/esbuild-plugin-stylelint/issues/1
// - https://github.com/ordros/esbuild-plugin-stylelint/issues/2

import * as stylelint from 'stylelint';
import * as formatter from 'stylelint-formatter-pretty';

const NAME = 'stylelintPlugin';

export const stylelintPlugin = ({
    filter = /\.(s?css)$/,
    ...stylelintOptions
} = {}) => ({
    name: NAME,
    setup(build) {
        const targetFiles = [];
        build.onLoad({ filter }, ({ path }) => {
            if (!path.includes('node_modules')) {
                targetFiles.push(path);
            }
        });

        build.onEnd(async () => {
            const result = await stylelint.default.lint({
                formatter: formatter.default,
                ...stylelintOptions,
                files: targetFiles,
            });
            const { output } = result;
            if (output.length > 0) {
                console.log(output); // eslint-disable no-console
                return {
                    errors: [{ pluginName: NAME, text: 'stylelint errors found' }]
                };
            }
            return null;
        });
    }
});
