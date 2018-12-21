/* An unhandled javascript exception */
import cockpit from "cockpit";

var button = document.getElementById("exception");
button.addEventListener("click", function() {
    var obj = { };
    window.setTimeout(function() {
        obj[0].value = 1;
    }, 0);
});

cockpit.transport.wait(function() {
    document.body.removeAttribute("hidden");
});
