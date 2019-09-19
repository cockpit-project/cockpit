import { page_status } from "notifications";

function id(sel) {
    return document.getElementById(sel);
}

function update() {
    const status = page_status.get("playground");

    if (status) {
        id("received-type").innerText = status.type;
        id("received-title").innerText = status.title;
    } else if (status !== undefined) {
        id("received-type").innerText = "-";
        id("received-title").innerText = "-";
    }
}

function init () {
    page_status.addEventListener("changed", update);
    update();
}

document.addEventListener("DOMContentLoaded", init);
