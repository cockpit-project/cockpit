import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("public api", function (assert) {
    assert.equal(typeof cockpit.cache, "function", "cockpit.cache is a function");
});

QUnit.test("single cache", function (assert) {
    const done = assert.async();
    assert.expect(6);

    let closed = false;

    function provider(result, key) {
        assert.equal(key, "test-key-1", "provider got right key");
        assert.equal(typeof result, "function", "provider got result function");

        const timer = window.setTimeout(function() {
            result({ myobject: "value" });
        }, 200);

        return {
            close: function() {
                window.clearTimeout(timer);
                closed = true;
            }
        };
    }

    function consumer(value, key) {
        assert.equal(key, "test-key-1", "consumer got right key");
        assert.deepEqual(value, { myobject: "value" });

        assert.equal(closed, false, "cache is not closed");
        cache.close();
        assert.equal(closed, true, "cache is closed");

        done();
    }

    const cache = cockpit.cache("test-key-1", provider, consumer);
});

QUnit.test("multi cache", function (assert) {
    const done = assert.async();
    assert.expect(12);

    let closed1 = false;

    function provider1(result, key) {
        assert.equal(key, "test-key-b", "provider1 got right key");
        assert.equal(typeof result, "function", "provider1 got result function");

        result({ myobject: "value1" });

        return {
            close: function() {
                closed1 = true;
            }
        };
    }

    function provider2(result, key) {
        assert.equal(key, "test-key-b", "provider2 got right key");
        assert.equal(typeof result, "function", "provider2 got result function");

        const timer = window.setTimeout(function() {
            result({ myobject: "value2" });
        }, 200);

        return {
            close: function() {
                window.clearTimeout(timer);
            }
        };
    }

    function consumer1(value, key) {
        assert.equal(key, "test-key-b", "consumer1 got right key");
        assert.deepEqual(value, { myobject: "value1" }, "consumer1 got right value");
    }

    let count = 0;

    function consumer2(value, key) {
        assert.equal(key, "test-key-b", "consumer2 got right key");
        count++;
        if (count === 1) {
            assert.deepEqual(value, { myobject: "value1" }, "consumer2 got value from producer1");
            assert.equal(closed1, false, "cache1 is not closed");
            cache1.close();
            assert.equal(closed1, true, "cache1 is closed");
        } else if (count === 2) {
            assert.deepEqual(value, { myobject: "value2" }, "cache2 provided another value");
            done();
        }
    }

    const cache1 = cockpit.cache("test-key-b", provider1, consumer1);
    cockpit.cache("test-key-b", provider2, consumer2);
});

QUnit.start();
