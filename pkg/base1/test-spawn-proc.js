import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("simple process", async assert => {
    const resp = await cockpit.spawn(["/bin/sh", "-c", "echo hi"]);
    assert.equal(resp, "hi\n", "returned output");
});

QUnit.test("path", async assert => {
    const resp = await cockpit.spawn(["true"]);
    assert.equal(resp, "", "found executable");
});

QUnit.test("directory", async assert => {
    const resp = await cockpit.spawn(["pwd"], { directory: "/tmp" });
    assert.equal(resp, "/tmp\n", "was right");
});

QUnit.test("error log", async assert => {
    const resp = await cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"]);
    assert.equal(resp, "hi\n", "produced no output");
});

QUnit.test("error output", async assert => {
    const resp = await cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"], { err: "out" });
    assert.equal(resp, "hi\nyo\n", "showed up");
});

QUnit.test("error message", assert => {
    const done = assert.async();
    assert.expect(3);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"], { err: "message" })
            .done(function(resp, message) {
                assert.equal(resp, "hi\n", "produced output");
                assert.equal(message, "yo\n", "produced message");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("error message fail", assert => {
    const done = assert.async();
    assert.expect(3);
    cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2; exit 2"], { err: "message" })
            .fail(function(ex, resp) {
                assert.equal(resp, "hi\n", "produced output");
                assert.equal(ex.message, "yo", "produced message");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "didn't fail");
                done();
            });
});

QUnit.test("nonexisting executable", assert => {
    assert.rejects(cockpit.spawn(["/bin/nonexistent"]),
                   ex => ex.problem == "not-found");
});

QUnit.test("permission denied", assert => {
    assert.rejects(cockpit.spawn(["/etc/hostname"]),
                   ex => ex.problem == "access-denied");
});

QUnit.test("write eof read", async assert => {
    const proc = cockpit.spawn(["/usr/bin/sort"]);
    proc.input("2\n", true);
    proc.input("3\n1\n");
    assert.equal(await proc, "1\n2\n3\n", "output");
});

QUnit.test("stream", async assert => {
    let streamed = 0;
    let result = "";
    const resp = await cockpit.spawn(["/bin/cat"])
            .input("11\n", true)
            .input("22\n", true)
            .input("33\n")
            .stream(resp => {
                result += resp;
                streamed += 1;
            });
    assert.equal(resp, "", "no then data");
    assert.equal(result, "11\n22\n33\n", "stream data");
    assert.ok(streamed > 0, "stream handler called");
});

QUnit.test("stream packets", async assert => {
    let streamed = "";
    const resp = await cockpit.spawn(["/bin/cat"])
            .input("11\n", true)
            .input("22\n", true)
            .input("33\n")
            .stream(resp => { streamed += resp });

    assert.equal(resp, "", "no then data");
    assert.equal(streamed, "11\n22\n33\n", "stream data");
});

QUnit.test("stream replaced", async assert => {
    let first = false;
    let second = false;

    await cockpit.spawn(["/bin/cat"])
            .input("11\n", true)
            .input("22\n", true)
            .input("33\n")
            .stream(() => { first = true })
            .stream(() => { second = true });

    assert.ok(!first, "first stream handler not called");
    assert.ok(second, "second stream handler called");
});

QUnit.test("stream partial", async assert => {
    let streamed = "";
    const resp = await cockpit.spawn(["/bin/cat"])
            .input("1234")
            .stream(chunk => {
                if (chunk.length > 0) {
                    streamed += chunk[0];
                    return 1;
                }
            });
    assert.equal(resp, "234", "right then data");
    assert.equal(streamed, "1", "stream data");
});

QUnit.test("stream partial binary", async assert => {
    const streamed = [];
    const resp = await cockpit.spawn(["/bin/cat"], { binary: true })
            .input("1234")
            .stream(chunk => {
                if (chunk.length > 0) {
                    streamed.push(chunk[0]);
                    return 1;
                }
            });
    assert.equal(resp.length, 3, "right then data");
    assert.deepEqual(streamed, [49], "stream data");
});

QUnit.test("script with input", async assert => {
    const script = "#!/bin/sh\n\n# Test\n/usr/bin/sort\necho $2\necho $1";
    const proc = cockpit.script(script, ["5", "4"]);
    proc.input("2\n", true);
    proc.input("3\n1\n");
    assert.equal(await proc, "1\n2\n3\n4\n5\n", "output matched");
});

QUnit.test("script with options", async assert => {
    const script = "#!/bin/sh\n\n# Test\n/usr/bin/sort\necho $2\necho $1 >&2";
    const proc = cockpit.script(script, ["5", "4"], { err: "out" });
    proc.input("2\n", true);
    proc.input("3\n1\n");
    assert.equal(await proc, "1\n2\n3\n4\n5\n", "output matched");
});

QUnit.test("script without args", async assert => {
    const script = "#!/bin/sh\n\n# Test\n/usr/bin/sort >&2";
    const proc = cockpit.script(script, { err: "out" });
    proc.input("2\n", true);
    proc.input("3\n1\n");
    assert.equal(await proc, "1\n2\n3\n", "output matched");
});

QUnit.test("pty", async assert => {
    const proc = cockpit.spawn(['sh', '-c', "tty; test -t 0"], { pty: true });
    const output = await proc;
    assert.equal(output.indexOf('/dev/pts'), 0, 'TTY is a pty: ' + output);
});

QUnit.test("pty window size", async assert => {
    const proc = cockpit.spawn(['tput', 'lines', 'cols'], { pty: true, window: { rows: 77, cols: 88 } });
    assert.equal(await proc, '77\r\n88\r\n', 'Correct rows and columns');
});

QUnit.test("stream large output", async assert => {
    let lastblock = null;
    const resp = await cockpit.spawn(["seq", "10000000"])
            .stream(resp => {
                if (lastblock === null)
                    assert.equal(resp.slice(0, 4), "1\n2\n", "stream data starts with first numbers");
                lastblock = resp;
            });
    assert.equal(resp, "", "no then data");
    assert.equal(lastblock.slice(-18), "\n9999999\n10000000\n", "stream data has last numbers");
});

QUnit.test("cancel process", async assert => {
    const proc = cockpit.spawn(["sleep", "418"]);
    await cockpit.script("until pgrep -af [s]leep.*418; do sleep 0.1; done");
    proc.close("cancelled");
    await cockpit.script("timeout 5 sh -ec 'while pgrep -af [s]leep.*418; do sleep 0.1; done'");
    try {
        await proc;
        assert.ok(false, "proc should have failed");
    } catch (ex) {
        assert.equal(ex.problem, "cancelled", "proc failed with correct problem");
    }
});

QUnit.start();
