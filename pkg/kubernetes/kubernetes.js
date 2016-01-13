/* Replaced in production by a javascript bundle. */

require.config({
    map: {
        "*": {
            "angular": "base1/angular",
            "d3": "base1/d3",
        }
    }
});

require([
    "base1/cockpit",
    "translated!base1/po",
    "base1/angular",
    "base1/bootstrap-select",
    "kubernetes/graphs",
    "kubernetes/deploy",
    "kubernetes/adjust",
    "kubernetes/node",
    "kubernetes/app",
    "kubernetes/containers",
    "kubernetes/dashboard",
    "kubernetes/details",
    "kubernetes/images",
    "kubernetes/topology",
    "kubernetes/object-describer"
], function(cockpit, po, angular) {
    "use strict";
    cockpit.locale(po);
    cockpit.translate();
    angular.bootstrap(document, ["kubernetes"], {
        strictDi: true
    });
});
