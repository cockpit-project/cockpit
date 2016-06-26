
var webpack = require('webpack');
var path = require('path');
var CopyPlugin = require('copy-webpack-plugin');

// for node 0.10.x (fedora 23)
require('es6-promise').polyfill();

module.exports = {
    entry: './local',
    output: {
        filename: 'users.min.js',
    },
    resolve: {
        root: path.resolve(__dirname, '../../lib')
    },
    module: {
        preLoaders: [
            { test: /\.js$/, loader: 'jshint-loader' }
        ],
        loaders: [
            { test: /\.css$/, loader: 'style!css' }
        ]
    },
    externals: {
        'jquery': '$',
        'base1/cockpit': 'cockpit'
    },
    plugins: [
        new CopyPlugin([
            { from: 'manifest.json' },
            { from: 'index.html' }
        ]),
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
        new webpack.optimize.UglifyJsPlugin()
    ]
}
