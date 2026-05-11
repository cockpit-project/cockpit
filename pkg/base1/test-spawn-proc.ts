// SPDX-License-Identifier: LGPL-2.1-or-later
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

QUnit.test("error message", async assert => {
    const proc = cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2"], { err: "message" });
    proc.done(function(resp, message) {
        assert.equal(resp, "hi\n", "produced output");
        assert.equal(message, "yo\n", "produced message");
    });
    await proc;
    assert.equal(proc.state(), "resolved", "didn't fail");
});

QUnit.test("error message fail", async assert => {
    const proc = cockpit.spawn(["/bin/sh", "-c", "echo hi; echo yo >&2; exit 2"], { err: "message" });
    proc.fail(function(ex, resp) {
        assert.equal(resp, "hi\n", "produced output");
        assert.equal(ex.message, "yo", "produced message");
    });
    await assert.rejects(proc);
    assert.equal(proc.state(), "rejected", "did fail");
});

QUnit.test("nonexisting executable", assert => {
    assert.rejects(cockpit.spawn(["/bin/nonexistent"]),
                   (ex: cockpit.BasicError) => ex.problem == "not-found");
});

QUnit.test("permission denied", assert => {
    assert.rejects(cockpit.spawn(["/etc/hostname"]),
                   (ex: cockpit.BasicError) => ex.problem == "access-denied");
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
    const streamed: number[] = [];
    const resp = await cockpit.spawn(["/bin/cat"], { binary: true })
            .input(new Uint8Array([0, 1, 2, 3]))
            .stream(chunk => {
                if (chunk.length > 0) {
                    streamed.push(chunk[0]);
                    return 1;
                }
            });
    assert.deepEqual(resp, new Uint8Array([1, 2, 3]), "unconsumed data");
    assert.deepEqual(streamed, [0], "stream got first byte");
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
    const proc = cockpit.spawn(['tput', 'lines', 'cols'], {
        pty: true,
        environ: ["TERM=vt100"],
        window: { rows: 77, cols: 88 }
    });
    assert.equal(await proc, '77\r\n88\r\n', 'Correct rows and columns');
});

QUnit.test("pty window size limits", async assert => {
    let proc = cockpit.spawn(['stty', 'size'], {
        pty: true,
        environ: ["TERM=vt100"],
        window: { rows: -1, cols: 65538 }
    });
    assert.equal(await proc, '0 65535\r\n', 'Clamps to 0x65535');

    proc = cockpit.spawn(['stty', 'size'], {
        pty: true,
        environ: ["TERM=vt100"],
        // HACK: tput fallback to 80 if cols are 0
        window: { rows: 65538, cols: 0 }
    });
    assert.equal(await proc, '65535 0\r\n', 'Clamps to 65538x0');
});

QUnit.test("stream large output", async assert => {
    let lastblock = "";
    const resp = await cockpit.spawn(["seq", "10000000"])
            .stream(resp => {
                if (lastblock === "")
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
        assert.equal((ex as cockpit.BasicError).problem, "cancelled", "proc failed with correct problem");
    }
});

// -- exec type enforcement --
// These lines are checked by tsc but never executed.
// If any @ts-expect-error stops being an error, static-code fails.
export function test_exec_type_enforcement() {
    const dynamic = crypto.randomUUID();

    // A bare dynamic string in opts is rejected
    // @ts-expect-error: dynamic variable where literal is required
    cockpit.exec("cmd", [dynamic]);

    // Dynamic string as first element of a tuple is rejected
    // @ts-expect-error: dynamic flag name in tuple
    cockpit.exec("cmd", [[dynamic, "value"]]);

    // Dynamic string as first element of a triple is rejected
    // @ts-expect-error: dynamic flag name in triple
    cockpit.exec("cmd", [[dynamic, "a", "b"]]);

    // Template literals with a known first char are accepted
    cockpit.exec("cmd", [`-d${dynamic}`]);
    cockpit.exec("cmd", [`--date=${dynamic}`]);

    // Literals with known first char are accepted (subcommands)
    cockpit.exec("git", ["commit"]);
    cockpit.exec("git", ["commit", ["-m", dynamic]]);

    // Template literal with dynamic first char is rejected
    // @ts-expect-error: first char is not statically known
    cockpit.exec("cmd", [`${dynamic}`]);

    // Tuple second element can be dynamic — only the flag name is checked
    cockpit.exec("cmd", [["-f", dynamic]]);

    // Triples: flag with two dynamic arguments
    cockpit.exec("bwrap", [["--bind", dynamic, dynamic]]);
    cockpit.exec("bwrap", [["--ro-bind", "/usr", "/usr"], ["--bind", dynamic, dynamic]]);

    // @ts-expect-error: triple with dynamic flag name
    cockpit.exec("bwrap", [[dynamic, "/src", "/dest"]]);

    // @ts-expect-error: triple with template-only flag name
    cockpit.exec("bwrap", [[`${dynamic}`, "/src", "/dest"]]);

    // Tuple with dynamic first element is rejected
    // @ts-expect-error: tuple flag name not statically known
    cockpit.exec("cmd", [[`${dynamic}`, "value"]]);

    // Subcommands can't head tuples — only flags can
    // @ts-expect-error: subcommand as tuple flag name
    cockpit.exec("git", [["commit", dynamic]]);

    // Bare "--" and "-" are rejected
    // @ts-expect-error: "--" is not a valid option
    cockpit.exec("cmd", ["--"]);
    // @ts-expect-error: "-" is not a valid option
    cockpit.exec("cmd", ["-"]);
    // @ts-expect-error: "--" as tuple flag name
    cockpit.exec("cmd", [["--", dynamic]]);

    // test(1) binary file operators — dynamic values on both sides
    cockpit.exec("test", [[dynamic, "-ot", dynamic]]);
    cockpit.exec("test", [[dynamic, "-nt", dynamic]]);
    cockpit.exec("test", [[dynamic, "-ef", dynamic]]);

    // @ts-expect-error: integer comparison belongs in JS, not a subprocess
    cockpit.exec("test", [[dynamic, "-gt", dynamic]]);

    // Mixed opts: subcommands, flags, tuples, triples together
    cockpit.exec("ip", ["link", "set", ["--name", dynamic]]);
    cockpit.exec("usermod", [["--shell", dynamic], "--lock"], [dynamic]);

    // is_not_flag narrows a dynamic string to NotFlag
    const rev: string = dynamic;
    // @ts-expect-error: dynamic string not accepted in opts
    cockpit.exec("git", ["log", rev]);

    // after narrowing with is_not_flag, it's accepted
    cockpit.assert(cockpit.is_not_flag(rev));
    cockpit.exec("git", ["log", rev], ["file1", "file2"]);
}

QUnit.start();
