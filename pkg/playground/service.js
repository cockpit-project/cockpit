(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var service = require("service");

    $(function() {
        var proxy;

        function navigate() {

            proxy = service.proxy(cockpit.location.path[0] || "");

            function show() {
                function s(t) {
                    $('#' + t).text(JSON.stringify(proxy[t]));
                }
                s('exists');
                s('state');
                s('enabled');
            }

            $(proxy).on('changed', show);
            show();

            $("body").show();
        }

        function b(t) {
            $('#' + t).on('click', function () {
                proxy[t]().
                    fail(function (error) {
                        console.log(error);
                    });
            });
        }

        b('start');
        b('stop');
        b('enable');
        b('disable');

        $(cockpit).on('locationchanged', navigate);
        navigate();
    });
}());
