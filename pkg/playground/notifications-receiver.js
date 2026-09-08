// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from "cockpit";
import { board } from "_internal/notifications";

const demo_board = board("playground:demo");

function id(sel) {
    return document.getElementById(sel);
}

function update() {
    const status = demo_board.list()[0];

    if (status) {
        id("received-type").innerText = status.type ?? "-";
        id("received-title").innerText = status.title ?? "-";
    } else {
        id("received-type").innerText = "-";
        id("received-title").innerText = "-";
    }
}

function init () {
    demo_board.addEventListener("changed", update);
    update();
}

document.addEventListener("DOMContentLoaded", () => {
    cockpit.transport.wait(init);
});
