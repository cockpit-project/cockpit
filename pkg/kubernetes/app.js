define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/client"
], function($, angular, kubernetes) {
    'use strict';

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
                ports: "",
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
            client.select(service.spec.selector || { },
                          service.metadata.namespace, "Pod").forEach(function(pod) {
                if (!pod.status || !pod.status.phase)
                    return;
                switch (pod.status.phase) {
                case "Pending":
                    if (!state)
                        state = "wait";
                    y++;
                    break;
                case "Running":
                    x++; y++;
                    break;
                case "Succeeded": // don't increment either counter
                    break;
                case "Unknown":
                    y++;
                    break;
                case "Failed":
                    /* falls through */
                default: /* assume failed */
                    y++;
                    state = "fail";
                    break;
                }
            });

            calculated.containers = "" + x;
            if (x != y)
                calculated.containers += " of " + y;
            calculated.status = state;

            /* Calculate the port string */

            var parts;

            /* No ports here */
            if (!spec.ports || !spec.ports.length) {
                calculated.ports = "";

            /* One single TCP port */
            } else if (spec.ports.length === 1 && spec.ports[0].protocol === "TCP") {
                calculated.ports = ":" + spec.ports[0].port;

            /* Multiple ports */
            } else {
                parts = [];
                spec.ports.forEach(function(port) {
                    if (port.protocol === "TCP")
                        parts.push(port.port);
                    else
                        parts.push(port.port + "/" + port.protocol);
                });
                calculated.ports = " " + parts.join(" ");
            }

            return calculated;
        }

        Object.defineProperties(self, {
            containers: {
                get: function get() { return calculate().containers; }
            },
            ports: {
                get: function get() { return calculate().ports; }
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
            self.namespace = meta.namespace;
            service = item;
            calculated = null;
        };
    }

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
            var pods = [];

            if (spec.externalID)
                calculated.address = spec.externalID;
            pods = client.hosting(meta.name, "Pod");

            /* TODO: Calculate number of containers instead of pods */
            calculated.containers = "" + pods.length;

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

    function KubernetesPod(client) {
        var self = this;

        var pod = { };

        self.apply = function apply(item) {
            var meta = item.metadata || { };
            self.name = meta.name;
            pod = item;
        };
    }

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
            'kubernetes.dashboard'
        ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });
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
        });
});
