import cockpit from "cockpit";

import '../lib/patternfly/patternfly-5-cockpit.scss';

import * as service from "service";

document.addEventListener("DOMContentLoaded", () => {
    let proxy;

    function navigate() {
        proxy = service.proxy(cockpit.location.path[0] || "");

        function show() {
            function s(t) {
                document.getElementById(t).textContent = JSON.stringify(proxy[t]);
            }
            s('exists');
            s('state');
            s('enabled');
        }

        proxy.addEventListener("changed", show);
        show();

        document.body.removeAttribute("hidden");
    }

    function b(t) {
        document.getElementById(t).addEventListener("click", () => {
            proxy[t]()
                    .catch(error => console.error("action", t, "failed:", JSON.stringify(error)));
        });
    }

    b('start');
    b('stop');
    b('enable');
    b('disable');

    cockpit.addEventListener("locationchanged", navigate);
    navigate();
});
