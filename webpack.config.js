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

        "machines/machines": [
            "machines/index.js",
            "machines/machines.scss",
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
        "playground/jquery-patterns": [
            "playground/jquery-patterns.js",
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
            "sosreport/index.js",
            "sosreport/sosreport.scss",
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
            "systemd/logs.js",
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
            "tuned/dialog.js",
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

        "machines/index.html",

        "metrics/index.html",

        "networkmanager/index.html",
        "networkmanager/firewall.html",
        "networkmanager/manifest.json",

        "packagekit/index.html",

        "playground/index.html",
        "playground/exception.html",
        "playground/hammer.gif",
        "playground/jquery-patterns.html",
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

const childProcess = require('child_process');
const path = require("path");
const fs = require("fs");

const webpack = require("webpack");

const copy = require("copy-webpack-plugin");
const html = require('html-webpack-plugin');
const miniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const CockpitPoPlugin = require("./pkg/lib/cockpit-po-plugin");

/* These can be overridden, typically from the Makefile.am */
const srcdir = process.env.SRCDIR || __dirname;
const builddir = process.env.BUILDDIR || __dirname;
const distdir = builddir + path.sep + "dist";
const libdir = path.resolve(srcdir, "pkg" + path.sep + "lib");
const nodedir = path.resolve(srcdir, "node_modules");
const section = process.env.ONLYDIR || null;

/* A standard nodejs and webpack pattern */
const production = process.env.NODE_ENV === 'production';

/* development options for faster iteration */
const eslint = process.env.ESLINT !== '0';

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
info.files = files;

// base1 fonts for cockpit-bridge package
const base1_fonts = [
    { from: path.resolve(nodedir, 'patternfly/dist/fonts/fontawesome-webfont.woff'), to: 'base1/fonts/fontawesome.woff' },
    { from: path.resolve(nodedir, 'patternfly/dist/fonts/glyphicons-halflings-regular.woff'), to: 'base1/fonts/glyphicons.woff' },
    { from: path.resolve(nodedir, 'patternfly/dist/fonts/PatternFlyIcons-webfont.woff'), to: 'base1/fonts/patternfly.woff' },
];

// main font for all our pages
const redhat_fonts = ["Text-Bold", "Text-BoldItalic", "Text-Italic", "Text-Medium", "Text-MediumItalic", "Text-Regular",
                      "Display-Black", "Display-BlackItalic", "Display-Bold", "Display-BoldItalic",
                      "Display-Italic", "Display-Medium", "Display-MediumItalic", "Display-Regular"].map(name => {
                          const subdir = 'RedHat' + name.split('-')[0];
                          return  {
                              from: path.resolve(nodedir, '@redhat/redhat-font/webfonts', subdir, 'RedHat' + name + '.woff2'),
                              to: 'static/fonts/'
                          };
                      });

// deprecated OpenSans static font for cockpit-ws package (still necessary for RHEL 7 remote hosts)
const opensans_fonts = ["Bold", "BoldItalic", "ExtraBold", "ExtraBoldItalic", "Italic", "Light",
                        "LightItalic", "Regular", "Semibold", "SemiboldItalic"].map(name => (
        { from: path.resolve(nodedir, 'patternfly/dist/fonts/OpenSans-' + name + '-webfont.woff'), to: 'static/fonts/' }
    ));

function get_msggrep_options () {
    // shell needs all manifest translations for search
    if (section === 'shell/')
        return ['-N', 'pkg/*/manifest.json.in'];
    if (section === 'static/')
        return ['-N', 'src/ws/*'];
    return undefined;
}

const plugins = [
    new copy(info.files),
    new miniCssExtractPlugin("[name].css"),
    new OptimizeCSSAssetsPlugin({cssProcessorOptions: {map: {inline: false} } }),
    new CockpitPoPlugin({
        subdir: section,
        msggrep_options: get_msggrep_options(),
        // login page does not have cockpit.js, but reads window.cockpit_po
        wrapper: (section === 'static/') ? 'window.cockpit_po = PO_DATA;' : undefined,
    }),
];

if (section.startsWith('base1'))
    plugins.push(new copy(base1_fonts));

if (section.startsWith('static')) {
    plugins.push(new copy(redhat_fonts));
    plugins.push(new copy(opensans_fonts));
}

/* Fill in the tests properly */
info.tests.forEach(test => {
    if (!section || test.indexOf(section) === 0) {
        info.entries[test] = vpath("pkg", test + ".js");
        plugins.push(new html({
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
    "moment": "moment/moment.js",
    "font-awesome": path.resolve(nodedir, 'font-awesome-sass/assets/stylesheets'),
};

/* HACK: To get around redux warning about reminimizing code */
if (production)
    aliases["redux/dist/redux"] = "redux/dist/redux.min.js";


const babel_loader = {
    loader: "babel-loader",
    options: {
        presets: [
            ["@babel/env", {
                "targets": {
                    "chrome": "57",
                    "firefox": "52",
                    "safari": "10.3",
                    "edge": "16",
                    "opera": "44"
                }
            }],
            "@babel/preset-react"
        ]
    }
}

/* check if sassc is available, to avoid unintelligible error messages */
try {
    childProcess.execFileSync('sassc', ['--version'], { stdio: ['pipe', 'pipe', 'inherit'] });
} catch (e) {
    if (e.code === 'ENOENT') {
        console.error("ERROR: You need to install the 'sassc' package to build this project.");
        process.exit(1);
    } else {
        throw e;
    }
}

module.exports = {
    mode: production ? 'production' : 'development',
    resolve: {
        alias: aliases,
        modules: [ libdir, nodedir ],
        extensions: ["*", ".js", ".json"]
    },
    resolveLoader: {
        modules: [ nodedir, path.resolve(__dirname, 'pkg/lib') ],
    },
    entry: info.entries,
    // cockpit.js gets included via <script>, everything else should be bundled
    externals: { "cockpit": "cockpit" },
    plugins: plugins,

    devtool: "source-map",
    stats: "errors-warnings",

    // disable noisy warnings about exceeding the recommended size limit
    performance: {
        maxAssetSize: 20000000,
        maxEntrypointSize: 20000000,
    },

    watchOptions: {
        ignored: /node_modules/
    },

    module: {
        rules: [
            {
                enforce: 'pre',
                test: eslint ? /\.(js|jsx)$/ : /dont.match.me/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: "eslint-loader"
            },
            // bootstrap UI requires jQuery to be in the global namespace
            // only expose that to pages which need it, as we want to port to React and get rid of jQuery
            {
                issuer: /shell|networkmanager|storaged|systemd\/(logs|services|shutdown)/,
                test: require.resolve('jquery'),
                loader: 'expose-loader',
                options: {
                    exposes: 'jQuery'
                }
            },
            // tuned is embedded into overview, but both require global jQuery; overriding is ok
            {
                issuer: /tuned/,
                test: require.resolve('jquery'),
                loader: 'expose-loader',
                options: {
                    exposes: {
                        globalName: 'jQuery',
                        override: true,
                    }
                }
            },
            {
                test: /\.js$/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: 'strict-loader' // Adds "use strict"
            },
            /* these modules need to be babel'ed, they cause bugs in their dist'ed form */
            {
                test: /\/node_modules\/.*(react-table).*\.js$/,
                use: babel_loader
            },
            {
                test: /\.(js|jsx)$/,
                // exclude external dependencies; it's too slow, and they are already plain JS except the above
                // also exclude unit tests, we don't need it for them, just a waste and makes failures harder to read
                exclude: /\/node_modules|\/test-/,
                use: babel_loader
            },
            /* HACK: remove unwanted fonts from PatternFly's css */
            {
                test: /patternfly-cockpit.scss$/,
                use: [
                    miniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: true,
                            url: false,
                        },
                    },
                    {
                        loader: 'string-replace-loader',
                        options: {
                            multiple: [
                                {
                                    search: /src:url[(]"patternfly-icons-fake-path\/glyphicons-halflings-regular[^}]*/g,
                                    replace: 'font-display:block; src:url("../base1/fonts/glyphicons.woff") format("woff");',
                                },
                                {
                                    search: /src:url[(]"patternfly-fonts-fake-path\/PatternFlyIcons[^}]*/g,
                                    replace: 'src:url("../base1/fonts/patternfly.woff") format("woff");',
                                },
                                {
                                    search: /src:url[(]"patternfly-fonts-fake-path\/fontawesome[^}]*/,
                                    replace: 'font-display:block; src:url("../base1/fonts/fontawesome.woff?v=4.2.0") format("woff");',
                                },
                                {
                                    search: /src:url\("patternfly-icons-fake-path\/pficon[^}]*/g,
                                    replace: 'src:url("../base1/fonts/patternfly.woff") format("woff");',
                                },
                                {
                                    search: /@font-face[^}]*patternfly-fonts-fake-path[^}]*}/g,
                                    replace: '',
                                },
                            ]
                        },
                    },
                    'sassc-loader',
                ]
            },
            {
                test: /patternfly-4-cockpit.scss$/,
                use: [
                    miniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: true,
                            url: false,
                        },
                    },
                    {
                        loader: 'string-replace-loader',
                        options: {
                            multiple: [
                                {
                                    search: /src:url\("patternfly-icons-fake-path\/pficon[^}]*/g,
                                    replace: "src:url('fonts/patternfly.woff')format('woff');",
                                },
                                {
                                    search: /@font-face[^}]*patternfly-fonts-fake-path[^}]*}/g,
                                    replace: '',
                                },
                            ]
                        },
                    },
                    'sassc-loader',
                ]
            },
            {
                test: /\.s?css$/,
                exclude: /patternfly-(4-)?cockpit.scss/,
                use: [
                    miniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: true,
                            url: false
                        }
                    },
                    'sassc-loader',
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
