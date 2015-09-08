define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/term",
    "kubernetes/app"
], function($, cockpit, angular, Terminal) {
    'use strict';

    var _ = cockpit.gettext;

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

    return angular.module('kubernetes.details', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/list', {
                templateUrl: 'views/details-page.html',
                controller: 'DetailsCtrl'
            });
        }])

        /*
         * The controller for the details view.
         */
        .controller('DetailsCtrl', [
            '$scope',
            'kubernetesClient',
            function($scope, client) {

                var lists = {
                    Pod: null,
                    ReplicationController: null,
                    Service: null,
                    Node: null,
                    Endpoints: null,
                };

                Object.keys(lists).forEach(function(kind) {
                    lists[kind] = client.select(kind);
                    client.track(lists[kind]);
                    $(lists[kind]).on("changed", function() {
                        $scope.$digest();
                    });
                });

                angular.extend($scope, {
                    pods: lists.Pod,
                    services: lists.Service,
                    nodes: lists.Node,
                    replicationcontrollers: lists.ReplicationController
                });

                $scope.$on("$destroy", function() {
                    angular.forEach(lists, function(list) {
                        client.track(list, false);
                    });
                });

                $scope.itemIdentifier = function item_identifier(item) {
                    var meta = item.metadata || { };
                    var type = item.kind.toLowerCase();
                    return type + "s/" + meta.namespace + "/" + meta.name;
                };

                $scope.serviceEndpoint = function service_endpoint(service) {
                    return client.lookup("Endpoints",
                                         service.metadata.name,
                                         service.metadata.namespace);
                };

                $scope.replicationcontrollerPods = function replicationcontroller_pods(item) {
                    return client.select("Pod",
                                         item.metadata.namespace,
                                         item.spec.selector);
                };

                $scope.nodePods = function node_pods(item) {
                    return client.hosting("Pod", item.metadata.name);
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
            }
        ])

        .filter('nodeStatus', function() {
            return function(conditions) {
                var ready = false;

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
        })

        .filter('nodeExternalIP', function() {
            return function(addresses) {
                var address = null;

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
        })

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

        .filter('formatCapacityValue', function() {
            return function(value, key) {
                var data;
                if (key == "memory") {
                    var raw = number_with_suffix_to_bytes(value);
                    value = cockpit.format_bytes(raw);
                }
                return value;
            };
        })

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
        });
});
