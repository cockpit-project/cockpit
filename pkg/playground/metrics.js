import $ from "jquery";
import cockpit from "cockpit";

import '../../src/base1/patternfly-cockpit.scss';
import "plot.css";

var metrics = [{ name: "block.device.read" }];

var channel = cockpit.channel({
    payload: "metrics1",
    source: "internal",
    metrics: metrics,
    interval: 1000
});
$(channel).on("close", function (event, message) {
    console.log(message);
});
$(channel).on("message", function (event, message) {
    console.log(message);
});

$(function() {
    $("body").prop("hidden", false);
    $("#reload").on("click", function() {
        cockpit.logout(true);
    });
});
