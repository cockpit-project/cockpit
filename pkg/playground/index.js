import '../lib/patternfly/patternfly-5-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Button/button.css";
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import { page_status } from "notifications";

import "../lib/page.scss";

function id(sel) {
    return document.getElementById(sel);
}

function init() {
    const entries = cockpit.manifests.playground.playground;
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
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
