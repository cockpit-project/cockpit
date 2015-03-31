define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/client"
], function($, angular, kubernetes) {
    'use strict';

    function KubernetesService(client) {
        var self = this;

        var version;
        var service = { };
        var calculated = { };

        /* compute current and expected number of containers and return these
           values as a formatted string.
        */
        function calculate() {
            var x = 0;
            var y = 0;
            if (version !== client.resourceVersion) {
                //client.metadata.name != "kubernetes") {
                version = client.resourceVersion;

                calculated.containers = "0";

                if (service.spec && service.spec.selector) {
                    var pods = client.select(service.spec.selector);

                    /* calculate "x of y" containers, where x is the current
                       number and y is the expected number. If x==y then only
                       show x. The calculation is based on the statuses of the
                       containers within the pod.  Pod states: Pending,
                       Running, Succeeded, Failed, and Unknown. 
                    */
                    angular.forEach(pods, function(pod) {
			if (!pod.status || !pod.status.phase)
                           return;
                        switch (pod.status.phase) {
                        case "Failed":
                            y++;
                            break;
                        case "Pending":
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
                        default: // assume Failed
                            y++;
                        }
                    });
                    calculated.containers = "" + x;
                    if (x != y)
                        calculated.containers += " of " + y;
                }
            }
            return calculated;
        }

        Object.defineProperty(self, "containers", {
            get: function get() { return calculate().containers; }
        });

        self.apply = function apply(item) {
            var spec = item.spec || { };
            var meta = item.metadata || { };
            self.name = meta.name;
            self.address = spec.portalIP + ":" + spec.port;
            self.namespace = meta.namespace;
            service = item;
        };
    }

    function KubernetesNode(client) {
        var self = this;

        var version;
        var calculated = { };
        var node = { };

        function calculate() {
            var x = 0;
            var y = 0;
            if (version !== client.resourceVersion) {
                version = client.resourceVersion;

                calculated.containers = "0";

                /* TODO: Calculate number of containers */
                if (node.metadata && node.metadata.name) {
                    var pods = client.hosting(node.metadata.name);
                    calculated.containers = "" + pods.length;
                }
            }
            return calculated;
        }

        Object.defineProperty(self, "containers", {
            get: function get() { return calculate().containers; }
        });

        self.apply = function apply(item) {
            var status = item.status || { };
            var meta = item.metadata || { };
            self.name = meta.name;
            self.address = status.hostIP;
            node = item;
        };
    }

    function builder(type, client, Constructor) {
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
        $(client).on(type, build);
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
            return builder('services', client, KubernetesService);
        }])
        .factory('kubernetesNodes', ['kubernetesClient', function(client) {
            return builder('nodes', client, KubernetesNode);
        }]);
});
