import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("external channel websocket", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const query = window.btoa(JSON.stringify({
        payload: "websocket-stream1",
        address: "localhost",
        port: parseInt(window.location.port, 10),
        path: "/cockpit/echosocket/",
    }));

    let count = 0;
    const ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
                           cockpit.transport.csrf_token + '?' + query);
    ws.onopen = function() {
        assert.ok(true, "websocket is open");
        ws.send("oh marmalade");
    };
    ws.onerror = function() {
        assert.ok(false, "websocket error");
    };
    ws.onmessage = function(ev) {
        if (count === 0) {
            assert.equal(ev.data, "OH MARMALADE", "got payload");
            ws.send("another test");
            count += 1;
        } else {
            assert.equal(ev.data, "ANOTHER TEST", "got payload again");
            ws.close(1000);
        }
    };
    ws.onclose = function(ev) {
        done();
    };
});

QUnit.test("bad channel options websocket", function (assert) {
    const done = assert.async();
    const payloads = [
        window.btoa(JSON.stringify({
            payload: "websocket-stream1",
            address: "localhost",
            port: 'bad',
            path: "/cockpit/echosocket/",
        })),
        window.btoa(JSON.stringify({
            payload: "websocket-stream1",
            address: "localhost",
            port: parseInt(window.location.port, 10),
        }))
    ];
    assert.expect(payloads.length * 3);
    function step() {
        const query = payloads.shift();
        const url = "ws://" + window.location.host + "/cockpit/channel/" +
                               cockpit.transport.csrf_token + '?' + query;
        console.log(url);
        let ws = new WebSocket(url);
        ws.onopen = function() {
            assert.ok(true, "websocket opened");
        };
        ws.onclose = function(ev) {
            console.log(ev);
            assert.ok(ev.wasClean, url + "websocket unclean shutdown");
            assert.notEqual(ev.code, 0, url + "websocket error code");
            ws = null;
            if (payloads.length === 0)
                done();
            else
                step();
        };
    }
    step();
});

cockpit.transport.wait(function() {
    QUnit.start();
});
