define([
    "jquery",
    "base1/cockpit",
    "kubernetes/angular",
    "kubernetes/client",
    "kubernetes/angular-bootstrap"
], function($, cockpit, angular, kubernetes) {
    'use strict';

    /*
     * TODO: This code should be broken out into directives and filters
     * and work better with the way angularjs is done.
     */

    function KubernetesService(client) {
        var self = this;

        var service = { };
        var calculated;

        /* compute current and expected number of containers and return these
           values as a formatted string.
        */
        function calculate() {
            if (calculated)
                return calculated;

            calculated = {
                containers: "0",
                status: "",
            };

            var spec = service.spec || { };

            /* Calculate number of containers */

            var x = 0;
            var y = 0;
            var state = "";

            /*
             * Calculate "x of y" containers, where x is the current
             * number and y is the expected number. If x==y then only
             * show x. The calculation is based on the statuses of the
             * containers within the pod.  Pod states: Pending,
             * Running, Succeeded, Failed, and Unknown.
             */
            client.select("Pod", service.metadata.namespace,
                          service.spec.selector || { }).items.forEach(function(pod) {
                if (!pod.status || !pod.status.phase)
                    return;
                var spec = pod.spec || { };
                var n = 1;
                if (spec.containers)
                    n = spec.containers.length;
                switch (pod.status.phase) {
                case "Pending":
                    if (!state)
                        state = "wait";
                    y += n;
                    break;
                case "Running":
                    x += n;
                    y += n;
                    break;
                case "Succeeded": // don't increment either counter
                    break;
                case "Unknown":
                    y += n;
                    break;
                case "Failed":
                    /* falls through */
                default: /* assume failed */
                    y += n;
                    state = "fail";
                    break;
                }
            });

            calculated.containers = "" + x;
            if (x != y)
                calculated.containers += " of " + y;
            calculated.status = state;

            return calculated;
        }

        Object.defineProperties(self, {
            containers: {
                get: function get() { return calculate().containers; }
            },
            status: {
                get: function get() { return calculate().status; }
            }
        });

        self.apply = function apply(item) {
            var spec = item.spec || { };
            var meta = item.metadata || { };
            self.uid = meta.uid;
            self.name = meta.name;
            self.address = spec.portalIP;
            self.ports = spec.ports;
            self.namespace = meta.namespace;
            self.item = item;
            service = item;
            calculated = null;
        };
    }

    /*
     * TODO: This code should be broken out into directives and filters
     * and work better with the way angularjs is done.
     */

    function KubernetesNode(client) {
        var self = this;

        var calculated;
        var node = { };

        function calculate() {
            if (calculated)
                return calculated;

            calculated = {
                containers: "0",
                address: ""
            };

            var meta = node.metadata || { };
            var spec = node.spec || { };
            var status = node.status || { };

            if (spec.externalID)
                calculated.address = spec.externalID;

            var count = 0;
            client.hosting("Pod", meta.name).items.forEach(function(pod) {
                var spec = pod.spec || { };
                var n = 1;
                if (spec.containers)
                    n = spec.containers.length;
                count += n;
            });

            /* TODO: Calculate number of containers instead of pods */
            calculated.containers = "" + count;

            var state = "";

            var conditions = status.conditions;

            /* If no status.conditions then it hasn't even started */
            if (!conditions) {
                state = "wait";
            } else {
                conditions.forEach(function(condition) {
                    if (condition.type == "Ready") {
                        if (condition.status != "True")
                            state = "fail";
                    }
                });
            }

            calculated.status = state;

            return calculated;
        }

        Object.defineProperties(self, {
            containers: {
                enumerable: true,
                get: function() { return calculate().containers; }
            },
            address: {
                enumerable: true,
                get: function() { return calculate().address; }
            },
            status: {
                enumerable: true,
                get: function() { return calculate().status; }
            }
        });

        self.apply = function apply(item) {
            var meta = item.metadata || { };
            self.name = meta.name;
            calculated = null;
            node = item;
        };
    }

    /*
     * TODO: This code should be broken out into directives and filters
     * and work better with the way angularjs is done.
     */

    function KubernetesPod(client) {
        var self = this;

        var pod = { };

        self.apply = function apply(item) {
            var meta = item.metadata || { };
            self.name = meta.name;
            pod = item;
        };
    }

    /*
     * TODO: This code should be broken out into directives and filters
     * and work better with the way angularjs is done.
     */

    function builder(type, events, client, Constructor) {
        var objects = { };

        function build() {
            var seen = { };
            angular.forEach(objects, function(value, key) {
                seen[key] = true;
            });
            angular.forEach(client[type], function(item) {
                if (item.metadata.name == "kubernetes" ||
                    item.metadata.name == "kubernetes-ro")
                    return; // skip special pods created for k8 internal usage
                var key = item.metadata ? item.metadata.uid : null;
                if (!key)
                    return;
                delete seen[key];
                var obj = objects[key];
                if (obj === undefined)
                    objects[key] = obj = new Constructor(client, item);
                obj.apply(item);
            });
            angular.forEach(seen, function(value, key) {
                delete objects[key];
            });
            $(objects).triggerHandler("changed");
        }
        $(client).on(events, build);
        build();

        return objects;
    }

    return angular.module('kubernetes', [
            'ngRoute',
            'ui.bootstrap',
            'kubernetes.dashboard',
            'kubernetes.graph',
            'kubernetes.details'
        ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });
        }])

        /* Override the default angularjs exception handler */
        .factory('$exceptionHandler', ['$log', function($log) {
            return function(exception, cause) {

                /* Displays an oops if we're running in cockpit */
                cockpit.oops();

                /* And log with the default implementation */
                $log.error.apply($log, arguments);
            };
        }])

        .factory('kubernetesClient', function() {
            return kubernetes.k8client();
        })
        .factory('kubernetesServices', ['kubernetesClient', function(client) {
            return builder('services', 'services pods', client, KubernetesService);
        }])
        .factory('kubernetesNodes', ['kubernetesClient', function(client) {
            return builder('nodes', 'nodes pods', client, KubernetesNode);
        }])
        .factory('kubernetesPods', ['kubernetesClient', function(client) {
            return builder('pods', 'pods', client, KubernetesPod);
        }])
        .directive('kubernetesStatusIcon', function() {
            return {
                restrict: 'A',
                link: function($scope, element, attributes) {
                    $scope.$watch("item.status", function(status) {
                        element
                            .toggleClass("spinner spinner-sm", status == "wait")
                            .toggleClass("fa fa-exclamation-triangle fa-failed", status == "fail");
                    });
                }
            };
        })
        .directive('kubernetesAddress', function() {
            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    $scope.$watchGroup(["item.address", "item.ports"], function(values) {
                        var address = values[0];
                        var ports = values[1];
                        var href = null;
                        var text = null;

                        /* No ports */
                        if (!ports || !ports.length) {
                            text = address;

                        /* One single HTTP or HTTPS port */
                        } else if (ports.length == 1 && ports[0].protocol === "TCP") {
                            if (ports[0].port === 80)
                                href = "http://" + encodeURIComponent(address);
                            else if (ports[0].port === 443)
                                href = "https://" + encodeURIComponent(address);
                            text = address + ":" + ports[0].port;
                        } else {
                            text = " " + ports.map(function(p) {
                                if (p.protocol === "TCP")
                                    return p.port;
                                else
                                    return p.port + "/" + p.protocol;
                            }).join(" ");
                        }

                        var el;
                        element.empty();
                        if (href) {
                            el = angular.element("<a>").attr("href", href).attr("target", "_blank");
                            element.append(el);
                        } else {
                            el = element;
                        }
                        el.text(text);
                    });
                }
            };
        });
});
