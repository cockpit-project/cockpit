/* global $, cockpit, QUnit, WebSocket */

/* To help with future migration */
var assert = QUnit;

QUnit.asyncTest("external channel websocket", function() {
    assert.expect(3);

    var query = window.btoa(JSON.stringify({
        payload: "websocket-stream1",
        address: "localhost",
        port: parseInt(window.location.port, 10),
        path: "/cockpit/echosocket/",
    }));

    var count = 0;
    var ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
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
        QUnit.start();
    };
});

QUnit.asyncTest("bad channel options websocket", function() {


    var payloads = [
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
        var query = payloads.shift();
        var url = "ws://" + window.location.host + "/cockpit/channel/" +
                               cockpit.transport.csrf_token + '?' + query;
        console.log(url);
        var ws = new WebSocket(url);
        ws.onopen = function() {
            assert.ok(true, "websocket opened");
        };
        ws.onclose = function(ev) {
            console.log(ev);
            assert.ok(!ev.wasClean, url + "websocket unclean shutdown");
            assert.notEqual(ev.code, 0, url + "websocket error code");
            ws = null;
            if (payloads.length === 0)
                QUnit.start();
            else
                step();
        };
    }
    step();
});

cockpit.transport.wait(function() {
    QUnit.start();
});
