/* global $, cockpit, QUnit, unescape, escape */

/* To help with future migration */
var assert = QUnit;

QUnit.test("public api", function() {
    assert.equal(typeof cockpit.cache, "function", "cockpit.cache is a function");
});

QUnit.asyncTest("single cache", function() {
    assert.expect(6);

    var closed = false;

    function provider(result, key) {
        assert.equal(key, "test-key-1", "provider got right key");
        assert.equal(typeof result, "function", "provider got result function");

        var timer = window.setTimeout(function() {
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

        QUnit.start();
    }

    var cache = cockpit.cache("test-key-1", provider, consumer);
});

QUnit.asyncTest("multi cache", function() {
    assert.expect(12);

    var closed1 = false;

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

        var timer = window.setTimeout(function() {
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

    var count = 0;

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
            QUnit.start();
        }
    }

    var cache1 = cockpit.cache("test-key-b", provider1, consumer1);
    var cache2 = cockpit.cache("test-key-b", provider2, consumer2);
});

QUnit.start();
