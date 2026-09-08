// SPDX-License-Identifier: LGPL-2.1-or-later
import '../lib/patternfly/patternfly-6-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Button/button.css";
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import { page_status } from "shell";
import { board } from "_internal/notifications";

import "../lib/page.scss";

// Demo board so notifications-receiver.js can list cross-page posts.
const demo_board = board("playground:demo");

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
        const status = { type: id("type").value || null, title: id("title").value };
        page_status.publish(status);
        demo_board.publish(status);
    };

    id("clear-status").onclick = event => {
        page_status.publish(null);
        demo_board.clear();
    };
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
