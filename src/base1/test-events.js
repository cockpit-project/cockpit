/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

QUnit.test("event dispatch", function() {
    var obj =  { };
    cockpit.event_target(obj);

    var count = 0;
    function handler(ev) {
        if (count === 0) {
            assert.equal(typeof ev, "object", "event is object");
            assert.equal(ev.type, "action", "event.type is 'action'");
            assert.equal(ev.data, "Data", "event.data is set");
        }
        count += 1;
    }

    var ev = document.createEvent("Event");
    ev.initEvent("action", false, false);
    ev.data = "Data";

    obj.dispatchEvent(ev);
    assert.strictEqual(count, 0, "count is zero");

    obj.onaction = handler;
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 1, "count is one");

    obj.addEventListener("action", handler, true);
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 3, "count is three");

    obj.addEventListener("action", handler, true);
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 6, "count is six");

    obj.removeEventListener("action", handler, true);
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 8, "count is eight");

    obj.onaction = null;
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 9, "count is nine");

    obj.removeEventListener("action", handler, true);
    obj.dispatchEvent(ev);
    assert.strictEqual(count, 9, "count is still nine");
});

QUnit.start();
