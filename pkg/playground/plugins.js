var $ = require("jquery");
var cockpit = require("cockpit");

function load_plugins(pkg) {
    var loaders = [ ];

    function load(url) {
        return $.get(url, null, null, "text").then(
            function (data) {
                return eval(data); // jshint ignore:line
            });
    }

    return $.get("../manifests.json").
        then(function (manifests) {
            for (var p in manifests) {
                if (manifests[p].plugins && manifests[p].plugins[pkg]) {
                    var conf = manifests[p].plugins[pkg];
                    if (conf.path)
                        loaders.push(load("../" + p + "/" + conf.path));
                    else
                        loaders.push(conf);
                }
            }
            return cockpit.all(loaders).
                then(function () {
                    return Array.prototype.slice.call(arguments);
                });
        });
}

function Greeter() {
    var greeters = [ ];

    return {
        register: function (func) {
            greeters.push(func);
        },

        greet: function (name) {
            return $('<div>').append(
                greeters.map(function (g) {
                    return $('<div>').append(g(name));
                }));
        }
    };
}

$(function () {
    var greeter = Greeter();

    cockpit.translate();
    cockpit.transport.wait(function() {
        load_plugins("playground").
            done(function (plugins) {
                plugins.forEach(function (p) {
                    p.init(greeter);
                });
                $("#greets").html(greeter.greet("World"));
                $("body").show();
            });
    });
});
