/* global $, cockpit, QUnit, unescape, escape, WebSocket:true, XMLHttpRequest */

/* To help with future migration */
var assert = QUnit;

QUnit.asyncTest("external get", function() {
    assert.expect(4);

    /* The query string used to open the channel */
    var query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    var req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(req.status, 200, "got right status");
            assert.equal(req.statusText, "OK", "got right reason");
            assert.equal(req.getResponseHeader("Content-Type"), "application/octet-stream", "default type");
            assert.ok(req.responseText.indexOf('"present"'), "got listing");
            QUnit.start();
        }
    };
    req.send();
});

QUnit.asyncTest("external headers", function() {
    assert.expect(3);

    var query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false,
        external: {
            "content-disposition": "my disposition; blah",
            "content-type": "test/blah",
        },
    }));

    var req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 200, "got right status");
            assert.equal(this.getResponseHeader("Content-Type"), "test/blah", "got type");
            assert.equal(this.getResponseHeader("Content-Disposition"), "my disposition; blah", "got disposition");
            QUnit.start();
        }
    };
    req.send();
});

QUnit.asyncTest("external invalid", function() {
    assert.expect(1);

    var req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/invalid");
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 404, "got not found");
            QUnit.start();
        }
    };
    req.send();
});

QUnit.asyncTest("external no token", function() {
    assert.expect(1);

    /* The query string used to open the channel */
    var query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    var req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/?" + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 404, "got not found");
            QUnit.start();
        }
    };
    req.send();
});

QUnit.asyncTest("external websocket", function() {
    assert.expect(3);

    var query = window.btoa(JSON.stringify({
        payload: "echo"
    }));

    var count = 0;
    var ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
                           cockpit.transport.csrf_token + '?' + query, "protocol-unused");
    ws.onopen = function() {
        assert.ok(true, "websocket is open");
        ws.send("oh marmalade");
    };
    ws.onerror = function() {
        assert.ok(false, "websocket error");
    };
    ws.onmessage = function(ev) {
        if (count === 0) {
            assert.equal(ev.data, "oh marmalade", "got payload");
            ws.send("another test");
            count += 1;
        } else {
            assert.equal(ev.data, "another test", "got payload again");
            ws.close(1000);
        }
    };
    ws.onclose = function() {
        QUnit.start();
    };
});

cockpit.transport.wait(function() {
    /* Tell tap-phantom not to worry about HTTP failures past this point */
    console.log("phantom-tap-expect-resource-error");
    QUnit.start();
});
