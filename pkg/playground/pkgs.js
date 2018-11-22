var $ = require("jquery");
var cockpit = require("cockpit");

$(function() {
    var proxy = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Packages", "/packages");

    var manifests;

    function update(str) {
        var new_m = JSON.parse(str);
        var p;

        if (manifests) {
            for (p in new_m) {
                if (!manifests[p])
                    console.log("ADD", p);
                else if (manifests[p].checksum != new_m[p].checksum)
                    console.log("CHG", p);
            }
            for (p in manifests) {
                if (!new_m[p])
                    console.log("REM", p);
            }
        }

        manifests = new_m;
    }

    var debug_manifest_changes = false;

    proxy.wait(function () {
        $("body").show();
        if (debug_manifest_changes) {
            update(proxy.Manifests);
            $(proxy).on("changed", function () {
                update(proxy.Manifests);
            });
        }
        $("#reload").on("click", function() {
            proxy.Reload()
                    .fail(function (error) {
                        console.log("ERROR", error);
                    });
        });
    });
});
