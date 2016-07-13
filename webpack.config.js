/* --------------------------------------------------------------------
 * Fill in module info here.
 */

var entries = {
    "sosreport/sosreport": [
        "sosreport/index.js",
        "sosreport/sosreport.css",
    ],
    "users/users": [
        "users/local.js",
        "users/users.css",
    ]
};

var files = [
    "sosreport/index.html",
    "sosreport/sosreport.png",
    "sosreport/manifest.json",

    "users/index.html",
    "users/manifest.json",
];

var externals = {
    "jquery": "$",
    "cockpit": "cockpit",
};

/* ---------------------------------------------------------------------
 * Implementation
 */

var webpack = require("webpack");
var copy = require("copy-webpack-plugin");
var extract = require("extract-text-webpack-plugin");
var path = require("path");

/* For node 0.10.x we need this defined */
if (typeof(global.Promise) == "undefined")
    global.Promise = require('promise');

/* These can be overridden, typically from the Makefile.am */
var srcdir = process.env.SRCDIR || __dirname;
var pkgdir = srcdir + path.sep + "pkg";
var distdir = (process.env.BUILDDIR || __dirname) + path.sep + "dist";

/* A standard nodejs and webpack pattern */
var production = process.env.NODE_ENV === 'production';

/*
 * Note that we're avoiding the use of path.join as webpack and nodejs
 * want relative paths that start with ./ explicitly.
 */

/* Qualify all the paths in entries */
Object.keys(entries).forEach(function(key) {
    entries[key] = entries[key].map(function(value) {
        return pkgdir + path.sep + value;
    });
});

/* Qualify all the paths in files listed */
files = files.map(function(value) {
    return { from: pkgdir + path.sep + value, to: value };
});

var plugins = [
    new copy(files),
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
            "mustache": "mustache/mustache.js",
        },
        modulesDirectories: [ srcdir + path.sep + "lib" ]
    },
    resolveLoader: {
        root: path.resolve(srcdir, 'node_modules')
    },
    entry: entries,
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
            }
        ],
        loaders: [
            {
                test: /\.css$/,
                loader: extract.extract("style-loader", "css-loader")
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
    }
};
