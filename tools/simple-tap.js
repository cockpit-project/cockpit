var test = { };
(function(test) {
    var timeout;
    var count = 0;

    window.onerror = function(error, file, line) {
        console.log("phantom-tap-error");
        window.clearTimeout(timeout);
        return false;
    }

    timeout = window.setTimeout(function() {
        console.log("test timed out, failed");
        console.log("phantom-tap-error");
    }, 5000);

    test.log = function log(message) {
        var output = document.getElementById("output");
        if (output)
            output.appendChild(document.createTextNode(message + "\n"));
        console.log(message);
    };

    test.assert = function assert(guard, message) {
        count += 1;
        if (guard)
            this.log("ok " + count + " - " + message);
        else
            this.log("not ok " + count + " - " + message);
    };

    test.done = function done(expect) {
        if (expect === undefined)
            expect = count;
        test.log("1.." + expect);
        window.clearTimeout(timeout);
        console.log("phantom-tap-done");
    };

    test.skip = function skip(message) {
        count += 1;
        this.log("ok " + count + " # skip - " + message);
    };

})(test);

var tests_included = true;
