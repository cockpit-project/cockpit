/* Replaced in production by a javascript bundle. */

/* When we're being loaded into the index window we have additional duties */
if (document.documentElement.getAttribute("class") === "index-page") {
    /* Indicates to child frames that we are a cockpit1 router frame */
    window.name = "cockpit1";

    /* The same thing as above, but compatibility with old cockpit */
    window.options = { sink: true, protocol: "cockpit1" };

    /* While the index is initializing, snag any messages we receive from frames */
    window.messages = [ ];

    var message_queue = function(event) {
        window.messages.push(event);
    };

    window.messages.cancel = function() {
        window.removeEventListener("message", message_queue, false);
        window.messages = null;
    };

    window.addEventListener("message", message_queue, false);
}
