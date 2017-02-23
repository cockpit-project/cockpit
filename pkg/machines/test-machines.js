var QUnit = require("qunit-tests");
var assert = QUnit;

var helpers = require("./helpers.es6");

QUnit.test("toFixedPrecision", function() {
    assert.equal("1.0", helpers.toFixedPrecision("1", 1));
    assert.equal("1.0", helpers.toFixedPrecision("1.0", 1));
    assert.equal("1.0", helpers.toFixedPrecision("1.01", 1));
    assert.equal("1.1", helpers.toFixedPrecision("1.1", 1));
    assert.equal("1.1", helpers.toFixedPrecision("1.123", 1));

    assert.equal("1", helpers.toFixedPrecision("1", 0));
    assert.equal("1", helpers.toFixedPrecision("1.0", 0));
    assert.equal("1", helpers.toFixedPrecision("1.01", 0));
    assert.equal("1", helpers.toFixedPrecision("1.1", 0));
    assert.equal("1", helpers.toFixedPrecision("1.123", 0));

    assert.equal("1.00", helpers.toFixedPrecision("1", 2));
    assert.equal("1.00", helpers.toFixedPrecision("1.0", 2));
    assert.equal("1.01", helpers.toFixedPrecision("1.01", 2));
    assert.equal("1.10", helpers.toFixedPrecision("1.1", 2));
    assert.equal("1.12", helpers.toFixedPrecision("1.123", 2));

    assert.equal("12.0", helpers.toFixedPrecision("12", 1));
    assert.equal("12.0", helpers.toFixedPrecision("12.0", 1));
    assert.equal("12.0", helpers.toFixedPrecision("12.01", 1));
    assert.equal("12.0", helpers.toFixedPrecision("12.010", 1));
    assert.equal("12.1", helpers.toFixedPrecision("12.123", 1));

    assert.equal("12.00", helpers.toFixedPrecision("12", 2));
    assert.equal("12.00", helpers.toFixedPrecision("12.0", 2));
    assert.equal("12.01", helpers.toFixedPrecision("12.01", 2));
    assert.equal("12.01", helpers.toFixedPrecision("12.010", 2));
    assert.equal("12.12", helpers.toFixedPrecision("12.123", 2));
});

QUnit.start();
