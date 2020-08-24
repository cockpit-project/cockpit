import $ from "jquery";
import cockpit from "cockpit";

import '../lib/patternfly/patternfly-cockpit.scss';

import * as service from "service";

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

        $("body").prop("hidden", false);
    }

    function b(t) {
        $('#' + t).on('click', function () {
            proxy[t]()
                    .fail(function (error) {
                        console.error("action", t, "failed:", JSON.stringify(error));
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
