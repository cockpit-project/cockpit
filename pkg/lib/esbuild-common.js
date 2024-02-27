import { replace } from 'esbuild-plugin-replace';
import { sassPlugin } from 'esbuild-sass-plugin';

// List of directories to use when resolving import statements
const nodePaths = ['pkg/lib'];

export const esbuildStylesPlugins = [
    // Redefine grid breakpoints to count with our shell
    // See https://github.com/patternfly/patternfly-react/issues/3815 and
    // [Redefine grid breakpoints] section in pkg/lib/_global-variables.scss for explanation
    replace({
        include: /\.css$/,
        values: {
            // Do not override the sm breakpoint as for width < 768px the left nav is hidden
            '768px': '428px',
            '992px': '652px',
            '1200px': '876px',
            '1450px': '1100px',
        }
    }),
    sassPlugin({
        loadPaths: [...nodePaths, 'node_modules'],
        quietDeps: true,
        async transform(source, resolveDir, path) {
            if (path.includes('patternfly-5-cockpit.scss')) {
                return source
                        .replace(/url.*patternfly-icons-fake-path.*;/g, 'url("../base1/fonts/patternfly.woff") format("woff");')
                        .replace(/@font-face[^}]*patternfly-fonts-fake-path[^}]*}/g, '');
            }
            return source;
        }
    }),
];
