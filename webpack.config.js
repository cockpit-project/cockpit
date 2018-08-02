/* --------------------------------------------------------------------
 * Fill in module info here.
 */

var info = {
    entries: {
        "apps/apps": [
            "apps/index.jsx"
        ],

        "dashboard/dashboard": [
            "dashboard/list.js",
        ],

        "docker/docker": [
            "docker/containers.js"
        ],
        "docker/console": [
            "docker/console.js",
        ],

        "kdump/kdump": [
            "kdump/kdump.js",
            "kdump/kdump.css",
        ],

        "kubernetes/kubernetes": [
            "kubernetes/styles/main.less",
            "kubernetes/scripts/main.js",
        ],
        "kubernetes/registry": [
            "kubernetes/styles/registry.less",
            "kubernetes/scripts/registry.js",
        ],

        "machines/machines": [
            "machines/index.js",
            "machines/machines.less",
        ],

        "machines/vnc": [
            "machines/vnc.js",
        ],

        "ovirt/vnc": [
            "ovirt/vnc.js",
        ],

        "networkmanager/network": [
            "networkmanager/interfaces.js",
            "networkmanager/utils.js"
        ],

        "networkmanager/firewall": [
            "networkmanager/firewall.jsx"
        ],


        "ovirt/ovirt": [
            "ovirt/index.js",
            "ovirt/ovirt.less",
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
        ],
        "playground/test": [
            "playground/test",
        ],
        "playground/translate": [
            "playground/translate",
        ],

        "realmd/domain": [
            "realmd/operation.js",
        ],

        "selinux/selinux": [
            "selinux/setroubleshoot.js",
            "selinux/setroubleshoot.css",
        ],

        "shell/index": [
            "shell/index.js",
            "shell/shell.less",
        ],
        "shell/index-stub": [
            "shell/index-stub.js",
        ],
        "shell/index-no-machines": [
            "shell/index-no-machines.js",
        ],

        "sosreport/sosreport": [
            "sosreport/index.js",
            "sosreport/sosreport.css",
        ],

        "storaged/storage": [
            "storaged/devices.js"
        ],

        "subscriptions/subscriptions": [
            "subscriptions/main.js",
            "subscriptions/subscriptions.css",
        ],

        "systemd/services": [
            "systemd/init.js",
            "systemd/services.css",
        ],
        "systemd/logs": [
            "systemd/logs.js",
        ],
        "systemd/system": [
            "systemd/host.js",
            "systemd/host.css",
        ],
        "systemd/terminal": [
            "systemd/terminal.jsx",
            "systemd/terminal.css",
        ],
        "systemd/hwinfo": [
            "systemd/hwinfo.jsx",
            "systemd/hwinfo.css",
        ],

        "tuned/performance": [
            "tuned/dialog.js",
        ],

        "packagekit/updates": [
            "packagekit/updates.jsx",
            "packagekit/updates.less",
        ],

        "users/users": [
            "users/local.js",
            "users/users.css",
        ]
    },

    tests: [
        "docker/test-docker",

        "kdump/test-config-client",

        "lib/test-dummy",
        "lib/test-journal-renderer",
        "lib/test-machines",
        "lib/test-patterns",

        "networkmanager/test-utils",

        "storaged/test-util",

        "kubernetes/scripts/test-utils",
        "kubernetes/scripts/test-images",
        "kubernetes/scripts/test-projects",
        "kubernetes/scripts/test-nodes",
        "kubernetes/scripts/test-kube-client",
        "kubernetes/scripts/test-tags",
        "kubernetes/scripts/test-connection",
        "kubernetes/scripts/test-volumes",

        "machines/test-machines",
    ],

    files: [
        "apps/index.html",
        "apps/default.png",

        "dashboard/index.html",

        "docker/console.html",
        "docker/index.html",
        "docker/images/drive-harddisk-symbolic.svg",

        "kdump/index.html",

        "kubernetes/override.json",
        "kubernetes/index.html",
        "kubernetes/registry.html",

        "machines/base.css",
        "machines/index.html",
        "machines/vnc.html",
        "machines/vnc.css",

        "networkmanager/index.html",
        "networkmanager/firewall.html",
        "networkmanager/manifest.json",

        "ovirt/index.html",
        "ovirt/vnc.html",
        "ovirt/vnc.css",

        "packagekit/index.html",

        "playground/exception.html",
        "playground/hammer.gif",
        "playground/jquery-patterns.html",
        "playground/metrics.html",
        "playground/pkgs.html",
        "playground/plot.html",
        "playground/po.js",
        "playground/react-patterns.html",
        "playground/service.html",
        "playground/speed.html",
        "playground/test.html",
        "playground/translate.html",

        "selinux/setroubleshoot.html",

        "shell/images/server-error.png",
        "shell/images/server-large.png",
        "shell/images/server-small.png",
        "shell/index.html",
        "shell/simple.html",
        "shell/shell.html",
        "shell/stub.html",

        "sosreport/index.html",
        "sosreport/sosreport.png",

        "storaged/index.html",
        "storaged/images/storage-array.png",
        "storaged/images/storage-disk.png",

        "subscriptions/index.html",

        "systemd/index.html",
        "systemd/logs.html",
        "systemd/services.html",
        "systemd/terminal.html",
        "systemd/hwinfo.html",

        "users/index.html",
    ]
};

var externals = {
    "cockpit": "cockpit",
    "jquery": "jQuery",
};

/* ---------------------------------------------------------------------
 * Implementation
 */

var webpack = require("webpack");
var copy = require("copy-webpack-plugin");
var html = require('html-webpack-plugin');
var extract = require("extract-text-webpack-plugin");
var extend = require("extend");
var path = require("path");
var fs = require("fs");

/* These can be overridden, typically from the Makefile.am */
var srcdir = process.env.SRCDIR || __dirname;
var builddir = process.env.BUILDDIR || __dirname;
var distdir = builddir + path.sep + "dist";
var libdir = path.resolve(srcdir, "pkg" + path.sep + "lib");
var nodedir = path.resolve(srcdir, "node_modules");
var section = process.env.ONLYDIR || null;

/* A standard nodejs and webpack pattern */
var production = process.env.NODE_ENV === 'production';

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
    var filename = Array.prototype.join.call(arguments, path.sep);
    var expanded = builddir + path.sep + filename;
    if (fs.existsSync(expanded))
        return expanded;
    expanded = srcdir + path.sep + filename;
    if (!fs.existsSync(expanded) && fs.existsSync(expanded + ".in"))
        return expanded + ".in";
    return expanded;
}

/* Qualify all the paths in entries */
Object.keys(info.entries).forEach(function(key) {
    if (section && key.indexOf(section) !== 0) {
        delete info.entries[key];
        return;
    }

    info.entries[key] = info.entries[key].map(function(value) {
        if (value.indexOf("/") === -1)
            return value;
        else
            return vpath("pkg", value);
    });
});

/* Qualify all the paths in files listed */
var files = [];
info.files.forEach(function(value) {
    if (!section || value.indexOf(section) === 0)
        files.push({ from: vpath("pkg", value), to: value });
});
info.files = files;

var plugins = [
    new webpack.DefinePlugin({
        'process.env': {
            'NODE_ENV': JSON.stringify(production ? 'production' : 'development')
        }
    }),
    new copy(info.files),
    new extract("[name].css"),
];

var output = {
    path: distdir,
    filename: "[name].js",
    sourceMapFilename: "[file].map",
};

/* Only minimize when in production mode */
if (production) {
    plugins.unshift(new webpack.optimize.UglifyJsPlugin({
        beautify: true,
        compress: {
            warnings: false
        },
    }));

    /* Rename output files when minimizing */
    output.filename = "[name].min.js";
}

/* Fill in the tests properly */
info.tests.forEach(function(test) {
    var ext = production ? ".min.js" : ".js";
    if (!section || test.indexOf(section) === 0) {
        info.entries[test] = vpath("pkg", test + ".js");
        plugins.push(new html({
            title: path.basename(test),
            filename: test + ".html",
            template: libdir + path.sep + "qunit-template.html",
            builddir: test.split("/").map(function() { return "../" }).join(""),
            script: path.basename(test + ext),
            inject: false,
        }));
    }
});

/* Just for the sake of tests, jquery.js and cockpit.js files */
if (!section || section.indexOf("base1") === 0) {
    files.push({
        from: srcdir + path.sep + "src/base1/cockpit.js",
        to: "base1/cockpit.js"
    }, {
        from: nodedir + path.sep + "jquery/dist/jquery.js",
        to: "base1/jquery.js"
    }, {
        from: srcdir + path.sep + "po/po.js",
        to: "shell/po.js"
    });
}

var aliases = {
    "angular": "angular/angular.js",
    "angular-route": "angular-route/angular-route.js",
    "d3": "d3/d3.js",
    "moment": "moment/moment.js",
    "react": "react-lite/dist/react-lite.js",
    "react-dom": "react-lite/dist/react-lite.js",
    "term": "term.js-cockpit/src/term.js"
};

/* HACK: To get around redux warning about reminimizing code */
if (production)
    aliases["redux/dist/redux"] = "redux/dist/redux.min.js";

module.exports = {
    resolve: {
        alias: aliases,
        modulesDirectories: [ libdir, nodedir ],
        extensions: ["", ".js", ".json", ".less"]
    },
    resolveLoader: {
        root: nodedir
    },
    entry: info.entries,
    output: output,
    externals: externals,
    plugins: plugins,

    devtool: "source-map",

    module: {
        preLoaders: [
            {
                test: /\.js$/, // include .js files
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: "jshint-loader"
            },
            {
                test: /\.es6$/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: "eslint-loader"
            },
            {
                test: /\.jsx$/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: "eslint-loader"
            }
        ],
        loaders: [
            {
                test: /\.js$/,
                exclude: /\/node_modules\/.*\//, // exclude external dependencies
                loader: 'strict' // Adds "use strict"
            },
            {
                test: /\.jsx$/,
                loader: "babel-loader"
            },
            {
                test: /\.es6$/,
                loader: "babel-loader"
            },
            {
                test: /\.css$/,
                loader: extract.extract("css-loader?minimize=&root=" + libdir)
            },
            {
                test: /\.less$/,
                loader: extract.extract("css-loader?sourceMap&minimize=!less-loader?sourceMap&compress=false")
            },
            {
                test: /views\/[^\/]+\.html$/,
                loader: "ng-cache?prefix=[dir]"
            },
            {
                test: /[\/]angular\.js$/,
                loader: "exports?angular"
            }
        ],

        /* The stuff in noVNC are plain ol javascript */
        noParse: [
            /\/node_modules\/noVNC\//
        ]
    },

    jshint: {
        emitErrors: true,
        failOnHint: true,
        latedef: "nofunc",
        sub: true,
        multistr: true,
        undef: true,
        unused: "vars",
        predef: [ "window", "document", "console" ],
        lastsemic : true,
    },
};
