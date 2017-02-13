function greet(name) {
    return "Hello, " + name + "!";
}

module.exports = {
    init: function (greeter) {
        greeter.register(greet);
    }
};
