/*
 * This is a webpack loader that concatenates files
 * before the loaded javascript. Multiple files can
 * be specified.
 *
 * require("cat?./file1.js&./file2.js|module");
 */

var fs = require("fs");
var path = require("path");

module.exports = function(source) {
    var loader = this;

    loader.cacheable();

    var callback = loader.async();

    var files = loader.query.substring(1).split("&");
    var content = [ source ];

    function step() {
        if (files.length == 0) {
            callback(null, content.join("\n"));
            return;
        }

        var filename = require.resolve(files.pop());
        loader.addDependency(filename);

        fs.readFile(filename, "utf-8", function(err, data) {
            if (err)
                return callback(err);
            content.unshift(data);
            step();
        });
    }

    step();
};
