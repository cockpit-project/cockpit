var webpack = require("webpack");
var copy = require("copy-webpack-plugin");
var extract = require("extract-text-webpack-plugin");

/* These can be overridden, typically from the Makefile.am */
var srcdir = process.env.SRCDIR || __dirname;
var builddir = process.env.BUILDDIR || __dirname + "/dist";

module.exports = {
    resolve: {
        modulesDirectories: [ srcdir + "lib" ]
    },
    entry: {
        sosreport: srcdir + "/sosreport/index.js",
    },
    output: {
        path: builddir,
        filename: "[name]/[name].min.js",
        sourceMapFilename: "[name]/[name].js.map",
    },
    externals: {
        "jquery": "$",
        "cockpit": "cockpit",
        "shell/po": "po",
    },
    plugins: [
        new webpack.optimize.UglifyJsPlugin({
            compress: {
                warnings: false
            },
            exclude: [
                "/\.css$/",
            ]
        }),
        new copy([
            { from: "sosreport/index.html", to: "sosreport/index.html" },
            { from: "sosreport/sosreport.png", to: "sosreport/sosreport.png" },
            { from: "sosreport/manifest.json", to: "sosreport/manifest.json" },
        ]),
        new extract("sosreport/sosreport.css")
    ],

    devtool: "source-map",

    module: {
        preLoaders: [
            {
                test: /\.js$/, // include .js files
                exclude: /node_modules/, // exclude any and all files in the node_modules folder
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
