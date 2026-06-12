// SPDX-License-Identifier: LGPL-2.1-or-later
import '../lib/patternfly/patternfly-6-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Button/button.css";
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import { page_status, channel } from "notifications";
import "../lib/page.scss";

const demo_channel = channel("playground:demo");

function id(sel) {
    return document.getElementById(sel);
}

function init() {
    const entries = cockpit.manifests.playground.playground;
    cockpit.assert(typeof entries === "object", "Invalid playground manifest");
    const nav = id("nav");

    for (const p in entries) {
        const entry = entries[p];
        const li = document.createElement("li");
        const a = document.createElement("a");
        li.appendChild(a);
        a.appendChild(document.createTextNode(entry.label || p));
        a.onclick = () => { cockpit.jump("/playground/" + (entry.path || p)) };
        nav.appendChild(li);
    }

    id("set-status").onclick = event => {
        page_status.set_own({ type: id("type").value, title: id("title").value });
    };

    id("clear-status").onclick = event => {
        page_status.set_own(null);
    };

    id("channel-publish").onclick = event => {
        demo_channel.publish({
            id: id("channel-id").value,
            type: id("channel-type").value || null,
            title: id("channel-title").value,
        });
    };

    id("channel-clear").onclick = event => {
        demo_channel.clear(id("channel-id").value);
    };
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
