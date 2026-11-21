// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import { board, NOTIFICATIONS_KEY } from "_internal/notifications";
import { is_page_status } from "shell";

const demo_board = board("playground:demo");

function id(sel) {
    return document.getElementById(sel);
}

function update() {
    const notification = demo_board.list()[0]?.notification;
    const status = is_page_status(notification) ? notification : null;

    id("received-type").innerText = status?.type ?? "-";
    id("received-title").innerText = status?.title ?? "-";
    const registry = sessionStorage.getItem(NOTIFICATIONS_KEY) || "{}";
    try {
        id("registry").innerText = JSON.stringify(JSON.parse(registry), null, 2);
    } catch {
        id("registry").innerText = registry;
    }
}

function init () {
    demo_board.addEventListener("changed", update);
    update();
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
