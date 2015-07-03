define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/app"
], function($, angular) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };

    /* TODO: Migrate this to angular */
    $("body").on("click", "#services-enable-change", function() {
        $("#service-list").toggleClass("editable");
        $("#services-enable-change").toggleClass("active");
    });

    $("body").on("click", ".editable", function(ev) {
        var target = $(ev.target);
        if (!target.is("button")) {
            $("#service-list").toggleClass("editable");
            $("#services-enable-change").toggleClass("active");
        }
    });

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

    return angular.module('kubernetes.dashboard', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'dashboard.html',
                controller: 'DashboardCtrl'
            });
        }])
        .controller('DashboardCtrl', [
                '$scope',
                '$location',
                'kubernetesClient',
                function($scope, $location, client) {
            var ready = false;

            $scope.services = builder('services', 'services pods', client, KubernetesService);
            $scope.nodes = builder('nodes', 'nodes pods', client, KubernetesNode);
            $scope.pods = builder('pods', 'pods', client, KubernetesPod);

            $scope.jumpService = function jumpService(ev, service) {
                var target = $(ev.target);
                if (target.parents().is(".editable")) {
                    console.log(target.parents(".editable"));
                    return;
                }

                var meta = service.metadata;
                var spec = service.spec;
                if (spec.selector && !$.isEmptyObject(spec.selector) && meta.namespace)
                    $location.path("/pods/" + encodeURIComponent(meta.namespace)).search(spec.selector);
            };

            $scope.highlighted = null;
            $scope.$on("highlight", function(ev, uid) {
                $scope.highlighted = uid;
            });
            $scope.highlight = function highlight(uid) {
                $scope.$broadcast("highlight", uid);
            };

            function services_state() {
                if ($scope.failure)
                    return 'failed';
                var service;
                for (service in $scope.services)
                    break;
                return service ? 'ready' : 'empty';
            }

            /* Track the loading/failure state of the services area */
            $scope.state = 'loading';
            $scope.client.watches.services.wait()
                .fail(function(ex) {
                    $scope.failure = ex;
                })
                .always(function() {
                    $scope.state = services_state();
                    if (ready)
                        $scope.$digest();
                });

            $([$scope.services, $scope.nodes, $scope.pods]).on("changed", function() {
                $scope.state = services_state();
                $scope.$digest();
                phantom_checkpoint();
            });

            ready = true;
        }]);
});
