import cockpit from "cockpit";
import QUnit from "qunit-tests";

/* Top level window */
function parent_window(assert) {
    const done = assert.async();
    assert.expect(12);
    window.assert = assert; // for the child frame

    document.getElementById("qunit-header").textContent = "Cockpit Parent Frame";
    let count = 0;
    let child_done = false;

    function maybe_done () {
        if (child_done && count == 2) {
            child_done = null;
            done();
        }
    }

    window.addEventListener("message", event => {
        if (event.data == "child-done") {
            child_done = true;
            window.setTimeout(maybe_done, 0);
        }
    });

    function provider(result, key) {
        assert.equal(key, "cross-frame-cache", "parent provider got right key");
        assert.equal(typeof result, "function", "parent provider got result function");
        result({ myobject: "value" });
        return {
            close: function() {}
        };
    }

    function consumer(value, key) {
        count++;
        assert.equal(key, "cross-frame-cache", "parent consumer got right key");
        if (count === 1) {
            assert.equal(value.myobject, "value", "parent consumer got parent value");
        } else if (count === 2) {
            assert.equal(value.myobject, "value2", "parent consumer got child value");
        }
        maybe_done();
    }

    cockpit.cache("cross-frame-cache", provider, consumer, 'parent');
    const iframe = document.createElement("iframe");
    iframe.setAttribute("name", "cockpit1:blah");
    iframe.setAttribute("src", window.location.href + "?sub");
    document.body.appendChild(iframe);
}

function child_frame() {
    const assert = window.parent.assert;

    let count = 0;

    function provider(result, key) {
        assert.equal(key, "cross-frame-cache", "child provider got right key");
        assert.equal(typeof result, "function", "child provider got result function");
        const timer = window.setTimeout(() => {
            result({ myobject: "value2" });
            window.clearTimeout(timer);
        }, 1000);
        return {
            close: () => undefined,
        };
    }

    function consumer(value, key) {
        count++;
        assert.equal(key, "cross-frame-cache", "child consumer got right key");
        if (count === 1) {
            assert.equal(value.myobject, "value", "child consumer got parent value");
            cache.claim();
        } else if (count == 2) {
            assert.equal(value.myobject, "value2", "child consumer got child value");
            window.parent.postMessage("child-done", "*");
        }
    }

    const cache = cockpit.cache("cross-frame-cache", provider, consumer, 'child');
}

if (window.parent === window) {
    QUnit.test("framed cache", parent_window);
    QUnit.start();
} else {
    child_frame();
}
