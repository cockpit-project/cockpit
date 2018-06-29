/* An unhandled javascript exception */
var button = document.getElementById("exception");
button.addEventListener("click", function() {
    var obj = { };
    window.setTimeout(function() {
        obj[0].value = 1;
    }, 0);
});

var cockpit = require("cockpit");
cockpit.transport.wait(function() {
    document.body.removeAttribute("hidden");
});
