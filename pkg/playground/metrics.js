(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    require("plot.css");

    var metrics = [ { name: "block.device.read"
                    }
                  ];

    var channel = cockpit.channel({ payload: "metrics1",
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
        $("body").show();
        $("#reload").on("click", function() {
            cockpit.logout(true);
        });
    });

}());
