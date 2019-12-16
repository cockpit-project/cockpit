import $ from "jquery";
import cockpit from "cockpit";
import { docker } from "./docker";

var box;

function update() {
    if (box && box.close)
        box.close();

    var path = cockpit.location.path;
    if (path.length === 0) {
        box = $("<pre>").text("usage: console.html#/container_id");
    } else if (path.length !== 1) {
        console.warn("not a container id: " + path);
        cockpit.location = '';
    } else {
        box = docker.console(path[0]);
        $("title").text(path[0]);

        /*
         * TODO: Once we get more code into the docker module this
         * should reflect the actual docker container state and
         * become typable when the container is running.
         */
        box.typeable(true);
        box.connect();
    }

    $("#container").empty()
            .append(box);
    $("body").prop("hidden", false);
}

$(cockpit).on("locationchanged", update);
$(update);
