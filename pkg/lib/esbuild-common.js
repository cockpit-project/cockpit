import { sassPlugin } from 'esbuild-sass-plugin';

// List of directories to use when resolving import statements
const nodePaths = ['pkg/lib'];

export const esbuildStylesPlugins = [
    sassPlugin({
        loadPaths: [...nodePaths, 'node_modules'],
        filter: /\.scss/,
        quietDeps: true,
        async transform(source, resolveDir, path) {
            if (path.includes('patternfly-6-cockpit.scss')) {
                return source
                        .replace(/url.*patternfly-icons-fake-path.*;/g, 'url("../base1/fonts/patternfly.woff") format("woff");')
                        .replace(/@font-face[^}]*patternfly-fonts-fake-path[^}]*}/g, '');
            }
            return source;
        }
    }),
];
