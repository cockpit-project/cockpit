import cockpit from "cockpit";

// This is the basic structure of a preloaded page.  It has a two
// phase initialization: phase 1 while it is still invisible, and
// phase 2 when it becomes visible.
//
// Elements on the page (including the body) are made visible only
// once the page itself is visible.  Otherwise layout might go wrong
// and not recover automatically.

function init_1() {
    return (cockpit.spawn(["hostname"])
            .then(data => {
                document.getElementById("host").innerText = data.trim();
            }));
}

function init_2() {
    return (cockpit.file("/etc/os-release").read()
            .then(data => {
                document.getElementById("release").innerText = data;
            }));
}

function navigate() {
    document.getElementById("path").innerText = cockpit.location.path.join("/");
    document.body.removeAttribute("hidden");
}

function maybe_phase_2() {
    cockpit.removeEventListener("visibilitychange", maybe_phase_2);
    if (cockpit.hidden) {
        cockpit.addEventListener("visibilitychange", maybe_phase_2);
    } else {
        init_2().then(navigate);
    }
}

function init() {
    init_1().then(maybe_phase_2);
}

document.addEventListener("DOMContentLoaded", init);
