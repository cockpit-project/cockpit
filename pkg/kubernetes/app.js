define([
    "kubernetes/angular",
    "kubernetes/client"
], function(angular, kubernetes) {
    'use strict';

    function KubernetesService(client) {
        var self = this;

        var version;
        var service = { };
        var calculated = { };

        function calculate() {
            if (version !== client.resourceVersion) {
                version = client.resourceVersion;

                calculated.containers = "0";

                if (service.spec && service.spec.selector) {
                    var pods = client.select(service.spec.selector);

                    /* TODO: This is wrong */
                    calculated.containers = "" + pods.length;
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
        }
    }

    function KubernetesNode(client) {
        var self = this;

        var version;
        var calculated = { };
        var node = { };

        function calculate() {
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
        }
    }

    function builder(type, client, Constructor) {
        var objects = { };

        function build() {
            var seen = { };
            angular.forEach(objects, function(value, key) {
                seen[key] = true;
            });
            angular.forEach(client[type], function(item) {
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
