(function () {
    if (typeof define === "function" && define.amd) {
        define("ostree/ember", ["jquery"], function($) {
            return Ember;
        });
    }
}());
