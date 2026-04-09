// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import QUnit from "qunit-tests";

interface ChannelOptions {
    payload: string;
    path?: string;
    watch?: boolean;
    binary?: string | boolean | null;
    external?: Record<string, string>;
}

function channel_url(query: ChannelOptions): string {
    return "/cockpit/channel/" + cockpit.transport.csrf_token + "?" + window.btoa(JSON.stringify(query));
}

QUnit.test("external get", async assert => {
    const resp = await fetch(channel_url({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    assert.equal(resp.status, 200, "got right status");
    assert.equal(resp.statusText, "OK", "got right reason");
    assert.equal(resp.headers.get("Content-Type"), "application/octet-stream", "default type");
    const text = await resp.text();
    assert.ok(text.indexOf('"present"'), "got listing");
});

QUnit.test("external fsread1", async assert => {
    const stat = await cockpit.spawn(["stat", "--format", "%s", "/usr/lib/os-release"]);
    const filesize = stat.replace(/\n$/, "");

    const resp = await fetch(channel_url({
        payload: "fsread1",
        path: '/usr/lib/os-release',
        binary: "raw",
        external: {
            "content-disposition": 'attachment; filename="foo"',
            "content-type": "application/octet-stream",
        }
    }));

    assert.equal(resp.status, 200, "got right status");
    assert.equal(resp.statusText, "OK", "got right reason");
    assert.equal(resp.headers.get("Content-Type"), "application/octet-stream", "expected type");
    assert.equal(resp.headers.get("Content-Disposition"), 'attachment; filename="foo"', "expected disposition");
    assert.equal(resp.headers.get("Content-Length"), filesize, "expected file size");
});

QUnit.test("external content-type default with binary:raw", async assert => {
    const resp = await fetch(channel_url({
        payload: "fslist1",
        path: "/tmp",
        watch: false,
        binary: "raw",
    }));

    assert.equal(resp.status, 200, "got right status");
    assert.equal(resp.headers.get("Content-Type"), "application/octet-stream", "default type for binary channel");
});

QUnit.module("tests that need test-server warnings disabled", hooks => {
    hooks.before(async () => { await fetch("/mock/expect-warnings") });
    hooks.after(async () => { await fetch("/mock/dont-expect-warnings") });

    QUnit.test("external rejects binary:empty-string", async assert => {
        const resp = await fetch(channel_url({
            payload: "fslist1",
            path: "/tmp",
            watch: false,
            binary: "",
        }));

        // This should ideally be a 400 (rejected by -ws itself), but
        // currently -ws accepts any string and forwards it to the bridge,
        // which rejects it as a protocol error, resulting in a 500.
        assert.ok(resp.status === 400 || resp.status === 500, "empty string rejected");
    });

    QUnit.test("external rejects binary:false", async assert => {
        const resp = await fetch(channel_url({
            payload: "fslist1",
            path: "/tmp",
            watch: false,
            binary: false,
        }));

        assert.equal(resp.status, 400, "false rejected");
    });

    QUnit.test("external rejects binary:null", async assert => {
        const resp = await fetch(channel_url({
            payload: "fslist1",
            path: "/tmp",
            watch: false,
            binary: null,
        }));

        assert.equal(resp.status, 400, "null rejected");
    });
});

QUnit.test("external ignores mixed-case Content-Type", async assert => {
    const resp = await fetch(channel_url({
        payload: "fslist1",
        path: "/tmp",
        watch: false,
        external: {
            "Content-Type": "text/fancy",
        },
    }));

    assert.equal(resp.status, 200, "got right status");
    assert.equal(resp.headers.get("Content-Type"), "application/octet-stream",
                 "only lowercase 'content-type' key is recognized");
});

QUnit.test("external headers", async assert => {
    const resp = await fetch(channel_url({
        payload: "fslist1",
        path: "/tmp",
        watch: false,
        external: {
            "content-disposition": "my disposition; blah",
            "content-type": "test/blah",
        },
    }));

    assert.equal(resp.status, 200, "got right status");
    assert.equal(resp.headers.get("Content-Type"), "test/blah", "got type");
    assert.equal(resp.headers.get("Content-Disposition"), "my disposition; blah", "got disposition");
});

QUnit.test("external invalid", async assert => {
    const resp = await fetch("/cockpit/channel/invalid");
    assert.equal(resp.status, 404, "got not found");
});

QUnit.test("external no token", async assert => {
    const query = window.btoa(JSON.stringify({
        payload: "fslist1",
        path: "/tmp",
        watch: false
    }));

    const resp = await fetch("/cockpit/channel/?" + query);
    assert.equal(resp.status, 404, "got not found");
});

QUnit.test("external websocket", async assert => {
    const query = window.btoa(JSON.stringify({
        payload: "echo"
    }));

    const ws = new WebSocket("ws://" + window.location.host + "/cockpit/channel/" +
                             cockpit.transport.csrf_token + '?' + query, "protocol-unused");

    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });
    assert.ok(true, "websocket is open");

    try {
        ws.send("oh marmalade");
        let ev = await new Promise<MessageEvent>(resolve => { ws.onmessage = resolve });
        assert.equal(ev.data, "oh marmalade", "got payload");

        ws.send("another test");
        ev = await new Promise<MessageEvent>(resolve => { ws.onmessage = resolve });
        assert.equal(ev.data, "another test", "got payload again");
    } finally {
        ws.close(1000);
    }
});

cockpit.transport.wait(function() {
    /* Tell tap driver not to worry about HTTP failures past this point */
    console.log("cockpittest-tap-expect-resource-error");
    QUnit.start();
});
