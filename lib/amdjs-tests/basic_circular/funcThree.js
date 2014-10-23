define("funcThree", ["require", "funcFour"], function (require, four) {
    var three = function (arg) {
        return arg + "-" + require("funcFour").suffix();
    };

    three.suffix = function () {
        return "THREE_SUFFIX";
    };

    return three;
});
