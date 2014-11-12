module.exports = {
    reporter: function (errors) {
        var err;
        for (var i = 0; i < errors.length; i++) {
            err = errors[i].error;
            console.log(errors[i].file + ":" + err.line + ":" + err.character + ": " + err.reason);
        }
    }
};
