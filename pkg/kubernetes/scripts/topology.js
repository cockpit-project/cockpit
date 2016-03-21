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

    var icons = {
        Pod: '#vertex-Pod',
        ReplicationController: '#vertex-ReplicationController',
        Node: '#vertex-Node',
        Service: '#vertex-Service',
        DeploymentConfig: "#vertex-DeploymentConfig",
        Route: "#vertex-Route"
    };

    angular.module('kubernetes.topology', [
        'ngRoute',
        'kubernetesUI',
        'kubeClient',
        'kubernetes.details'
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/topology', {
                templateUrl: 'views/topology-page.html',
                controller: 'TopologyCtrl'
            });
        }
    ])

    .controller('TopologyCtrl', [
        '$scope',
        '$window',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        'itemActions',
        function($scope, $window, loader, select, discoverSettings, actions) {
            $scope.items = { };
            $scope.relations = [ ];
            $scope.selected = null;

            var ready = false;

            function link_for_item(kind, namespace, name) {
                var rel = select().kind(kind).name(name).namespace(namespace).one();
                if (rel)
                    return rel.metadata.selfLink;
            }

            function rels_for_item(item) {
                var rels = { };
                var endpoints, subsets;
                var link;

                /* Lookup which node this pod is scheduled on */
                if (item.kind === "Node") {
                    rels = select().kind("Pod").host(item.metadata.name);

                /* Kubernetes tells us about endpoints, which are service to pod mappings */
                } else if (item.kind === "Service") {
                    endpoints = select().kind("Endpoints")
                                        .namespace(item.metadata.namespace)
                                        .name(item.metadata.name).one() || { };
                    subsets = endpoints.subsets || [ ];
                    subsets.forEach(function(subset) {
                        var addresses = subset.addresses || [ ];
                        addresses.forEach(function(address) {
                            if (address.targetRef && address.targetRef.kind == "Pod")
                                link = link_for_item("Pod", address.targetRef.namespace,
                                                     address.targetRef.name);
                                if (link)
                                    rels[link] = {};
                        });
                    });

                /* For ReplicationControllers we just do the selection ourselves */
                } else if (item.kind === "ReplicationController") {
                    rels = select().kind("Pod").namespace(item.metadata.namespace);
                    if (item.spec.selector)
                        rels = rels.label(item.spec.selector);

                } else if (item.kind === "DeploymentConfig") {
                    rels = select().kind("ReplicationController")
                                   .namespace(item.metadata.namespace)
                                   .label({"openshift.io/deployment-config.name" : item.metadata.name});
                /* For Routes just build it out */
                } else if (item.kind === "Route" && item.spec.to) {
                    link = link_for_item(item.spec.to.kind, item.metadata.namespace,
                                         item.spec.to.name);
                    if (link)
                        rels[link] = {};
                }
                return rels;
            }

            loader.watch("Node");
            loader.watch("Pod");
            loader.watch("ReplicationController");
            loader.watch("Service");
            loader.watch("Endpoints");

            discoverSettings().then(function(settings) {
                if (settings.flavor === "openshift") {
                    loader.watch("DeploymentConfig");
                    loader.watch("Route");
                }
            });

            var c = loader.listen(function(changed, removed) {
                var selected_meta;
                var relations = [];
                var item;
                var key;

                $scope.items = select();
                if ($scope.selected) {
                    selected_meta = $scope.selected.metadata || {};
                    item = select().kind($scope.selected.kind).name(selected_meta.name);
                    if (selected_meta.namespace)
                        item = item.namespace(selected_meta.namespace);
                    $scope.selected = item.one();
                }

                for (key in $scope.items) {
                    var pkey;
                    var rels = rels_for_item($scope.items[key]);
                    for (pkey in rels)
                        relations.push({ source: key, target: pkey });
                }

                $scope.relations = relations;
            });

            $scope.$on("$destroy", function() {
                c.cancel();
            });

            $scope.$on("select", function(ev, item) {
                $scope.$applyAsync(function () {
                    $scope.selected = item;
                });
            });

            /* Make a copy since we modify */
            $scope.kinds = angular.copy(icons);

            /* All the actions available on the $scope */
            angular.extend($scope, actions);

            function resized() {
                $scope.height = { height: (window.innerHeight - 55) + "px" };
                if (ready)
                    $scope.$digest();
            }

            angular.element($window).bind('resize', resized);
            resized();

            ready = true;
        }
    ]);
}());
