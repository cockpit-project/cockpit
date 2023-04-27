import cockpit from "cockpit";

import '../lib/patternfly/patternfly-5-cockpit.scss';

const metrics = [{ name: "block.device.read" }];

const channel = cockpit.channel({
    payload: "metrics1",
    source: "internal",
    metrics,
    interval: 1000
});

channel.addEventListener("close", (event, message) => console.log(message));
channel.addEventListener("message", (event, message) => console.log(message));

document.addEventListener("DOMContentLoaded", () => {
    document.body.removeAttribute("hidden");
    document.getElementById("reload").addEventListener("click", () => cockpit.logout(true));
});
