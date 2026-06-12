// SPDX-License-Identifier: LGPL-2.1-or-later
import { page_status, channel } from "notifications";

const demo_channel = channel("playground:demo");

function id(sel) {
    return document.getElementById(sel);
}

function update_page_status() {
    const status = page_status.get("playground");

    if (status) {
        id("received-type").innerText = status.type;
        id("received-title").innerText = status.title;
    } else if (status !== undefined) {
        id("received-type").innerText = "-";
        id("received-title").innerText = "-";
    }
}

function update_channel() {
    const list = id("channel-list");
    if (!list)
        return;
    list.innerHTML = "";
    for (const n of demo_channel.list()) {
        const li = document.createElement("li");
        li.id = "channel-entry-" + n.id;
        li.textContent = `${n.publisher}: [${n.type ?? "-"}] ${n.title}`;
        list.appendChild(li);
    }
}

function init () {
    page_status.addEventListener("changed", update_page_status);
    demo_channel.addEventListener("changed", update_channel);
    update_page_status();
    update_channel();
}

document.addEventListener("DOMContentLoaded", init);
