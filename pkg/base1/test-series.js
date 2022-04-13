import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("public api", function (assert) {
    assert.equal(typeof cockpit.grid, "function", "cockpit.grid is a function");
    assert.equal(typeof cockpit.series, "function", "cockpit.series is a function");

    const grid1 = cockpit.grid(555, 3, 8);
    assert.strictEqual(grid1.interval, 555, "grid.interval");
    assert.strictEqual(grid1.beg, 3, "grid.beg");
    assert.strictEqual(grid1.end, 8, "grid.end");
    assert.equal(typeof grid1.add, "function", "grid.add()");
    assert.equal(typeof grid1.remove, "function", "grid.remove()");
    assert.equal(typeof grid1.close, "function", "grid.close()");
    assert.equal(typeof grid1.notify, "function", "grid.notify()");
    assert.equal(typeof grid1.move, "function", "grid.move()");
    assert.equal(typeof grid1.sync, "function", "grid.sync()");

    const grid2 = cockpit.grid(555, 3);
    assert.strictEqual(grid2.beg, 3, "not-null grid.beg");
    assert.strictEqual(grid2.end, 3, "same grid.end");

    const grid3 = cockpit.grid(555, 0);
    assert.strictEqual(grid3.end, 0, "zero grid.end");

    const sink = cockpit.series(888);
    assert.strictEqual(sink.interval, 888, "series.interval");
    assert.equal(typeof sink.input, "function", "series.input()");
    assert.equal(typeof sink.load, "function", "series.load()");
});

QUnit.test("calculated row", function (assert) {
    const grid = cockpit.grid(1000, 3, 8);
    const calculated = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[i + x] = i;
    });

    grid.notify(1, 4);
    assert.deepEqual(calculated, [undefined, 0, 1, 2, 3], "array contents");
});

QUnit.test("calculated order", function (assert) {
    const grid = cockpit.grid(1000, 3, 8);

    const calculated = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[i + x] = i;
    });

    /* Callbacks must be called in the right order for this to work */
    const dependent = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[i + x] = calculated[i + x] + 10;
    });

    grid.notify(1, 4);
    assert.deepEqual(dependent, [undefined, 10, 11, 12, 13], "dependent array contents");
});

QUnit.test("calculated early", function (assert) {
    const grid = cockpit.grid(1000, 3, 8);

    /* Callbacks must be called in the right order for this to work */
    const dependent = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[i + x] = calculated[i + x] + 10;
    });

    /* Even though this one is added after, run first, due to early flag */
    const calculated = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[i + x] = i;
    }, true);

    grid.notify(1, 4);
    assert.deepEqual(dependent, [undefined, 10, 11, 12, 13], "dependent array contents");
});

QUnit.test("notify limit", function (assert) {
    const grid = cockpit.grid(1000, 5, 15);

    let called = -1;
    grid.add(function(row, x, n) {
        called = n;
    });

    grid.notify(10, 8);
    assert.strictEqual(called, -1, "not called out of bounds");

    grid.notify(1, 0);
    assert.strictEqual(called, -1, "not called zero length");

    grid.notify(1, 20);
    assert.strictEqual(called, 9, "truncated to right limit");
});

QUnit.test("sink row", function (assert) {
    const grid = cockpit.grid(1000, 5, 15);
    const sink = cockpit.series(1000);

    const row1 = grid.add(sink, "one.sub.2");
    const row2 = grid.add(sink, ["one", "sub", 2]);
    const calc = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[x + i] = row1[x + i] + row2[x + i];
    });

    let notified = null;
    grid.addEventListener("notify", (ev, n, x) => {
        notified = [n, x];
    });

    const items = [
        {
            one: { sub: [200, 201, 202], another: [20, 21, 22] },
            two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
        },
        {
            one: { sub: [300, 301, 302], another: [30, 31, 32] },
            two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
        },
        {
            one: { sub: [400, 401, 402], another: [40, 41, 42] },
            two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
        }
    ];

    sink.input(7, items);

    assert.deepEqual(notified, [2, 3]);

    assert.deepEqual(row1, [undefined, undefined, 202, 302, 402], "row with string path");
    assert.deepEqual(row2, [undefined, undefined, 202, 302, 402], "row with array path");
    assert.deepEqual(calc, [undefined, undefined, 404, 604, 804], "row with calculated");

    grid.close();
});

QUnit.test("sink no path", function (assert) {
    const grid = cockpit.grid(1000, 5, 15);
    const sink = cockpit.series(1000);

    const row = grid.add(sink);

    const items = [567, 768, { hello: "scruffy" }];

    sink.input(8, items);

    assert.deepEqual(row, [undefined, undefined, undefined, 567, 768, { hello: "scruffy" }], "row without a path");
});

QUnit.test("sink after close", function (assert) {
    const grid = cockpit.grid(1000, 5, 15);
    const sink = cockpit.series(1000);

    const row = grid.add(sink);

    const items = [1, 2, 3];

    sink.input(5, items);
    assert.deepEqual(row, [1, 2, 3], "row got values");

    sink.input(8, items);
    assert.deepEqual(row, [1, 2, 3, 1, 2, 3], "row got more values");

    grid.close();

    sink.input(11, items);
    assert.deepEqual(row, [1, 2, 3, 1, 2, 3], "row got no more values");
});

QUnit.test("sink mapping", function (assert) {
    const grid = cockpit.grid(1000, 5, 15);
    const sink = cockpit.series(1000);

    const row1 = grid.add(sink, "two.sub.1");
    const row2 = grid.add(sink, "one.sub");
    const row3 = grid.add(sink, "invalid");

    const mapping = {
        one: { "": 0, sub: { "": 0 }, another: { "": 1 } },
        two: { "": 1, sub: { "": 0 }, marmalade: { "": 1 } }
    };

    const items = [
        [
            [[200, 201, 202], [20, 21, 22]],
            [[2000, 2001, 2002], [0, 1, 2]]
        ],
        [
            [[300, 301, 302], [30, 31, 32]],
            [[3000, 3001, 3002], [0, 1, 2]]
        ],
        [
            [[400, 401, 402], [40, 41, 42]],
            [[4000, 4001, 4002], [0, 1, 2]]
        ]
    ];

    sink.input(5, items, mapping);

    assert.deepEqual(row1, [2001, 3001, 4001], "mapped with trailing");
    assert.deepEqual(row2, [[200, 201, 202], [300, 301, 302], [400, 401, 402]], "mapped simply");
    assert.deepEqual(row3, [undefined, undefined, undefined], "mapped undefined");

    grid.close();
});

QUnit.test("cache simple", function (assert) {
    const fetched = [];
    function fetch(beg, end) {
        fetched.push([beg, end]);
    }

    const sink = cockpit.series(1000, null, fetch);

    sink.input(7, [
        {
            one: { sub: [200, 201, 202], another: [20, 21, 22] },
            two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
        },
        {
            one: { sub: [300, 301, 302], another: [30, 31, 32] },
            two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
        },
        {
            one: { sub: [400, 401, 402], another: [40, 41, 42] },
            two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
        }
    ]);

    const grid = cockpit.grid(1000, 5, 15);

    let notified = null;
    grid.addEventListener("notify", (ev, n, x) => {
        notified = [n, x];
    });

    const row1 = grid.add(sink, "one.sub.2");
    const row2 = grid.add(sink, ["one", "sub", 2]);
    const calc = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[x + i] = (row1[x + i] + row2[x + i]) || undefined;
    });

    grid.sync();

    assert.deepEqual(fetched, [[5, 7], [10, 15]], "fetched right data");
    assert.deepEqual(notified, [0, 10], "notified about right indexes");

    assert.deepEqual(row1, [undefined, undefined, 202, 302, 402], "row with string path");
    assert.deepEqual(row2, [undefined, undefined, 202, 302, 402], "row with array path");
    assert.deepEqual(calc, [undefined, undefined, 404, 604, 804, undefined,
        undefined, undefined, undefined, undefined], "row with calculated");

    grid.close();
});

QUnit.test("cache multiple", function (assert) {
    const fetched = [];
    function fetch(beg, end) {
        fetched.push([beg, end]);
    }

    const sink = cockpit.series(1000, null, fetch);

    sink.input(7, [{
        one: { sub: [200, 201, 202], another: [20, 21, 22] },
        two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
    }]);

    sink.input(8, [{
        one: { sub: [300, 301, 302], another: [30, 31, 32] },
        two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
    }]);

    sink.input(9, [{
        one: { sub: [400, 401, 402], another: [40, 41, 42] },
        two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
    }]);

    const grid = cockpit.grid(1000, 5, 15);

    let notified = null;
    grid.addEventListener("notify", (ev, n, x) => {
        notified = [n, x];
    });

    const row1 = grid.add(sink, "one.sub.2");
    const row2 = grid.add(sink, ["one", "sub", 2]);
    const calc = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[x + i] = (row1[x + i] + row2[x + i]) || undefined;
    });

    grid.sync();

    assert.deepEqual(fetched, [[5, 7], [10, 15]], "fetched right data");
    assert.deepEqual(notified, [0, 10], "notified about right indexes");

    assert.deepEqual(row1, [undefined, undefined, 202, 302, 402], "row with string path");
    assert.deepEqual(row2, [undefined, undefined, 202, 302, 402], "row with array path");
    assert.deepEqual(calc, [undefined, undefined, 404, 604, 804, undefined,
        undefined, undefined, undefined, undefined], "row with calculated");

    grid.close();
});

QUnit.test("cache overlap", function (assert) {
    const fetched = [];
    function fetch(beg, end) {
        fetched.push([beg, end]);
    }

    const sink = cockpit.series(1000, null, fetch);
    const grid = cockpit.grid(1000, 5, 15);
    const row1 = grid.add(sink, "one.sub.2");

    /* Initial state of the cache */
    sink.input(6, [{
        one: { sub: [200, 201, 202], another: [20, 21, 22] },
        two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
    }, {
        one: { sub: [200, 201, 202], another: [20, 21, 22] },
        two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
    }]);

    sink.input(8, [{
        one: { sub: [300, 301, 302], another: [30, 31, 32] },
        two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
    }, {
        one: { sub: [300, 301, 302], another: [30, 31, 32] },
        two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
    }]);
    sink.input(10, [{
        one: { sub: [900, 901, 902], another: [90, 91, 92] },
        two: { sub: [9000, 9001, 9002], marmalade: [0, 1, 2] }
    }]);

    assert.deepEqual(row1, [undefined, 202, 202, 302, 302, 902], "row with initial data");

    /* Overlaying the data currently throws overlapping stuff out of the cache */
    sink.input(7, [{
        one: { sub: [400, 401, 402], another: [40, 41, 42] },
        two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
    }, {
        one: { sub: [400, 401, 402], another: [40, 41, 42] },
        two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
    }]);

    const row2 = grid.add(sink, "one.sub.2");
    grid.sync();

    assert.deepEqual(row1, [undefined, 202, 402, 402, 302, 902], "row with filled data");
    assert.deepEqual(row2, [undefined, 202, 402, 402, 302, 902], "row with overlapping data");

    grid.close();
});

QUnit.test("cache limit", function (assert) {
    const series = cockpit.series(1000, null);
    series.limit = 5;
    series.input(8, ["eight"]);
    series.input(6, ["six", "seven"]);
    series.input(9, ["nine"]);

    const grid = cockpit.grid(1000, 5, 15);
    const row = grid.add(series, null);
    grid.sync();

    assert.deepEqual(row, [undefined, "six", "seven", "eight", "nine"], "initial data correct");

    /* Force an expiry by adding too much data */
    series.input(10, ["ten", "eleven"]);

    /* Should have removed some data from cache */
    grid.move(4, 14);
    assert.deepEqual(row, [undefined, undefined, "six", "seven", undefined, "nine", "ten", "eleven"], "expired");

    /* Force further expiry */
    series.input(3, ["three", "four", "five"]);

    /* Should have removed move data from cache */
    grid.move(3, 13);
    assert.deepEqual(row, ["three", "four", "five", undefined, undefined, undefined,
        undefined, "ten", "eleven"], "expired more");

    grid.close();
});

QUnit.test("move", function (assert) {
    const fetched = [];
    function fetch(beg, end) {
        fetched.push([beg, end]);
    }

    const sink = cockpit.series(1000, null, fetch);
    const grid = cockpit.grid(1000, 20, 25);

    const row1 = grid.add(sink, "one.sub.2");
    const row2 = grid.add(sink, ["one", "sub", 2]);
    const calc = grid.add(function(row, x, n) {
        for (let i = 0; i < n; i++)
            row[x + i] = (row1[x + i] + row2[x + i]) || undefined;
    });

    let notified = null;
    grid.addEventListener("notify", (ev, n, x) => {
        notified = [n, x];
    });

    sink.input(7, [{
        one: { sub: [200, 201, 202], another: [20, 21, 22] },
        two: { sub: [2000, 2001, 2002], marmalade: [0, 1, 2] }
    },
    {
        one: { sub: [300, 301, 302], another: [30, 31, 32] },
        two: { sub: [3000, 3001, 3002], marmalade: [0, 1, 2] }
    },
    {
        one: { sub: [400, 401, 402], another: [40, 41, 42] },
        two: { sub: [4000, 4001, 4002], marmalade: [0, 1, 2] }
    }]);

    assert.deepEqual(fetched, [], "fetched no data");
    assert.strictEqual(notified, null, "not notified");

    assert.deepEqual(row1, [], "row1 empty");
    assert.deepEqual(row2, [], "row2 empty");
    assert.deepEqual(calc, [], "calc empty");

    grid.move(5, 15);

    assert.deepEqual(fetched, [[5, 7], [10, 15]], "fetched right data");
    assert.deepEqual(notified, [0, 10], "not notified");

    assert.deepEqual(row1, [undefined, undefined, 202, 302, 402], "row1 with data");
    assert.deepEqual(row2, [undefined, undefined, 202, 302, 402], "row2 with data");
    assert.deepEqual(calc, [undefined, undefined, 404, 604, 804, undefined,
        undefined, undefined, undefined, undefined], "row with calculated");

    grid.close();
});

QUnit.test("move negative", function (assert) {
    const now = Date.now();
    const grid = cockpit.grid(1000, -20, -5);

    assert.equal(grid.beg, Math.floor(now / 1000) - 20);
    assert.equal(grid.end, Math.floor(now / 1000) - 5);

    grid.move(-30, -0);

    assert.equal(grid.beg, Math.floor(now / 1000) - 30);
    assert.equal(grid.end, Math.floor(now / 1000));

    grid.close();
});

QUnit.test("test", function (assert) {
    const done = assert.async();
    assert.expect(5);

    const fetched = [];
    function fetch(beg, end) {
        fetched.push([beg, end]);
    }

    const series = cockpit.series(100, null, fetch);
    const grid = cockpit.grid(100, 20, 25);

    grid.add(series, []);

    let count = 0;
    grid.walk();

    grid.addEventListener("notify", () => {
        count += 1;

        assert.equal(count, fetched.length, "fetched " + count);

        if (count == 5) {
            grid.close();
            done();
        }
    });
});

/* mock Date.now() function that returns a constant value to avoid races
 */
Date.now = function() {
    return 0;
};

QUnit.start();
