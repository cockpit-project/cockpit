define("two", ["require", "one"], function(require, one) {
    return {
        size: "small",
        color: "redtwo",
        doSomething: function() {
            return one.doSomething();
        },
        getOneModule: function() {
            return one.module;
        }
    };
});
