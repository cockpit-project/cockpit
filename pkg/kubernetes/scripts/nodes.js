/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

    angular.module('kubernetes.nodes', [
        'ngRoute',
        'kubeClient',
        'kubernetes.listing',
        'ui.cockpit',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/nodes', {
                    templateUrl: 'views/nodes-page.html',
                    controller: 'NodeCtrl'
                })

                .when('/nodes/:target', {
                    controller: 'NodeCtrl',
                    templateUrl: 'views/node-page.html'
                });
        }
    ])

    /*
     * The controller for the node view.
     */
    .controller('NodeCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'ListingState',
        'filterService',
        '$routeParams',
        '$location',
        'nodeActions',
        '$timeout',
        function($scope, loader, select,  ListingState, filterService,
                 $routeParams, $location, actions, $timeout) {
            var target = $routeParams["target"] || "";
            $scope.target = target;

            var c = loader.listen(function() {
                var timer;
                $scope.nodes = select().kind("Node");
                if (target)
                    $scope.item = select().kind("Node").name(target).one();
            });

            loader.watch("Node");

            $scope.$on("$destroy", function() {
                c.cancel();
            });

            $scope.listing = new ListingState($scope);

            /* All the actions available on the $scope */
            angular.extend($scope, actions);

            $scope.$on("activate", function(ev, id) {
                if (!$scope.listing.expandable) {
                    ev.preventDefault();
                    $location.path('/nodes/' + encodeURIComponent(id));
                }
            });

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
        }
    ])

    .directive('nodeBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/node-body.html'
            };
        }
    )

    .directive('nodeCapacity',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/node-capacity.html',
            };
        }
    )

    .factory('nodeActions', [
        '$modal',
        function($modal) {
            function addNode() {
                return $modal.open({
                    animation: false,
                    controller: 'AddNodeCtrl',
                    templateUrl: 'views/node-add.html',
                    resolve: {},
                }).result;
            }

            return {
                addNode: addNode
            };
        }
    ])

    .controller("AddNodeCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, methods, translate) {
            var _ = translate.gettext;
            var fields = {
                "address" : "",
                "name" : "",
            };
            var dirty = false;

            $scope.fields = fields;

            function validate() {
                var regex = /^[a-z0-9.-]+$/i;
                var defer = $q.defer();
                var address = fields.address.trim();
                var name = fields.name.trim();
                var ex;
                var failures = [];
                var item;

                if (!address)
                    ex = new Error(_("Please type an address"));
                else if (!regex.test(address))
                    ex = new Error(_("The address contains invalid characters"));

                if (ex) {
                    ex.target = "#node-address";
                    failures.push(ex);
                }

                if (name && !regex.test(name)) {
                    ex = new Error(_("The name contains invalid characters"));
                    ex.target = "#node-name";
                    failures.push(ex);
                }

                if (failures.length > 0) {
                    defer.reject(failures);
                } else {
                    item = {
                        "kind": "Node",
                        "apiVersion": "v1",
                        "metadata": {
                            "name": name ? name : address,
                        },
                        "spec": {
                            "externalID": address
                        }
                    };
                    defer.resolve(item);
                }

                return defer.promise;
            }

            $scope.nameKeyUp = function nameKeyUp(event) {
                dirty = true;
                if (event.keyCode == 13)
                    $scope.performAdd();
            };

            $scope.addressKeyUp = function addressKeyUp(event) {
                if (event.keyCode == 13)
                    $scope.performAdd();
                else if (!dirty)
                    fields.name = event.target.value;
            };

            $scope.performAdd = function performAdd() {
                return validate().then(function(item) {
                    return methods.create(item);
                });
            };
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
    ]);

}());
