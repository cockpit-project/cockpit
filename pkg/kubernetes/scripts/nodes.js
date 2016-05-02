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
        'kubeUtils',
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
        'nodeData',
        '$timeout',
        function($scope, loader, select,  ListingState, filterService,
                 $routeParams, $location, actions, nodeData, $timeout) {
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
            angular.extend($scope, nodeData);

            $scope.$on("activate", function(ev, id) {
                $location.path('/nodes/' + encodeURIComponent(id));
            });

            $scope.nodePods = function node_pods(item) {
                var meta = item.metadata || {};
                return select().kind("Pod").host(meta.name);
            };

            $scope.deleteSelectedNodes = function() {
                var k, selected = [];
                for (k in $scope.listing.selected) {
                    if ($scope.nodes[k] && $scope.listing.selected[k])
                        selected.push($scope.nodes[k]);
                }

                if (!selected.length)
                    return;

                return actions.deleteNodes(selected).then(function() {
                    $scope.listing.selected = {};
                });
            };

            /* Redirect after a delete */
            $scope.deleteNode = function(val) {
                var promise = actions.deleteNodes(val);

                /* If the promise is successful, redirect to another page */
                promise.then(function() {
                    if ($scope.target)
                        $location.path("/nodes");
                });

                return promise;
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

            function deleteNodes(val) {
                var nodes;
                if (angular.isArray(val))
                    nodes = val;
                else
                    nodes = [ val ];

                return $modal.open({
                    animation: false,
                    controller: 'NodeDeleteCtrl',
                    templateUrl: 'views/node-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { nodes: nodes };
                        }
                    },
                }).result;
            }

            return {
                addNode: addNode,
                deleteNodes: deleteNodes
            };
        }
    ])

    .controller("NodeDeleteCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "kubeSelect",
        function($q, $scope, $instance, dialogData, methods, select) {

            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                var k;
                var errors = [];
                var nodes = {};
                var promises = [];

                function handleError(ex) {
                    errors.push(ex.message || ex.statusText);
                    nodes[k] = $scope.nodes[k];
                    return $q.reject();
                }

                for (k in $scope.nodes) {
                    var p = methods.delete($scope.nodes[k])
                        .catch(handleError);
                    promises.push(p);
                }

                return $q.all(promises).catch(function () {
                    $scope.nodes = select(nodes);
                    return $q.reject(errors);
                });
            };
        }
    ])

    .factory('nodeData', [
        "KubeMapNamedArray",
        "KubeTranslate",
        function (mapNamedArray, translate) {
            var _ = translate.gettext;

            function nodeConditions(node) {
                var status;
                if (!node)
                    return;

                if (!node.conditions) {
                    status = node.status || { };
                    node.conditions = mapNamedArray(status.conditions, "type");
                }
                return node.conditions;
            }

            function nodeCondition(node, type) {
                var conditions = nodeConditions(node) || {};
                return conditions[type] || {};
            }

            function nodeStatus(node) {
                var spec = node ? node.spec : {};
                if (!nodeCondition(node, "Ready").status)
                    return _("Unknown");

                if (nodeCondition(node, "Ready").status != 'True')
                    return _("Not Ready");

                if (spec && spec.unschedulable)
                    return _("Scheduling Disabled");

                return _("Ready");
            }

            function nodeStatusIcon(node) {
                var state = "";
                /* If no status.conditions then it hasn't even started */
                if (!nodeCondition(node, "Ready").status) {
                    state = "wait";
                } else {
                    if (nodeCondition(node, "Ready").status != 'True') {
                        state = "fail";
                    } else if (nodeCondition(node, "OutOfDisk").status == "True" ||
                             nodeCondition(node, "OutOfMemory").status == "True") {
                        state = "warn";
                    }
                }
                return state;
            }

            return {
                nodeStatusIcon: nodeStatusIcon,
                nodeCondition: nodeCondition,
                nodeConditions: nodeConditions,
                nodeStatus: nodeStatus,
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

    .filter('nodeExternalIP', [
        "KubeTranslate",
        function(KubeTranslate) {
            return function(addresses) {
                var address = null;
                var _ = KubeTranslate.gettext;

                /* If no addresses then it hasn't even started */
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

    .directive('kubernetesStatusIcon', function() {
        return {
            restrict: 'A',
            link: function($scope, element, attributes) {
                $scope.$watch(attributes["status"], function(status) {
                    element
                        .toggleClass("spinner spinner-xs", status == "wait")
                        .toggleClass("pficon pficon-error-circle-o", status == "fail")
                        .toggleClass("pficon pficon-warning-triangle-o", status == "warn");
                });
            }
        };
    })

    .directive('nodeAlerts', function() {
        return {
            restrict: 'A',
            templateUrl: 'views/node-alerts.html'
        };
    });

}());
