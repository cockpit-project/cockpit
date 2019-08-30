/* global cockpit, QUnit, Uint8Array */

var dir;

QUnit.test("simple read", function (assert) {
    const done = assert.async();
    assert.expect(3);
    var file = cockpit.file(dir + "/foo");
    assert.equal(file.path, dir + "/foo", "file has path");
    file.read()
            .done(function(resp) {
                assert.equal(resp, "1234\n", "correct result");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("read non-existent", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/blah").read()
            .done(function(resp) {
                assert.equal(resp, null, "correct result");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("parse read", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/foo.json", { syntax: JSON }).read()
            .done(function(resp) {
                assert.deepEqual(resp, { foo: 12 }, "correct result");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("parse read error", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/foo.bin", { syntax: JSON }).read()
            .fail(function(error) {
                assert.ok(error instanceof SyntaxError, "got SyntaxError error");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "failed");
                done();
            });
});

QUnit.test("binary read", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/foo.bin", { binary: true }).read()
            .done(function(resp) {
                assert.deepEqual(resp, new Uint8Array([0, 1, 2, 3]), "correct result");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("read non-regular", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir, { binary: true }).read()
            .fail(function(error) {
                assert.equal(error.problem, "internal-error", "got error");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "failed");
                done();
            });
});

QUnit.test("read large", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/large.bin", { binary: true }).read()
            .done(function(resp) {
                assert.equal(resp.length, 512 * 1024, "correct result");
            })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("read too large", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/large.bin", { binary: true, max_read_size: 8 * 1024 }).read()
            .fail(function(error) {
                assert.equal(error.problem, "too-large", "got error");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "failed");
                done();
            });
});

/* regression: passing 'binary: false' made cockpit-ws close the whole connection */
QUnit.test("binary false", function (assert) {
    const done = assert.async();
    assert.expect(1);
    cockpit.file(dir + "/foo.bin", { binary: false }).read()
            .done(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

QUnit.test("simple replace", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/bar").replace("4321\n")
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                cockpit.spawn(["cat", dir + "/bar"])
                        .done(function (res) {
                            assert.equal(res, "4321\n", "correct content");
                            done();
                        });
            });
});

QUnit.test("stringify replace", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/bar", { syntax: JSON }).replace({ foo: 4321 })
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                cockpit.spawn(["cat", dir + "/bar"])
                        .done(function (res) {
                            assert.deepEqual(JSON.parse(res), { foo: 4321 }, "correct content");
                            done();
                        });
            });
});

QUnit.test("stringify replace error", function (assert) {
    const done = assert.async();
    assert.expect(2);
    var cycle = { };
    cycle.me = cycle;
    cockpit.file(dir + "/bar", { syntax: JSON }).replace(cycle)
            .fail(function(error) {
                assert.ok(error instanceof TypeError, "got stringify error");
            })
            .always(function() {
                assert.equal(this.state(), "rejected", "failed");
                done();
            });
});

QUnit.test("binary replace", function (assert) {
    const done = assert.async();
    assert.expect(2);
    cockpit.file(dir + "/bar", { binary: true }).replace(new Uint8Array([3, 2, 1, 0]))
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                cockpit.spawn(["cat", dir + "/bar"], { binary: true })
                        .done(function (res) {
                            assert.deepEqual(res, new Uint8Array([3, 2, 1, 0]), "correct content");
                            done();
                        });
            });
});

QUnit.test("replace large", function (assert) {
    const done = assert.async();
    assert.expect(3);
    var str = new Array(23 * 1023).join('abcdef12345');
    cockpit.file(dir + "/large").replace(str)
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                cockpit.spawn(["cat", dir + "/large"])
                        .done(function(res) {
                            assert.equal(res.length, str.length, "correct large length");
                            assert.ok(res == str, "correct large data");
                            done();
                        });
            });
});

QUnit.test("binary replace large", function (assert) {
    const done = assert.async();
    assert.expect(4);
    var data = new Uint8Array(249 * 1023);
    var i;
    var len = data.byteLength;
    for (i = 0; i < len; i++)
        data[i] = i % 233;
    cockpit.file(dir + "/large-binary", { binary: true }).replace(data)
            .always(function() {
                assert.equal(this.state(), "resolved", "didn't fail");
                cockpit.spawn(["cat", dir + "/large-binary"], { binary: true })
                        .done(function (res) {
                            var i;
                            var len = res.byteLength;
                            var eq = true;
                            assert.equal(res.byteLength, 249 * 1023, "check length");
                            assert.equal(res.byteLength, data.byteLength, "correct large length");
                            for (i = 0; i < len; i++) {
                                if (res[i] !== data[i] || res[i] === undefined) {
                                    eq = false;
                                    break;
                                }
                            }
                            assert.ok(eq, "got back same data");
                            done();
                        });
            });
});

QUnit.test("remove", function (assert) {
    const done = assert.async();
    assert.expect(3);
    cockpit.spawn(["bash", "-c", "test -f " + dir + "/bar && echo exists"])
            .done(function (res) {
                assert.equal(res, "exists\n", "exists");
                cockpit.file(dir + "/bar").replace(null)
                        .always(function() {
                            assert.equal(this.state(), "resolved", "didn't fail");
                            cockpit.spawn(["bash", "-c", "test -f " + dir + "/bar || echo gone"])
                                    .done(function (res) {
                                        assert.equal(res, "gone\n", "gone");
                                        done();
                                    });
                        });
            });
});

QUnit.test("abort replace", function (assert) {
    const done = assert.async();
    assert.expect(2);

    var file = cockpit.file(dir + "/bar");

    var n = 0;
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

QUnit.test("replace with tag", function (assert) {
    const done = assert.async();
    var file = cockpit.file(dir + "/barfoo");

    file.read()
            .always(function () {
                assert.equal(this.state(), "resolved", "didn't fail");
            })
            .done(function (content, tag_1) {
                assert.equal(content, null, "file does not exist");
                assert.equal(tag_1, "-", "first tag is -");
                file.replace("klmn\n", tag_1)
                        .always(function () {
                            assert.equal(this.state(), "resolved", "didn't fail");
                        })
                        .done(function (tag_2) {
                            assert.notEqual(tag_2, "-", "second tag is not -");
                            file.replace("KLMN\n", tag_2)
                                    .always(function () {
                                        assert.equal(this.state(), "resolved", "didn't fail");
                                    })
                                    .done(function (tag_3) {
                                        assert.notEqual(tag_3, tag_2, "third tag is different");
                                        file.replace("opqr\n", tag_2)
                                                .fail(function (error) {
                                                    assert.equal(error.problem, "change-conflict", "wrong tag is rejected");
                                                    done();
                                                });
                                    });
                        });
            });
});

QUnit.test("modify", function (assert) {
    const done = assert.async();
    assert.expect(7);

    var file = cockpit.file(dir + "/quux");

    var n = 0;
    file
            .modify(function (old) {
                n += 1;
                assert.equal(old, null, "no old content");
                return "ABCD\n";
            })
            .always(function () {
                assert.equal(this.state(), "resolved", "didn't fail");
                assert.equal(n, 1, "callback called once");
            })
            .done(function () {
                var n = 0;
                file
                        .modify(function (old) {
                            n += 1;
                            assert.equal(old, "ABCD\n", "correct old content");
                            return "dcba\n";
                        })
                        .always(function () {
                            assert.equal(this.state(), "resolved", "didn't fail");
                            assert.equal(n, 1, "callback called once");
                            cockpit.spawn(["cat", dir + "/quux"])
                                    .done(function (res) {
                                        assert.equal(res, "dcba\n", "correct content");
                                        done();
                                    });
                        });
            });
});

QUnit.test("modify with conflict", function (assert) {
    const done = assert.async();
    assert.expect(8);

    var file = cockpit.file(dir + "/baz");

    var n = 0;
    file
            .modify(function (old) {
                n += 1;
                assert.equal(old, null, "no old content");
                return "ABCD\n";
            })
            .always(function () {
                assert.equal(this.state(), "resolved", "didn't fail");
                assert.equal(n, 1, "callback called once");
            })
            .done(function (content, tag) {
                var n = 0;
                cockpit.spawn(["bash", "-c", "sleep 1; echo XYZ > " + dir + "/baz"])
                        .done(function () {
                            file
                                    .modify(function (old) {
                                        n += 1;
                                        if (n == 1)
                                            assert.equal(old, "ABCD\n", "correct old (out-of-date) content");
                                        else
                                            assert.equal(old, "XYZ\n", "correct old (current) content");
                                        return old.toLowerCase();
                                    }, content, tag)
                                    .always(function () {
                                        assert.equal(this.state(), "resolved", "didn't fail");
                                        assert.equal(n, 2, "callback called twice");
                                        cockpit.spawn(["cat", dir + "/baz"])
                                                .done(function (res) {
                                                    assert.equal(res, "xyz\n", "correct content");
                                                    done();
                                                });
                                    });
                        });
            });
});

QUnit.test("watching", function (assert) {
    const done = assert.async();
    assert.expect(3);

    var file = cockpit.file(dir + "/foobar");
    var watch = file.watch(changed);

    var n = 0;
    function changed(content, tag) {
        n += 1;
        if (n == 1) {
            assert.equal(content, null, "initially non-existent");
            cockpit.spawn(["bash", "-c", "cd " + dir + " && echo 1234 > foobar.tmp && mv foobar.tmp foobar"]);
        } else if (n == 2) {
            assert.equal(content, "1234\n", "correct new content");
            cockpit.spawn(["bash", "-c", "rm " + dir + "/foobar"]);
        } else if (n == 3) {
            assert.equal(content, null, "finally non-existent");
            watch.remove();
            done();
        }
    }
});

QUnit.test("syntax watching", function (assert) {
    const done = assert.async();
    assert.expect(3);

    var file = cockpit.file(dir + "/foobar.json", { syntax: JSON });
    var watch = file.watch(changed);

    var n = 0;
    function changed(content, tag, err) {
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
    }
});

QUnit.test("closing", function (assert) {
    const done = assert.async();
    assert.expect(2);

    var file = cockpit.file(dir + "/foobarbaz");
    var watch = file.watch(changed);

    var n = 0;
    function start_after_two() {
        n += 1;
        if (n == 2) {
            watch.remove();
            done();
        }
    }

    file.read()
            .done(function (content, tag) {
                assert.ok(false, "read didn't complete");
            })
            .fail(function (error) {
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

QUnit.test("channel options", function (assert) {
    const done = assert.async();
    assert.expect(1);
    cockpit.file(dir + "/foo", { binary: true }).read()
            .done(function(data) {
                assert.ok(data instanceof window.Uint8Array, "options applied, got binary data");
            })
            .always(function() {
                done();
            });
});

QUnit.test("remove testdir", function (assert) {
    const done = assert.async();
    assert.expect(1);
    cockpit.spawn(["rm", "-rf", dir])
            .always(function () {
                assert.equal(this.state(), "resolved", "didn't fail");
                done();
            });
});

cockpit.spawn(["bash", "-c", "d=$(mktemp -d); echo '1234' >$d/foo; echo '{ \"foo\": 12 }' >$d/foo.json; echo -en '\\x00\\x01\\x02\\x03' >$d/foo.bin; dd if=/dev/zero of=$d/large.bin bs=1k count=512; echo $d"])
        .done(function (resp) {
            dir = resp.replace(/\n$/, "");
            QUnit.start();
        });
