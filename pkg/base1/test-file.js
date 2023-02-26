import cockpit from "cockpit";
import QUnit from "qunit-tests";

let dir;

QUnit.test("simple read", async assert => {
    const file = cockpit.file(dir + "/foo");
    assert.equal(file.path, dir + "/foo", "file has path");
    assert.equal(await file.read(), "1234\n", "correct result");
});

QUnit.test("read non-existent", async assert => {
    assert.equal(await cockpit.file(dir + "/blah").read(), null, "correct result");
});

QUnit.test("parse read", async assert => {
    const resp = await cockpit.file(dir + "/foo.json", { syntax: JSON }).read();
    assert.deepEqual(resp, { foo: 12 }, "correct result");
});

QUnit.test("parse read error", async assert => {
    try {
        await cockpit.file(dir + "/foo.bin", { syntax: JSON }).read();
        assert.ok(false, "should have failed");
    } catch (error) {
        assert.ok(error instanceof SyntaxError, "got SyntaxError error");
    }
});

QUnit.test("binary read", async assert => {
    const resp = await cockpit.file(dir + "/foo.bin", { binary: true }).read();
    assert.deepEqual(resp, new Uint8Array([0, 1, 2, 3]), "correct result");
});

QUnit.test("read non-regular", async assert => {
    try {
        await cockpit.file(dir, { binary: true }).read();
        assert.ok(false, "should have failed");
    } catch (error) {
        assert.equal(error.problem, "internal-error", "got error");
    }
});

QUnit.test("read large", async assert => {
    const resp = await cockpit.file(dir + "/large.bin", { binary: true }).read();
    assert.equal(resp.length, 512 * 1024, "correct result");
});

QUnit.test("read too large", async assert => {
    try {
        await cockpit.file(dir + "/large.bin", { binary: true, max_read_size: 8 * 1024 }).read();
        assert.ok(false, "should have failed");
    } catch (error) {
        assert.equal(error.problem, "too-large", "got error");
    }
});

/* regression: passing 'binary: false' made cockpit-ws close the whole connection */
QUnit.test("binary false", async assert => {
    await cockpit.file(dir + "/foo.bin", { binary: false }).read();
    assert.ok(true, "did not crash");
});

QUnit.test("simple replace", async assert => {
    await cockpit.file(dir + "/bar").replace("4321\n");
    const res = await cockpit.spawn(["cat", dir + "/bar"]);
    assert.equal(res, "4321\n", "correct content");
});

QUnit.test("stringify replace", async assert => {
    await cockpit.file(dir + "/bar", { syntax: JSON }).replace({ foo: 4321 });
    const res = await cockpit.spawn(["cat", dir + "/bar"]);
    assert.deepEqual(JSON.parse(res), { foo: 4321 }, "correct content");
});

QUnit.test("stringify replace error", async assert => {
    const cycle = { };
    cycle.me = cycle;
    try {
        await cockpit.file(dir + "/bar", { syntax: JSON }).replace(cycle);
        assert.ok(false, "should have failed");
    } catch (error) {
        assert.ok(error instanceof TypeError, "got stringify error");
    }
});

QUnit.test("binary replace", async assert => {
    await cockpit.file(dir + "/bar", { binary: true }).replace(new Uint8Array([3, 2, 1, 0]));
    const res = await cockpit.spawn(["cat", dir + "/bar"], { binary: true });
    assert.deepEqual(res, new Uint8Array([3, 2, 1, 0]), "correct content");
});

QUnit.test("replace large", async assert => {
    const str = new Array(23 * 1023).join('abcdef12345');
    await cockpit.file(dir + "/large").replace(str);
    const res = await cockpit.spawn(["cat", dir + "/large"]);
    assert.equal(res.length, str.length, "correct large length");
    assert.ok(res == str, "correct large data");
});

QUnit.test("binary replace large", async assert => {
    const data = new Uint8Array(249 * 1023);
    const len = data.byteLength;
    for (let i = 0; i < len; i++)
        data[i] = i % 233;
    await cockpit.file(dir + "/large-binary", { binary: true }).replace(data);
    const res = await cockpit.spawn(["cat", dir + "/large-binary"], { binary: true });
    let eq = true;
    assert.equal(res.byteLength, 249 * 1023, "check length");
    assert.equal(res.byteLength, data.byteLength, "correct large length");
    for (let i = 0; i < res.byteLength; i++) {
        if (res[i] !== data[i] || res[i] === undefined) {
            eq = false;
            break;
        }
    }
    assert.ok(eq, "got back same data");
});

QUnit.test("remove", async assert => {
    const exists = await cockpit.spawn(["bash", "-c", "test -f " + dir + "/bar && echo exists"]);
    assert.equal(exists, "exists\n", "exists");
    await cockpit.file(dir + "/bar").replace(null);
    const res = await cockpit.spawn(["bash", "-c", "test -f " + dir + "/bar || echo gone"]);
    assert.equal(res, "gone\n", "gone");
});

QUnit.test("abort replace", assert => {
    const done = assert.async();
    assert.expect(2);

    const file = cockpit.file(dir + "/bar");

    let n = 0;
    function start_after_two() {
        n += 1;
        if (n == 2)
            done();
    }

    file.replace("1234\n")
            .always(function () {
                assert.equal(this.state(), "rejected", "failed as expected");
                start_after_two();
            });

    file.replace("abcd\n")
            .always(function () {
                assert.equal(this.state(), "resolved", "didn't fail");
                start_after_two();
            });
});

QUnit.test("replace with tag", async assert => {
    const done = assert.async();
    const file = cockpit.file(dir + "/barfoo");

    file.read()
            .then(async (content, tag_1) => {
                assert.equal(content, null, "file does not exist");
                assert.equal(tag_1, "-", "first tag is -");
                const tag_2 = await file.replace("klmn\n", tag_1);
                assert.notEqual(tag_2, "-", "second tag is not -");
                const tag_3 = await file.replace("KLMN\n", tag_2);
                assert.notEqual(tag_3, tag_2, "third tag is different");
                try {
                    await file.replace("opqr\n", tag_2);
                    assert.ok(false, "should have failed");
                } catch (error) {
                    assert.equal(error.problem, "change-conflict", "wrong tag is rejected");
                    done();
                }
            });
});

QUnit.test("modify", async assert => {
    const file = cockpit.file(dir + "/quux");

    let n = 0;
    await file.modify(old => {
        n += 1;
        assert.equal(old, null, "no old content");
        return "ABCD\n";
    });
    assert.equal(n, 1, "callback called once");

    n = 0;
    await file.modify(old => {
        n += 1;
        assert.equal(old, "ABCD\n", "correct old content");
        return "dcba\n";
    });
    assert.equal(n, 1, "callback called once");

    assert.equal(await cockpit.spawn(["cat", dir + "/quux"]), "dcba\n", "correct content");
});

QUnit.test("modify with conflict", async assert => {
    const done = assert.async();
    assert.expect(6);

    const file = cockpit.file(dir + "/baz");

    let n = 0;
    file
            .modify(old => {
                n += 1;
                assert.equal(old, null, "no old content");
                return "ABCD\n";
            })
            .finally(() => assert.equal(n, 1, "callback called once"))

            .then(async (content, tag) => {
                let n = 0;
                await cockpit.spawn(["bash", "-c", "sleep 1; echo XYZ > " + dir + "/baz"]);
                await file.modify(old => {
                    n += 1;
                    if (n == 1)
                        assert.equal(old, "ABCD\n", "correct old (out-of-date) content");
                    else
                        assert.equal(old, "XYZ\n", "correct old (current) content");
                    return old.toLowerCase();
                }, content, tag);

                assert.equal(n, 2, "callback called twice");
                const res = await cockpit.spawn(["cat", dir + "/baz"]);
                assert.equal(res, "xyz\n", "correct content");
                done();
            });
});

QUnit.test("watching", assert => {
    const done = assert.async();
    assert.expect(7);

    const file = cockpit.file(dir + "/foobar");
    let n = 0;
    const watch = file.watch((content, tag) => {
        n += 1;
        if (n == 1) {
            assert.equal(content, null, "initially non-existent");
            assert.equal(tag, "-", "empty tag");
            cockpit.spawn(["bash", "-c", "cd " + dir + " && echo 1234 > foobar.tmp && mv foobar.tmp foobar"]);
        } else if (n == 2) {
            assert.equal(content, "1234\n", "correct new content");
            assert.notEqual(tag, "-");
            assert.ok(tag.length > 5, "tag has a reasonable size");
            cockpit.spawn(["bash", "-c", "rm " + dir + "/foobar"]);
        } else if (n == 3) {
            assert.equal(content, null, "finally non-existent");
            assert.equal(tag, "-", "empty tag");
            watch.remove();
            done();
        }
    });
});

QUnit.test("binary watching", assert => {
    const done = assert.async();
    assert.expect(3);

    const file = cockpit.file(dir + "/foobar", { binary: true });
    let n = 0;
    const watch = file.watch((content, tag) => {
        n += 1;
        if (n == 1) {
            assert.equal(content, null, "initially non-existent");
            cockpit.spawn(["bash", "-c", "cd " + dir + " && echo '//8BAg==' | base64 -d > foobar.tmp && mv foobar.tmp foobar"]);
        } else if (n == 2) {
            assert.deepEqual(content, new Uint8Array([255, 255, 1, 2]), "correct new content");
            cockpit.spawn(["bash", "-c", "rm " + dir + "/foobar"]);
        } else if (n == 3) {
            assert.equal(content, null, "finally non-existent");
            watch.remove();
            done();
        }
    });
});

QUnit.test("syntax watching", assert => {
    const done = assert.async();
    assert.expect(3);

    const file = cockpit.file(dir + "/foobar.json", { syntax: JSON });
    let n = 0;
    const watch = file.watch((content, tag, err) => {
        n += 1;
        if (n == 1) {
            assert.equal(content, null, "initially non-existent");
            cockpit.spawn(["bash", "-c", "cd " + dir + " && echo '[ 1, 2, 3, 4 ]' > foobar.json.tmp && mv foobar.json.tmp foobar.json"]);
        } else if (n == 2) {
            assert.deepEqual(content, [1, 2, 3, 4], "correct new content");
            cockpit.spawn(["bash", "-c", "echo 'hi-there-this-is-not-json'  > " + dir + "/foobar.json"]);
        } else if (n == 3) {
            assert.ok(err instanceof SyntaxError, "got SyntaxError error");
            watch.remove();
            done();
        } else
            assert.ok(false, "not reached");
    });
});

QUnit.test("watching without reading", assert => {
    const done = assert.async();
    assert.expect(7);

    const file = cockpit.file(dir + "/foobar");
    let n = 0;
    const watch = file.watch((content, tag) => {
        n += 1;
        if (n == 1) {
            assert.equal(content, null, "initially non-existent");
            assert.equal(tag, "-", "empty tag");
            cockpit.spawn(["bash", "-c", "cd " + dir + " && echo 1234 > foobar.tmp && mv foobar.tmp foobar"]);
        } else if (n == 2) {
            assert.equal(content, null, "no content as reading is disabled");
            assert.notEqual(tag, "-");
            assert.ok(tag.length > 5, "tag has a reasonable size");
            cockpit.spawn(["bash", "-c", "rm " + dir + "/foobar"]);
        } else if (n == 3) {
            assert.equal(content, null, "finally non-existent");
            assert.equal(tag, "-", "empty tag");
            watch.remove();
            done();
        }
    }, { read: false });
});

QUnit.test("watching directory", assert => {
    const done = assert.async();
    assert.expect(20);

    let n = 0;
    const watch = cockpit.channel({ payload: "fswatch1", path: dir });
    watch.addEventListener("message", (event, payload) => {
        const msg = JSON.parse(payload);
        n += 1;

        if (n == 1) {
            assert.equal(msg.event, "created", "world.txt created");
            assert.equal(msg.path, dir + "/world.txt");
            assert.equal(msg.type, "file");
            assert.notEqual(msg.tag, "-");
        } else if (n == 2) {
            assert.equal(msg.event, "changed", "world.txt changed");
            assert.equal(msg.path, dir + "/world.txt");
            assert.notEqual(msg.tag, "-");
        } else if (n == 3) {
            assert.equal(msg.event, "done-hint", "world.txt done-hint");
            assert.equal(msg.path, dir + "/world.txt");
            assert.notEqual(msg.tag, "-");

            cockpit.spawn(["chmod", "001", `${dir}/world.txt`]);
        } else if (n == 4) {
            assert.equal(msg.event, "attribute-changed", "world.txt attribute-changed");
            assert.equal(msg.path, dir + "/world.txt");
            assert.notEqual(msg.tag, "-");

            cockpit.spawn(["rm", `${dir}/world.txt`]);
        } else if (n == 5) {
            assert.equal(msg.event, "deleted", "world.txt deleted");
            assert.equal(msg.path, dir + "/world.txt");
            assert.equal(msg.tag, "-");

            cockpit.spawn(["mkdir", `${dir}/somedir`]);
        } else if (n == 6) {
            assert.equal(msg.event, "created", "somedir created");
            assert.equal(msg.path, dir + "/somedir");
            assert.equal(msg.type, "directory");
            assert.notEqual(msg.tag, "-");

            watch.close();
            done();
        }
    });

    // trigger the first event
    cockpit.spawn(["sh", "-c", `echo hello > ${dir}/world.txt`]);
});

QUnit.test("closing", assert => {
    const done = assert.async();
    assert.expect(2);

    const file = cockpit.file(dir + "/foobarbaz");
    const watch = file.watch(changed);

    let n = 0;
    function start_after_two() {
        n += 1;
        if (n == 2) {
            watch.remove();
            done();
        }
    }

    file.read()
            .then((content, tag) => {
                assert.ok(false, "read didn't complete");
            })
            .catch(error => {
                assert.equal(error.problem, "cancelled", "read got cancelled");
                start_after_two();
            });

    function changed(content, tag, err) {
        if (err) {
            assert.equal(err.problem, "cancelled", "watch got cancelled");
            start_after_two();
        } else {
            assert.ok(false, "not reached");
        }
    }

    file.close();
});

QUnit.test("channel options", async assert => {
    const data = await cockpit.file(dir + "/foo", { binary: true }).read();
    assert.ok(data instanceof Uint8Array, "options applied, got binary data");
});

QUnit.test("remove testdir", async assert => {
    await cockpit.spawn(["rm", "-rf", dir]);
    assert.ok(true, "did not crash");
});

(async () => {
    const resp = await cockpit.spawn(["bash", "-c", "d=$(mktemp -d); echo '1234' >$d/foo; echo '{ \"foo\": 12 }' >$d/foo.json; echo -en '\\x00\\x01\\x02\\x03' >$d/foo.bin; dd if=/dev/zero of=$d/large.bin bs=1k count=512; echo $d"]);
    dir = resp.replace(/\n$/, "");
    QUnit.start();
})();
