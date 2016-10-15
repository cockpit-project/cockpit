/* --------------------------------------------------------------------
 * Fill in module info here.
 */

var info = {
    entries: {
        "docker/docker": [
            "docker/containers.js",
            "docker/docker.css",
        ],
        "docker/console": [
            "docker/console.js",
        ],
        "dashboard/dashboard": [
            "dashboard/list.js",
        ],
        "kubernetes/kubernetes": [
            "kubernetes/styles/main.less",
            "kubernetes/scripts/main.js",
        ],
        "kubernetes/registry": [
            "kubernetes/styles/registry.less",
            "kubernetes/scripts/registry.js",
        ],
        "networkmanager/network": [
            "networkmanager/interfaces.js",
            "networkmanager/networking.css",
        ],
        "ostree/ostree": [
            "ostree/app.js",
            "ostree/ostree.css",
        ],
        "playground/jquery-patterns": [
            "playground/jquery-patterns.js",
        ],
        "playground/metrics": [
            "playground/metrics.js",
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
        "playground/test": [
            "playground/test",
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
            "shell/shell.css",
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
            "storaged/devices.js",
            "storaged/storage.css",
        ],
        "subscriptions/subscriptions": [
            "subscriptions/main.js",
            "subscriptions/subscriptions.css",
        ],
        "systemd/services": [
            "systemd/init.js",
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
        ],
        "tuned/performance": [
            "tuned/dialog.js",
        ],
        "machines/machines": [
            "machines/index.js",
            "machines/machines.css",
        ],
        "users/users": [
            "users/local.js",
            "users/users.css",
        ]
    },

    files: [
        "docker/console.html",
        "docker/manifest.json",
        "docker/index.html",
        "docker/images/drive-harddisk-symbolic.svg",

        "dashboard/index.html",
        "dashboard/manifest.json",

        "kubernetes/manifest.json",
        "kubernetes/override.json",
        "kubernetes/index.html",
        "kubernetes/registry.html",

        "networkmanager/index.html",
        "networkmanager/manifest.json",

        "ostree/manifest.json",
        "ostree/index.html",

        "playground/hammer.gif",
        "playground/manifest.json",
        "playground/jquery-patterns.html",
        "playground/metrics.html",
        "playground/plot.html",
        "playground/po.js",
        "playground/po.de.js",
        "playground/react-patterns.html",
        "playground/service.html",
        "playground/test.html",

        "realmd/manifest.json",

        "selinux/manifest.json",
        "selinux/setroubleshoot.html",

        "shell/images/server-error.png",
        "shell/images/server-large.png",
        "shell/images/server-small.png",
        "shell/index.html",
        "shell/manifest.json",
        "shell/simple.html",
        "shell/shell.html",
        "shell/stub.html",

        "sosreport/index.html",
        "sosreport/sosreport.png",
        "sosreport/manifest.json",

        "storaged/index.html",
        "storaged/manifest.json",
        "storaged/images/storage-array.png",
        "storaged/images/storage-disk.png",

        "systemd/index.html",
        "systemd/logs.html",
        "systemd/manifest.json",
        "systemd/services.html",
        "systemd/terminal.html",

        "tuned/manifest.json",

        "users/index.html",
        "users/manifest.json",

        "subscriptions/index.html",
        "subscriptions/manifest.json",

        "machines/index.html",
        "machines/manifest.json"
    ]
};

var externals = {
    "cockpit": "cockpit",
    "jquery": "jQuery",
}

/* ---------------------------------------------------------------------
 * Implementation
 */

var webpack = require("webpack");
var copy = require("copy-webpack-plugin");
var extract = require("extract-text-webpack-plugin");
var extend = require("extend");
var path = require("path");

/* For node 0.10.x we need this defined */
if (typeof(global.Promise) == "undefined")
    global.Promise = require('promise');

/* These can be overridden, typically from the Makefile.am */
var srcdir = process.env.SRCDIR || __dirname;
var pkgdir = srcdir + path.sep + "pkg";
var distdir = (process.env.BUILDDIR || __dirname) + path.sep + "dist";
var libdir = path.resolve(srcdir, "lib");

/* A standard nodejs and webpack pattern */
var production = process.env.NODE_ENV === 'production';

/*
 * Note that we're avoiding the use of path.join as webpack and nodejs
 * want relative paths that start with ./ explicitly.
 */

/* Qualify all the paths in entries */
Object.keys(info.entries).forEach(function(key) {
    info.entries[key] = info.entries[key].map(function(value) {
        if (value.indexOf("/") === -1)
            return value;
        else
            return pkgdir + path.sep + value;
    });
});

/* Qualify all the paths in files listed */
info.files = info.files.map(function(value) {
    return { from: pkgdir + path.sep + value, to: value };
});

var plugins = [
    new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }),
    new copy(info.files),
    new extract("[name].css")
    ];

/* Only minimize when in production mode */
if (production) {
    plugins.unshift(new webpack.optimize.UglifyJsPlugin({
        compress: {
            warnings: false
        },
    }));
}

module.exports = {
    resolve: {
        alias: {
            "angular": "angular/angular.js",
            "angular-route": "angular-route/angular-route.js",
            "d3": "d3/d3.js",
            "moment": "momentjs/moment.js",
            "mustache": "mustache/mustache.js",
            "react": "react-lite-cockpit/dist/react-lite.js",
            "term": "term.js-cockpit/src/term.js",
        },
        modulesDirectories: [ libdir ]
    },
    resolveLoader: {
        root: path.resolve(srcdir, 'node_modules')
    },
    entry: info.entries,
    output: {
        path: distdir,
        filename: "[name].js",
        sourceMapFilename: "[file].map",
    },
    externals: externals,
    plugins: plugins,

    devtool: "source-map",

    module: {
        preLoaders: [
            {
                test: /\.js$/, // include .js files
                exclude: /lib\/.*\/|\/node_modules\//, // exclude external dependencies
                loader: "jshint-loader"
            },
            {
                test: /\.es6$/, // include .js files
                loader: "jshint-loader?esversion=6"
            },
            {
                test: /\.jsx$/,
                exclude: /lib\/.*\/|\/node_modules\//, // exclude external dependencies
                loader: "jshint-jsx-loader"
            }
        ],
        loaders: [
            {
                test: /\.js$/,
                loader: 'strict' // Adds "use strict"
            },
            {
                test: /\.css$/,
                loader: extract.extract("style-loader", "css-loader?root=" + libdir)
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
                test: /\.less$/,
                loader: extract.extract('css?sourceMap!' + 'less?sourceMap')
            },
            {
                test: /views\/[^\/]+\.html$/,
                loader: "ng-cache?prefix=[dir]"
            },
            {
                test: /[\/]angular\.js$/,
                loader: "exports?angular"
            }
        ]
    },

    jshint: {
        emitErrors: false,
        failOnHint: true,
        sub: true,
        multistr: true,
        undef: true,
        predef: [ "window", "document", "console" ],
        reporter: function (errors) {
            var loader = this;
            errors.forEach(function(err) {
                console.log(loader.resource + ":" + err.line + ":" + err.character + ": " + err.reason);
            });
        }
    },
};
