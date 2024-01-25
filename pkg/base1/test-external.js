import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("external get", function (assert) {
    const done = assert.async();
    assert.expect(4);

    /* The query string used to open the channel */
    const query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    const req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(req.status, 200, "got right status");
            assert.equal(req.statusText, "OK", "got right reason");
            assert.equal(req.getResponseHeader("Content-Type"), "application/octet-stream", "default type");
            assert.ok(req.responseText.indexOf('"present"'), "got listing");
            done();
        }
    };
    req.send();
});

QUnit.test("external fsread1", async assert => {
    const done = assert.async();
    assert.expect(5);
    const resp = await cockpit.spawn(["bash", "-c", "size=$(stat --format '%s' /usr/lib/os-release); echo $size"]);
    const filesize = resp.replace(/\n$/, "");

    /* The query string used to open the channel */
    const query = window.btoa(JSON.stringify({
        payload: "fsread1",
        path: '/usr/lib/os-release',
        binary: "raw",
        external: {
            "content-disposition": 'attachment; filename="foo"',
            "content-type": "application/octet-stream",
        }
    }));

    const req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(req.status, 200, "got right status");
            assert.equal(req.statusText, "OK", "got right reason");
            assert.equal(req.getResponseHeader("Content-Type"), "application/octet-stream", "default type");
            assert.equal(req.getResponseHeader("Content-Disposition"), 'attachment; filename="foo"', "default type");
            assert.equal(req.getResponseHeader("Content-Length"), parseInt(filesize), "expected file size");
            done();
        }
    };
    req.send();
});

QUnit.test("external headers", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false,
        external: {
            "content-disposition": "my disposition; blah",
            "content-type": "test/blah",
        },
    }));

    const req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 200, "got right status");
            assert.equal(this.getResponseHeader("Content-Type"), "test/blah", "got type");
            assert.equal(this.getResponseHeader("Content-Disposition"), "my disposition; blah", "got disposition");
            done();
        }
    };
    req.send();
});

QUnit.test("external invalid", function (assert) {
    const done = assert.async();
    assert.expect(1);

    const req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/invalid");
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 404, "got not found");
            done();
        }
    };
    req.send();
});

QUnit.test("external no token", function (assert) {
    const done = assert.async();
    assert.expect(1);

    /* The query string used to open the channel */
    const query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    const req = new XMLHttpRequest();
    req.open("GET", "/cockpit/channel/?" + query);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            assert.equal(this.status, 404, "got not found");
            done();
        }
    };
    req.send();
});

QUnit.test("external websocket", function (assert) {
    const done = assert.async();
    assert.expect(3);

    const query = window.btoa(JSON.stringify({
        payload: "echo"
    }));

    let count = 0;
    const ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
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
        done();
    };
});

cockpit.transport.wait(function() {
    /* Tell tap driver not to worry about HTTP failures past this point */
    console.log("cockpittest-tap-expect-resource-error");
    QUnit.start();
});
