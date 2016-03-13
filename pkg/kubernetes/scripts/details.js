/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

(function() {
    "use strict";

    function validItem(item, type) {
        var valid = (item && (!type || item.kind === type) &&
                     item.spec && item.metadata);
        var type_name = type ? type : "Object";

        if (!valid)
            console.warn("Invalid "+ type_name, item);

        return valid;
    }

    function number_with_suffix_to_bytes (byte_string) {
        var valid_suffixes = {
            "E": 1000000000000000000,
            "P": 1000000000000000,
            "T": 1000000000000,
            "G": 1000000000,
            "M": 1000000,
            "K": 1000,
            "m": 0.001,
            "Ei": 1152921504606846976,
            "Pi": 1125899906842624,
            "Ti": 1099511627776,
            "Gi": 1073741824,
            "Mi": 1048576,
            "Ki": 1024,
        };

        for (var key in valid_suffixes) {
            if (byte_string.length > key.length &&
                byte_string.slice(-key.length) === key) {
                var number = Number(byte_string.slice(0, -key.length));
                if (!isNaN(number))
                    return number * valid_suffixes[key];
            }
        }
        return byte_string;
    }

    function format_addresses_with_ports(addresses, ports) {
        var text = addresses.join(", ");

        if (ports && ports.length) {
            text = text + ":" + ports.map(function(p) {
                if (p.protocol === "TCP")
                    return p.port;
                else
                    return p.port + "/" + p.protocol;
            }).join(", ");
        }

        return text;
    }

    angular.module('kubernetes.details', [
        'ngRoute',
        'ui.cockpit',
        'kubernetesUI',
        'kubeClient',
        'kubernetes.listing',
        'kubernetes.date',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/list', {
                templateUrl: 'views/details-page.html',
                controller: 'DetailsCtrl'
            });
        }
    ])

    /*
     * The controller for the details view.
     */
    .controller('DetailsCtrl', [
        '$scope',
        'KubeContainers',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        'ListingState',
        '$routeParams',
        '$location',
        'itemActions',
        function($scope, containers, loader, select, discoverSettings,
                 ListingState, $routeParams, $location, actions) {

            var c = loader.listen(function() {
                $scope.pods = select().kind("Pod");
                $scope.services = select().kind("Service");
                $scope.nodes = select().kind("Node");
                $scope.replicationcontrollers = select().kind("ReplicationController");
                $scope.deploymentconfigs = select().kind("DeploymentConfig");
                $scope.routes = select().kind("Route");
            });

            loader.watch("Pod");
            loader.watch("Service");
            loader.watch("Node");
            loader.watch("ReplicationController");
            loader.watch("Endpoints");

            $scope.$on("$destroy", function() {
                c.cancel();
            });

            discoverSettings().then(function(settings) {
                if (settings.flavor === "openshift") {
                    loader.watch("DeploymentConfig");
                    loader.watch("Route");
                }
            });

            $scope.listing = new ListingState($scope);
            $scope.listing.forceInline = true;
            $scope.containers = containers;

            $scope.itemIdentifier = function item_identifier(item) {
                var meta = item.metadata || { };
                var id = item.kind.toLowerCase() + "s/";
                if (meta.namespace)
                    id = id + meta.namespace + "/";
                return id + meta.name;
            };

            $scope.serviceEndpoint = function service_endpoint(service) {
                return select().kind("Endpoints")
                               .namespace(service.metadata.namespace)
                               .name(service.metadata.name).one();
            };

            $scope.replicationcontrollerPods = function replicationcontroller_pods(item) {
                var meta = item.metadata || {};
                var spec = item.spec || {};
                return select().kind("Pod")
                               .namespace(meta.namespace || "")
                               .label(spec.selector || {});
            };

            $scope.nodePods = function node_pods(item) {
                var meta = item.metadata || {};
                return select().kind("Pod").host(meta.name);
            };

            $scope.nodeReadyCondition = function node_read_condition(conditions) {
                var ret = {};
                if (conditions) {
                    conditions.forEach(function(condition) {
                        if (condition.type == "Ready") {
                            ret = condition;
                            return false;
                        }
                    });
                }
                return ret;
            };

            $scope.podStatus = function (item) {
                var status = item.status || {};
                var meta = item.metadata || {};

                if (meta.deletionTimestamp)
                    return "Terminating";
                else
                    return status.phase;
            };

            /* All the actions available on the $scope */
            angular.extend($scope, actions);
        }
    ])

    .filter('nodeStatus', [
        "KubeTranslate",
        function(KubeTranslate) {
            return function(conditions) {
                var ready = false;
                var _ = KubeTranslate.gettext;

                /* If no status.conditions then it hasn't even started */
                if (conditions) {
                    conditions.forEach(function(condition) {
                        if (condition.type == "Ready") {
                            ready = condition.status == "True";
                            return false;
                        }
                    });
                }
                return ready ? _("Ready") : _("Not Ready");
            };
        }
    ])

    .filter('nodeExternalIP', [
        "KubeTranslate",
        function(KubeTranslate) {
            return function(addresses) {
                var address = null;
                var _ = KubeTranslate.gettext;

                /* If no status.conditions then it hasn't even started */
                if (addresses) {
                    addresses.forEach(function(a) {
                        if (a.type == "LegacyHostIP" || address.type == "ExternalIP") {
                            address = a.address;
                            return false;
                        }
                    });
                }
                return address ? address : _("Unknown");
            };
        }
    ])

    .filter('formatCapacityName', function() {
        return function(key) {
            var data;
            if (key == "cpu") {
                data = "CPUs";
            } else {
                key = key.replace(/-/g, " ");
                data = key.charAt(0).toUpperCase() + key.substr(1);
            }
            return data;
        };
    })

    .filter('formatCapacityValue', [
        "KubeFormat",
        function (format) {
            return function(value, key) {
                var data;
                if (key == "memory") {
                    var raw = number_with_suffix_to_bytes(value);
                    value = format.formatBytes(raw);
                }
                return value;
            };
        }
    ])

    .directive('kubernetesServiceCluster', function() {
        return {
            restrict: 'E',
            link: function($scope, element, attributes) {
                $scope.$watchGroup(["item.spec.clusterIP",
                                    "item.spec.ports"], function(values) {
                    var text = format_addresses_with_ports([values[0]],
                                                           values[1]);
                    element.text(text);
                });
            }
        };
    })

    .factory('itemActions', [
        '$modal',
        function($modal) {
            function deleteItem(item) {
                return $modal.open({
                    animation: false,
                    controller: 'ItemDeleteCtrl',
                    templateUrl: 'views/item-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyRoute(item) {
                return $modal.open({
                    animation: false,
                    controller: 'RouteModifyCtrl',
                    templateUrl: 'views/route-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyRC(item) {
                return $modal.open({
                    animation: false,
                    controller: 'RCModifyCtrl',
                    templateUrl: 'views/replicationcontroller-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            function modifyService(item) {
                return $modal.open({
                    animation: false,
                    controller: 'ServiceModifyCtrl',
                    templateUrl: 'views/service-modify.html',
                    resolve: {
                        dialogData: function() {
                            return { item: item };
                        }
                    },
                }).result;
            }

            return {
                modifyRC: modifyRC,
                modifyRoute: modifyRoute,
                deleteItem: deleteItem,
                modifyService: modifyService,
            };
        }
    ])

    .controller("ItemDeleteCtrl", [
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        function($scope, $instance, dialogData, methods) {
            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                return methods.delete($scope.item);
            };
        }
    ])

    .controller("RCModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, dialogData, methods, translate) {
            var _ = translate.gettext;
            var fields = {};

            if (!validItem(dialogData.item, "ReplicationController")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }

            function validate() {
                var defer = $q.defer();
                var replicas = Number(fields.replicas.trim());
                var ex;

                if (isNaN(replicas) || replicas < 0)
                    ex = new Error(_("Not a valid number of replicas"));
                else if (replicas > 128)
                    ex = new Error(_("The maximum number of replicas is 128"));

                if (ex) {
                    ex.target = "#replicas";
                    defer.reject(ex);
                } else {
                    defer.resolve({ spec: { replicas: replicas } });
                }

                return defer.promise;
            }

            $scope.fields = fields;
            angular.extend($scope, dialogData);

            $scope.performModify = function performModify() {
                return validate().then(function(data) {
                    return methods.patch($scope.item, data);
                });
            };
        }
    ])

    .controller("RouteModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, dialogData, methods, translate) {
            var _ = translate.gettext;
            var fields = {};

            if (!validItem(dialogData.item, "Route")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }

            fields.host = dialogData.item.spec.host;

            function validate() {
                var defer = $q.defer();
                var host = fields.host.trim();
                var ex;

                if (!host) {
                    ex = new Error(_("Not a valid value for Host"));
                    ex.target = "#host-value";
                    defer.reject(ex);
                } else {
                    defer.resolve({ spec: { host: fields.host.trim() } });
                }

                return defer.promise;
            }

            $scope.fields = fields;
            angular.extend($scope, dialogData);

            $scope.performModify = function performModify() {
                return validate().then(function(data) {
                    return methods.patch($scope.item, data);
                });
            };
        }
    ])

    .controller("ServiceModifyCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        'kubeLoader',
        'kubeSelect',
        "KubeRequest",
        "KubeTranslate",
        "KubeFormat",
        function($q, $scope, $instance, dialogData, loader, select, KubeRequest, translate, format) {
            var _ = translate.gettext;
            var fields = {};
            var key;

            if (!validItem(dialogData.item, "Service")) {
                $scope.$applyAsync(function () {
                    $scope.$dismiss();
                });
                return;
            }


            $scope.rcs = select().kind("ReplicationController")
                                 .namespace(dialogData.item.metadata.namespace || "")
                                 .label(dialogData.item.spec.selector || {});

            for (key in $scope.rcs) {
                var item = $scope.rcs[key];
                fields[key] = {
                    name: item.metadata.name,
                    replicas: item.spec.replicas,
                };
            }

            $scope.service = dialogData.item;
            $scope.fields = fields;
            angular.extend($scope, dialogData);

            function validate() {
                var defer = $q.defer();
                var link;
                var objects = [];
                var failures = [];

                for (link in fields) {
                    var ex;
                    var replicas = Number(fields[link].replicas);
                    var name = fields[link].name;

                    if (isNaN(replicas) || replicas < 0)
                        ex = new Error(_("Not a valid number of replicas"));
                    else if (replicas > 128)
                        ex = new Error(_("The maximum number of replicas is 128"));

                    if (ex) {
                        ex.target = "#" + name;
                        failures.push(ex);
                    } else {
                        objects.push({
                            link: link,
                            name: name,
                            data: { spec: { replicas: replicas } }
                        });
                    }
                }

                if (failures.length > 0) {
                    defer.reject(failures);
                } else
                    defer.resolve(objects);

                return defer.promise;
            }

            $scope.performModify = function performModify() {
                var defer = $q.defer();
                var link;
                var req;

                validate().then(function (objects) {
                    function step() {
                        var obj = objects.shift();
                        if (!obj) {
                            defer.resolve();
                            return;
                        }

                        defer.notify(format.format(_("Updating $0..."), obj.name));

                        var config = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
                        new KubeRequest("PATCH", obj.link, JSON.stringify(obj.data), config)
                            .then(function(response) {
                                step();
                            }, function(response) {
                                var resp = response.data;
                                return defer.reject(resp || response);
                            });
                    }

                    step();

                }).catch(function(exs) {
                    defer.reject(exs);
                });

                var promise = defer.promise;
                promise.cancel = function cancel() {
                    if (req && req.cancel)
                        req.cancel();
                };

                return promise;
            };
        }
    ]);
}());
