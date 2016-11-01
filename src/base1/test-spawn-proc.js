/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

QUnit.asyncTest("simple process", function() {
    assert.expect(2);
    cockpit.spawn(["/bin/sh", "-c", "echo hi"]).
        done(function(resp) {
            assert.equal(resp, "hi\n", "returned output");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("path", function() {
    assert.expect(1);
    cockpit.spawn(["true"]).
        always(function() {
            assert.equal(this.state(), "resolved", "found executable");
            QUnit.start();
        });
});

QUnit.asyncTest("directory", function() {
    assert.expect(2);
    cockpit.spawn(["pwd"], { directory: "/tmp" }).
        done(function(resp) {
            assert.equal(resp, "/tmp\n", "was right");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("error log", function() {
    assert.expect(2);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"]).
        done(function(resp) {
            assert.equal(resp, "hi\n", "produced no output");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("error output", function() {
    assert.expect(2);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"], { err: "out" }).
        done(function(resp) {
            assert.equal(resp, "hi\nyo\n", "showed up");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("error message", function() {
    assert.expect(3);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"], { err: "message" }).
        done(function(resp, message) {
            assert.equal(resp, "hi\n", "produced output");
            assert.equal(message, "yo\n", "produced message");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("error message fail", function() {
    assert.expect(3);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2; exit 2"], { err: "message" }).
        fail(function(ex, resp) {
            assert.equal(resp, "hi\n", "produced output");
            assert.equal(ex.message, "yo", "produced message");
        }).
        always(function() {
            assert.equal(this.state(), "rejected", "didn't fail");
            QUnit.start();
        });
});

QUnit.asyncTest("write eof read", function() {
    assert.expect(2);

    var proc = cockpit.spawn(["/usr/bin/sort"]);

    proc.done(function(resp) {
        assert.equal(resp, "1\n2\n3\n", "output");
    });

    proc.always(function() {
        assert.equal(this.state(), "resolved", "didn't fail");
        QUnit.start();
    });

    proc.input("2\n", true);
    proc.input("3\n1\n");
});

QUnit.asyncTest("stream", function() {
    assert.expect(4);

    var streamed = 0;
    var result = "";
    var proc = cockpit.spawn(["/bin/cat"]).
        stream(function(resp) {
            result += resp;
            streamed += 1;
        }).
        done(function(resp) {
            assert.equal(resp, "", "no done data");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            assert.equal(result, "11\n22\n33\n", "stream data");
            assert.ok(streamed > 0, "stream handler called");
            QUnit.start();
        });

    proc.input("11\n", true);
    proc.input("22\n", true);
    proc.input("33\n");
});

QUnit.asyncTest("stream", function() {
    assert.expect(3);

    var streamed = "";
    var proc = cockpit.spawn(["/bin/cat"]).
        stream(function(resp) {
            streamed += resp;
        }).
        done(function(resp) {
            assert.equal(resp, "", "no done data");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            assert.equal(streamed, "11\n22\n33\n", "stream data");
            QUnit.start();
        });

    proc.input("11\n", true);
    proc.input("22\n", true);
    proc.input("33\n");
});

QUnit.asyncTest("stream replaced", function() {
    assert.expect(3);

    var first = false;
    var second = false;

    var proc = cockpit.spawn(["/bin/cat"]).
        stream(function(resp) {
            first = true;
        }).
        stream(function(resp) {
            second = true;
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            assert.ok(!first, "first stream handler not called");
            assert.ok(second, "second stream handler called");
            QUnit.start();
        });

    proc.input("11\n", true);
    proc.input("22\n", true);
    proc.input("33\n");
});

QUnit.asyncTest("stream partial", function() {
    assert.expect(3);

    var streamed = "";
    var proc = cockpit.spawn(["/bin/cat"]).
        stream(function(resp) {
            if (resp.length > 0) {
                streamed += resp[0];
                return 1;
            }
        }).
        done(function(resp) {
            assert.equal(resp, "234", "right done data");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            assert.equal(streamed, "1", "stream data");
            QUnit.start();
        });

    proc.input("1234");
});

QUnit.asyncTest("stream partial binary", function() {
    assert.expect(3);

    var streamed = [];
    var proc = cockpit.spawn(["/bin/cat"], { binary: true }).
        stream(function(resp) {
            if (resp.length > 0) {
                streamed.push(resp[0]);
                return 1;
            }
        }).
        done(function(resp) {
            assert.equal(resp.length, 3, "right done data");
        }).
        always(function() {
            assert.equal(this.state(), "resolved", "didn't fail");
            assert.deepEqual(streamed, [49], "stream data");
            QUnit.start();
        });

    proc.input("1234");
});

QUnit.asyncTest("script with input", function() {
    assert.expect(2);

    var script = "#!/bin/sh\n\n# Test\n/usr/bin/sort\necho $2\necho $1";

    var proc = cockpit.script(script, [ "5", "4" ]);

    proc.done(function(resp) {
        assert.equal(resp, "1\n2\n3\n4\n5\n", "output matched");
    });

    proc.always(function() {
        assert.equal(this.state(), "resolved", "didn't fail");
        QUnit.start();
    });

    proc.input("2\n", true);
    proc.input("3\n1\n");
});

QUnit.asyncTest("script with options", function() {
    assert.expect(2);

    var script = "#!/bin/sh\n\n# Test\n/usr/bin/sort\necho $2\necho $1 >&2";

    var proc = cockpit.script(script, [ "5", "4" ], { err: "out" });

    proc.done(function(resp) {
        assert.equal(resp, "1\n2\n3\n4\n5\n", "output matched");
    });

    proc.always(function() {
        assert.equal(this.state(), "resolved", "didn't fail");
        QUnit.start();
    });

    proc.input("2\n", true);
    proc.input("3\n1\n");
});

QUnit.asyncTest("script without args", function() {
    assert.expect(2);

    var script = "#!/bin/sh\n\n# Test\n/usr/bin/sort >&2";

    var proc = cockpit.script(script, { err: "out" });

    proc.done(function(resp) {
        assert.equal(resp, "1\n2\n3\n", "output matched");
    });

    proc.always(function() {
        assert.equal(this.state(), "resolved", "didn't fail");
        QUnit.start();
    });

    proc.input("2\n", true);
    proc.input("3\n1\n");
});

QUnit.start();
