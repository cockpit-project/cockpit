/* --------------------------------------------------------------------
 * Fill in module info here.
 */

import path from 'path';

import Copy from 'copy-webpack-plugin';
import Html from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CompressionPlugin from 'compression-webpack-plugin';
import TerserJSPlugin from 'terser-webpack-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import ESLintPlugin from 'eslint-webpack-plugin';
import StylelintPlugin from 'stylelint-webpack-plugin';
import { CockpitPoWebpackPlugin } from './pkg/lib/cockpit-po-plugin.js';

const info = {
    entries: [
        "base1/cockpit.js",
        "apps/apps.jsx",
        "kdump/kdump.js",
        // do *not* call this metrics/metrics -- uBlock origin etc. like to block metrics.{css,js}
        "metrics/index.js",

        "networkmanager/networkmanager.jsx",
        "networkmanager/firewall.jsx",

        "playground/index.js",
        "playground/exception.js",
        "playground/metrics.js",
        "playground/pkgs.js",
        "playground/plot.js",
        "playground/react-patterns.js",
        "playground/service.js",
        "playground/speed.js",
        "playground/test.js",
        "playground/translate.js",
        "playground/preloaded.js",
        "playground/notifications-receiver.js",
        "playground/journal.jsx",

        "selinux/selinux.js",
        "shell/shell.js",
        "sosreport/sosreport.jsx",
        "static/login.js",
        "storaged/storaged.jsx",

        "systemd/services.jsx",
        "systemd/logs.jsx",
        "systemd/overview.jsx",
        "systemd/terminal.jsx",
        "systemd/hwinfo.jsx",

        "packagekit/updates.jsx",
        "users/users.js",
    ],

    tests: [
        "base1/test-base64",
        "base1/test-browser-storage",
        "base1/test-cache",
        "base1/test-chan",
        "base1/test-dbus-address",
        "base1/test-dbus-framed",
        "base1/test-dbus",
        "base1/test-echo",
        "base1/test-events",
        "base1/test-external",
        "base1/test-file",
        "base1/test-format",
        "base1/test-framed-cache",
        "base1/test-framed",
        "base1/test-http",
        "base1/test-journal-renderer",
        "base1/test-locale",
        "base1/test-location",
        "base1/test-metrics",
        "base1/test-no-jquery",
        "base1/test-permissions",
        "base1/test-promise",
        "base1/test-protocol",
        "base1/test-series",
        "base1/test-spawn-proc",
        "base1/test-spawn",
        "base1/test-stream",
        "base1/test-user",
        "base1/test-utf8",
        "base1/test-websocket",

        "kdump/test-config-client",

        "networkmanager/test-utils",

        "shell/machines/test-machines",

        "storaged/test-util",
    ],

    files: [
        "apps/index.html",
        "apps/default.png",

        "kdump/index.html",

        "metrics/index.html",

        "networkmanager/index.html",
        "networkmanager/firewall.html",

        "packagekit/index.html",

        "playground/index.html",
        "playground/exception.html",
        "playground/hammer.gif",
        "playground/metrics.html",
        "playground/pkgs.html",
        "playground/plot.html",
        "playground/react-patterns.html",
        "playground/service.html",
        "playground/speed.html",
        "playground/test.html",
        "playground/translate.html",
        "playground/preloaded.html",
        "playground/notifications-receiver.html",
        "playground/journal.html",

        "selinux/index.html",

        "shell/images/server-error.png",
        "shell/images/server-large.png",
        "shell/images/server-small.png",
        "shell/images/cockpit-icon.svg",
        "shell/images/bg-plain.jpg",
        "shell/index.html",
        "shell/shell.html",

        "sosreport/index.html",
        "sosreport/sosreport.png",

        "static/login.html",

        "storaged/index.html",
        "storaged/images/storage-array.png",
        "storaged/images/storage-disk.png",

        "systemd/index.html",
        "systemd/logs.html",
        "systemd/services.html",
        "systemd/terminal.html",
        "systemd/hwinfo.html",

        "users/index.html",
    ]
};

/* ---------------------------------------------------------------------
 * Implementation
 */

process.traceDeprecation = true;

/* These can be overridden, typically from the Makefile.am */
const srcdir = process.env.SRCDIR || '.';
const libdir = path.resolve(srcdir, "pkg" + path.sep + "lib");
const nodedir = path.relative(process.cwd(), path.resolve(srcdir, "node_modules"));
const section = process.env.ONLYDIR || null;

/* A standard nodejs and webpack pattern */
const production = process.env.NODE_ENV === 'production';

/* Default to disable eslint for faster production builds */
const eslint = process.env.ESLINT ? (process.env.ESLINT !== '0') : !production;

/* Default to disable csslint for faster production builds */
const stylelint = process.env.STYLELINT ? (process.env.STYLELINT !== '0') : !production;

const pkgfile = suffix => `${srcdir}/pkg/${suffix}`;

/* Qualify all the paths in entries */
const entry = {};
info.entries.forEach(key => {
    if (section && key.indexOf(section) !== 0)
        return;

    entry[key.replace(/\..*$/, '')] = pkgfile(key);
});

/* Qualify all the paths in files listed */
const files = [];
info.files.forEach(value => {
    if (!section || value.indexOf(section) === 0)
        files.push({ from: pkgfile(value), to: value });
});
if (section) {
    const manifest = section + "manifest.json";
    files.push({ from: pkgfile(manifest), to: manifest });
}
info.files = files;

// main font for all our pages
const redhat_fonts = [
    "Text-updated-Bold", "Text-updated-BoldItalic", "Text-updated-Italic", "Text-updated-Medium", "Text-updated-MediumItalic", "Text-updated-Regular",
    "Display-updated-Black", "Display-updated-BlackItalic", "Display-updated-Bold", "Display-updated-BoldItalic",
    "Display-updated-Italic", "Display-updated-Medium", "Display-updated-MediumItalic", "Display-updated-Regular",
    "Mono-updated-Bold", "Mono-updated-BoldItalic", "Mono-updated-Italic", "Mono-updated-Medium", "Mono-updated-MediumItalic", "Mono-updated-Regular",
].map(name => {
    const subdir = 'RedHat' + name.split('-')[0];
    const fontsdir = '@patternfly/patternfly/assets/fonts/RedHatFont-updated';

    return {
        // Rename the RedHat*-updated files to not contain the 'updated' string so as to keep compatibility with external plugins
        // which expect the non-updated font file names in `static` folder
        from: path.resolve(nodedir, fontsdir, subdir, 'RedHat' + name + '.woff2'),
        to: 'static/fonts/RedHat' + name.replace("-updated", "") + ".woff2"
    };
});

const plugins = [
    new Copy({ patterns: info.files }),
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new CockpitPoWebpackPlugin({
        subdirs: [section],
        // login page does not have cockpit.js, but reads window.cockpit_po
        wrapper: subdir => subdir == "static" ? "window.cockpit_po = PO_DATA;" : undefined,
    }),
];

if (production) {
    plugins.push(new CompressionPlugin({
        test: /\.(css|html|js|txt)$/,
        deleteOriginalAssets: true,
        exclude: [
            '/test-[^/]+.$', // don't compress test cases
            '^static/[^/]+$', // cockpit-ws cannot currently serve compressed login page
            '\\.html$', // HTML pages get patched by cockpit-ws, can't be compressed
        ].map(r => new RegExp(r)),
    }));
}

if (eslint) {
    plugins.push(new ESLintPlugin({ extensions: ["js", "jsx"] }));
}

if (stylelint) {
    plugins.push(new StylelintPlugin({
        context: "pkg/" + section,
    }));
}

if (section.startsWith('static'))
    plugins.push(new Copy({ patterns: redhat_fonts }));

/* Fill in the tests properly */
info.tests.forEach(test => {
    if (!section || test.indexOf(section) === 0) {
        entry[test] = pkgfile(test + ".js");
        plugins.push(new Html({
            title: path.basename(test),
            filename: test + ".html",
            template: libdir + path.sep + "qunit-template.html",
            builddir: test.split("/").map(() => "../").join(""),
            script: path.basename(test + '.js'),
            inject: false,
        }));
    }
});

const aliases = {
    "font-awesome": path.resolve(nodedir, 'font-awesome-sass/assets/stylesheets'),
};

export default {
    mode: production ? 'production' : 'development',
    resolve: {
        alias: aliases,
        modules: [libdir, nodedir],
        extensions: ["*", ".js", ".json"]
    },
    resolveLoader: {
        modules: [nodedir, './pkg/lib'],
    },
    entry,
    // cockpit.js gets included via <script>, everything else should be bundled
    externals: (section === 'kdump/' || section === 'base1/') ? {} : { cockpit: "cockpit" },
    plugins,

    devtool: production ? false : "source-map",
    stats: "errors-warnings",

    // disable noisy warnings about exceeding the recommended size limit
    performance: {
        maxAssetSize: 20000000,
        maxEntrypointSize: 20000000,
    },

    watchOptions: {
        ignored: /node_modules/
    },

    optimization: {
        minimize: production,
        minimizer: [
            new TerserJSPlugin(),
            new CssMinimizerPlugin({
                minimizerOptions: {
                    preset: ['lite']
                }
            })
        ],
    },

    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: 'strict-loader' // Adds "use strict"
            },
            /* these modules need to be babel'ed, they cause bugs in their dist'ed form */
            {
                test: /\/node_modules\/.*(react-table).*\.js$/,
                use: "babel-loader"
            },
            {
                test: /\.(js|jsx)$/,
                // exclude external dependencies; it's too slow, and they are already plain JS except the above
                // also exclude unit tests, we don't need it for them, just a waste and makes failures harder to read
                exclude: /\/node_modules|\/test-[^/]*\.js/,
                use: "babel-loader"
            },
            {
                test: /patternfly-4-cockpit.scss$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: !production,
                            url: false,
                        },
                    },
                    {
                        loader: 'string-replace-loader',
                        options: {
                            multiple: [
                                {
                                    search: /src: ?url\("patternfly-icons-fake-path\/pficon[^}]*/g,
                                    replace: "src:url('fonts/patternfly.woff')format('woff');",
                                },
                                {
                                    search: /@font-face[^}]*patternfly-fonts-fake-path[^}]*}/g,
                                    replace: '',
                                },
                            ]
                        },
                    },
                    {
                        loader: 'sass-loader',
                        options: {
                            sourceMap: !production,
                            sassOptions: {
                                quietDeps: true,
                                outputStyle: production ? 'compressed' : undefined,
                            },
                        },
                    },
                ]
            },
            {
                test: /\.s?css$/,
                exclude: /patternfly-(4-)?cockpit.scss/,
                use: [
                    MiniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: !production,
                            url: false
                        }
                    },
                    {
                        loader: 'sass-loader',
                        options: {
                            sourceMap: !production,
                            sassOptions: {
                                quietDeps: true,
                                outputStyle: production ? 'compressed' : undefined,
                            },
                        },
                    },
                ]
            },
            {
                // See https://github.com/patternfly/patternfly-react/issues/3815 and
                // [Redefine grid breakpoints] section in pkg/lib/_global-variables.scss for more details
                // Components which are using the pf-global--breakpoint-* variables should import scss manually
                // instead off the automatically imported CSS stylesheets
                test: /\.css$/,
                include: stylesheet => {
                    return (
                        stylesheet.includes('@patternfly/react-styles/css/components/Table/') ||
                        stylesheet.includes('@patternfly/react-styles/css/components/Page/') ||
                        stylesheet.includes('@patternfly/react-styles/css/components/Toolbar/')
                    );
                },
                use: ["null-loader"]
            },
            // inlined scripts
            {
                test: /\.(sh|py)$/,
                use: "raw-loader"
            },
        ],
    }
};
