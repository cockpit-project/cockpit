import cockpit from "cockpit";
import QUnit from "qunit-tests";

/* This is *NOT* a development guide, we take lots of shortcuts here */

/* Top level window */
function parent_window(assert) {
    const done = assert.async();
    assert.expect(7);
    window.assert = assert; // for the child frame

    document.getElementById("qunit-header").textContent = "Cockpit Parent Frame";
    window.name = "cockpit1";
    let initialized = false;
    let frame;

    cockpit.transport.filter(function (message, channel, control) { // eslint-disable-line array-callback-return
        if (initialized)
            frame.postMessage(message, cockpit.transport.origin);
    });

    window.addEventListener("message", event => {
        const message = event.data;
        if (message.length === 0) {
            done();
        } else if (message.indexOf && message.indexOf('"init"') !== -1) {
            initialized = true;
            frame.postMessage('\n{ "command": "init", "version": 1, "a": "b", "host" : "frame_host"  }',
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

    let spawn_done = false;
    let binary_done = false;

    const promise = cockpit.spawn(["/bin/sh", "-c", "echo hi"], { host: "localhost" })
            .then(resp => {
                assert.equal(resp, "hi\n", "framed channel got output");
            })
            .always(() => {
                assert.equal(promise.state(), "resolved", "framed channel closed");
                assert.equal(cockpit.transport.host, "frame_host", "framed cockpit.transport.host");
                spawn_done = true;
                if (binary_done) {
                    cockpit.transport.close();
                }
            });

    const channel = cockpit.channel({
        payload: "echo",
        binary: true,
        host: "localhost"
    });
    channel.addEventListener("message", function(ev, payload) {
        assert.equal(typeof payload[0], "number", "binary channel got a byte array");

        let match = true;
        for (let i = 0; i < payload.length; i++) {
            if (payload[i] !== i)
                match = false;
        }
        assert.equal(match, true, "binary channel got back right data");
        channel.close();
    });
    channel.addEventListener("close", (ev, options) => {
        assert.notOk(options.reason, "binary channel close cleanly");
        binary_done = true;
        if (spawn_done)
            cockpit.transport.close();
    });

    const view = new Array(8);
    for (let i = 0; i < 8; i++)
        view[i] = i;
    channel.send(view);
}

if (window.parent === window) {
    QUnit.test("framed", parent_window);
    QUnit.start();
} else {
    child_frame();
}
