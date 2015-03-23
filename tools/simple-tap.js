var test = { };
(function(test) {
    var timeout;
    var count = 0;
    var is_partial = false;

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

    test.equal = function equal(a, b, message) {
        count += 1;
        if (a === b)
            this.log("ok " + count + " - " + message);
        else
            this.log("not ok " + count + " - " + a + " is not equal to " + b + " - " + message);
    };

    test.done = function done(expect) {
        if (!is_partial) {
            if (expect === undefined)
                expect = count;

            test.log("1.." + expect);
            console.log("phantom-tap-done");
        }

        window.clearTimeout(timeout);
    };

    test.skip = function skip(message) {
        count += 1;
        this.log("ok " + count + " # skip - " + message);
    };

    test.start_from = function start_from (num) {
        if (num)
          count = num;

        is_partial = true;
    };

})(test);

var tests_included = true;
