/* An unhandled javascript exception */
import '../lib/patternfly/patternfly-5-cockpit.scss';
import cockpit from "cockpit";

const button = document.getElementById("exception");
button.addEventListener("click", function() {
    const obj = { };
    window.setTimeout(function() {
        obj[0].value = 1;
    }, 0);
});

cockpit.transport.wait(function() {
    document.body.removeAttribute("hidden");
});
