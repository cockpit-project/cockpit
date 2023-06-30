import cockpit from "cockpit";
import QUnit from "qunit-tests";

/* This is *NOT* a development guide, we take lots of shortcuts here */

/* Top level window */
function parent_window(assert) {
    const done = assert.async();
    assert.expect(4);
    window.assert = assert; // for the child frame

    document.getElementById("qunit-header").textContent = "Cockpit Parent Frame";
    window.name = "cockpit1";
    let initialized = false;
    let frame;

    cockpit.transport.filter((message, channel, control) => { // eslint-disable-line array-callback-return
        if (initialized) {
            /* Inject an unknown message that gets sent
                     * before the reply
                     */
            const pos = message.indexOf('\n');
            if (pos > -1) {
                const json = JSON.parse(message.substring(pos));
                if (json.reply) {
                    frame.postMessage(message.substring(0, pos) + '\n{"unknown":"unknown"}',
                                      cockpit.transport.origin);
                }
            }
            frame.postMessage(message, cockpit.transport.origin);
        }
    });

    window.addEventListener("message", event => {
        const message = event.data;
        if (message.length === 0) {
            done();
        } else if (message.indexOf('"init"') !== -1) {
            initialized = true;
            frame.postMessage('\n{ "command": "init", "version": 1, "a": "b", "host" : "localhost"  }',
                              cockpit.transport.origin);
        } else {
            const ret = cockpit.transport.inject(message);
            if (!ret) console.error("inject failed");
        }
    }, false);

    /* This keeps coming up in tests ... how to open the transport */
    const chan = cockpit.channel({ payload: "resource2" });
    chan.addEventListener("close", () => {
        assert.equal(cockpit.transport.host, "localhost", "parent cockpit.transport.host");
        const iframe = document.createElement("iframe");
        iframe.setAttribute("name", "cockpit1:blah");
        iframe.setAttribute("src", window.location.href + "?sub");
        document.body.appendChild(iframe);
        frame = window.frames["cockpit1:blah"];
    });
}

function child_frame() {
    const assert = window.parent.assert;

    const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
    const promise = dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                              "HelloWorld", ["Browser-side JS"])
            .then(reply => {
                assert.equal(reply[0], "Word! You said `Browser-side JS'. I'm Skeleton, btw!", "reply");
                dbus.close();
            })
            .always(() => {
                assert.equal(promise.state(), "resolved", "finished successfully");
            });
    dbus.addEventListener("close", (ev, options) => {
        assert.notOk(options.problem, "close cleanly");
        cockpit.transport.close();
    });
}

if (window.parent === window) {
    QUnit.test("framed", parent_window);
    QUnit.start();
} else {
    child_frame();
}
