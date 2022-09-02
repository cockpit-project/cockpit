/* --------------------------------------------------------------------
 * Fill in module info here.
 */

const info = {
    entries: {
        "base1/cockpit": [
            "base1/cockpit.js",
        ],

        "apps/apps": [
            "apps/index.jsx"
        ],

        "kdump/kdump": [
            "kdump/kdump.js",
            "kdump/kdump.scss",
        ],

        // do *not* call this metrics/metrics -- uBlock origin etc. like to block metrics.{css,js}
        "metrics/index": [
            "metrics/index.js",
            "metrics/metrics.scss",
        ],

        "networkmanager/network": [
            "networkmanager/app.jsx",
            "networkmanager/utils.js"
        ],

        "networkmanager/firewall": [
            "networkmanager/firewall.jsx"
        ],

        "playground/index": [
            "playground/index.js",
        ],
        "playground/exception": [
            "playground/exception.js",
        ],
        "playground/metrics": [
            "playground/metrics.js",
        ],
        "playground/pkgs": [
            "playground/pkgs.js",
        ],
        "playground/plot": [
            "playground/plot.js",
        ],
        "playground/react-patterns": [
            "playground/react-patterns",
        ],
        "playground/service": [
            "playground/service",
        ],
        "playground/speed": [
            "playground/speed",
            "playground/speed.css",
        ],
        "playground/test": [
            "playground/test",
        ],
        "playground/translate": [
            "playground/translate",
        ],
        "playground/preloaded": [
            "playground/preloaded.js",
        ],
        "playground/notifications-receiver": [
            "playground/notifications-receiver.js",
        ],
        "playground/journal": [
            "playground/journal.jsx",
        ],

        "realmd/domain": [
            "realmd/operation.js",
        ],

        "selinux/selinux": [
            "selinux/setroubleshoot.js",
            "selinux/setroubleshoot.scss",
        ],

        "shell/index": [
            "shell/index.js",
            "shell/shell.scss",
        ],

        "sosreport/sosreport": [
            "sosreport/index.jsx",
        ],

        "static/login": [
            "static/login.js",
            "static/login.css",
        ],

        "storaged/storage": [
            "storaged/devices.jsx"
        ],

        "systemd/services": [
            "systemd/services/services.jsx",
            "systemd/services/services.scss",
        ],
        "systemd/logs": [
            "systemd/logs.jsx",
            "systemd/logs.scss",
        ],
        "systemd/overview": [
            "systemd/overview.jsx",
            "systemd/overview.scss",
        ],
        "systemd/terminal": [
            "systemd/terminal.jsx",
            "systemd/terminal.scss",
        ],
        "systemd/hwinfo": [
            "systemd/hwinfo.jsx",
            "systemd/hwinfo.scss",
        ],
        "tuned/performance": [
            "tuned/dialog.jsx",
        ],

        "packagekit/updates": [
            "packagekit/updates.jsx",
            "packagekit/updates.scss",
        ],

        "users/users": [
            "users/local.js",
            "users/users.scss",
        ]
    },

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

        "selinux/setroubleshoot.html",

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

const path = require("path");
const fs = require("fs");

const Copy = require("copy-webpack-plugin");
const Html = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CompressionPlugin = require("compression-webpack-plugin");
const TerserJSPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const StylelintPlugin = require('stylelint-webpack-plugin');
const CockpitPoPlugin = require("./pkg/lib/cockpit-po-plugin");

/* These can be overridden, typically from the Makefile.am */
const srcdir = process.env.SRCDIR || __dirname;
const builddir = process.env.BUILDDIR || __dirname;
const libdir = path.resolve(srcdir, "pkg" + path.sep + "lib");
const nodedir = path.relative(process.cwd(), path.resolve(srcdir, "node_modules"));
const section = process.env.ONLYDIR || null;

/* A standard nodejs and webpack pattern */
const production = process.env.NODE_ENV === 'production';

/* Default to disable eslint for faster production builds */
const eslint = process.env.ESLINT ? (process.env.ESLINT !== '0') : !production;

/* Default to disable csslint for faster production builds */
const stylelint = process.env.STYLELINT ? (process.env.STYLELINT !== '0') : !production;

/*
 * Note that we're avoiding the use of path.join as webpack and nodejs
 * want relative paths that start with ./ explicitly.
 *
 * In addition we mimic the VPATH style functionality of GNU Makefile
 * where we first check builddir, and then srcdir. In order to avoid
 * people having to run ./configure to hack on Cockpit we also help
 * resolve files that have a '.in' suffix if the resulting file
 * doesn't exist.
 */

function vpath(/* ... */) {
    const filename = Array.prototype.join.call(arguments, path.sep);
    let expanded = builddir + path.sep + filename;
    if (fs.existsSync(expanded))
        return expanded;
    expanded = srcdir + path.sep + filename;
    if (!fs.existsSync(expanded) && fs.existsSync(expanded + ".in"))
        return expanded + ".in";
    return expanded;
}

/* Qualify all the paths in entries */
Object.keys(info.entries).forEach(key => {
    if (section && key.indexOf(section) !== 0) {
        delete info.entries[key];
        return;
    }

    info.entries[key] = info.entries[key].map(value => (value.indexOf("/") === -1) ? value : vpath("pkg", value));
});

/* Qualify all the paths in files listed */
const files = [];
info.files.forEach(value => {
    if (!section || value.indexOf(section) === 0)
        files.push({ from: vpath("pkg", value), to: value });
});
if (section) {
    const manifest = section + "manifest.json";
    files.push({ from: vpath("pkg", manifest), to: manifest });
}
info.files = files;

// main font for all our pages
const redhat_fonts = [
    "Text-Bold", "Text-BoldItalic", "Text-Italic", "Text-Medium", "Text-MediumItalic", "Text-Regular",
    "Display-Black", "Display-BlackItalic", "Display-Bold", "Display-BoldItalic",
    "Display-Italic", "Display-Medium", "Display-MediumItalic", "Display-Regular"
].map(name => {
    const subdir = 'RedHat' + name.split('-')[0];
    return {
        from: path.resolve(nodedir, '@patternfly/patternfly/assets/fonts', subdir, 'RedHat' + name + '.woff2'),
        to: 'static/fonts/'
    };
});

function get_translation_reference_patterns () {
    // shell needs all manifest translations for search
    if (section === 'shell/')
        return ['pkg/.*/manifest.json'];
    if (section === 'static/')
        return ['src/ws/.*'];
    return undefined;
}

const plugins = [
    new Copy({ patterns: info.files }),
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new CockpitPoPlugin({
        subdir: section,
        reference_patterns: get_translation_reference_patterns(),
        // login page does not have cockpit.js, but reads window.cockpit_po
        wrapper: (section === 'static/') ? 'window.cockpit_po = PO_DATA;' : undefined,
    }),
];

if (production) {
    plugins.push(new CompressionPlugin({
        test: /\.(css|html|js|txt)$/,
        deleteOriginalAssets: true,
        exclude: [
            '/test-[^/]+.$', // don't compress test cases
            '^static/[^/]+$', // cockpit-ws cannot currently serve compressed login page
            '^shell/index.html$', // COMPAT: Support older cockpit-ws binaries. See #14673
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
        info.entries[test] = vpath("pkg", test + ".js");
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

module.exports = {
    mode: production ? 'production' : 'development',
    resolve: {
        alias: aliases,
        modules: [libdir, nodedir],
        extensions: ["*", ".js", ".json"]
    },
    resolveLoader: {
        modules: [nodedir, path.resolve(__dirname, 'pkg/lib')],
    },
    entry: info.entries,
    // cockpit.js gets included via <script>, everything else should be bundled
    externals: (section === 'kdump/' || section === 'base1/') ? {} : { cockpit: "cockpit" },
    plugins: plugins,

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
            }
        ],
    }
};
