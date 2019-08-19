import cockpit from "cockpit";
import { page_status } from "notifications";

function id(sel) {
    return document.getElementById(sel);
}

function init () {
    id("set-status").onclick = event => {
        page_status.set_own({ type: id("type").value, title: id("title").value });
    };

    id("clear-status").onclick = event => {
        page_status.set_own(null);
    };
}

cockpit.transport.wait(() => true);
document.addEventListener("DOMContentLoaded", init);
