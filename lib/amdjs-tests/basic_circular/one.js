define("one", ["require", "exports", "module", "two"], function(require, exports, module) {
    exports.size = "large";
    exports.module = module;
    exports.doSomething = function() {
        return require("two");
    };
});
