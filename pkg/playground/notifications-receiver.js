// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import { board } from "_internal/notifications";
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
}

function init () {
    demo_board.addEventListener("changed", update);
    update();
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
