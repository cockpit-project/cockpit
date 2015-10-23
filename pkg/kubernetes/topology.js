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

define([
    "jquery",
    "base1/angular",
    "kubernetes/d3",
    "kubernetes/topology-graph"
], function($, angular, d3) {
    "use strict";

    var icons = {
        Pod: '#vertex-Pod',
        ReplicationController: '#vertex-ReplicationController',
        Node: '#vertex-Node',
        Service: '#vertex-Service',
        DeploymentConfig: "#vertex-DeploymentConfig",
        Route: "#vertex-Route"
    };

    return angular.module('kubernetes.topology', [ 'ngRoute', 'kubernetesUI' ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/topology', {
                templateUrl: 'views/topology-page.html',
                controller: 'TopologyCtrl'
            });
        }])

        .controller('TopologyCtrl', [
            '$scope',
            function($scope) {
                $scope.items = { };
                $scope.relations = [ ];
                $scope.selected = null;

                var client = $scope.client;
                var ready = false;

                client.include("deploymentconfigs");
                client.include("routes");
                var all = client.select();
                client.track(all);
                $(all).on("changed", digest);
                $(all).on("updated", entity_updated);
                $(all).on("removed", entity_removed);
                digest();

                function entity_updated(ev, entity, key, last) {
                    if($scope.selected && $scope.selected.kind === last.kind && $scope.selected.key === last.key) {
                        $scope.selected = entity;
                    }
                }

                function entity_removed(ev, entity, key) {
                    if($scope.selected === entity) {
                        $scope.selected = null;
                    }
                }

                function rels_for_item(item) {
                    var rels = { };
                    var endpoints, subsets;

                    /* Lookup which node this pod is scheduled on */
                    if (item.kind === "Node") {
                        rels = client.hosting("Pod", item.metadata.name);

                    /* Kubernetes tells us about endpoints, which are service to pod mappings */
                    } else if (item.kind === "Service") {
                        endpoints = client.lookup("Endpoints", item.metadata.name,
                                                     item.metadata.namespace) || { };
                        subsets = endpoints.subsets || [ ];
                        subsets.forEach(function(subset) {
                            var addresses = subset.addresses || [ ];
                            addresses.forEach(function(address) {
                                if (address.targetRef && address.targetRef.kind == "Pod")
                                    rels["Pod:" + address.targetRef.uid] = { };
                            });
                        });

                    /* For ReplicationControllers we just do the selection ourselves */
                    } else if (item.kind === "ReplicationController") {
                        rels = client.select("Pod", item.metadata.namespace, item.spec.selector || { });

                    } else if (item.kind === "DeploymentConfig") {
                        rels = client.select("ReplicationController", item.metadata.namespace,
                                             {"openshift.io/deployment-config.name" : item.metadata.name});
                    /* For Routes just build it out */
                    } else if (item.kind === "Route" && item.spec.to) {
                        var rel = client.lookup(item.spec.to.kind,
                                                item.spec.to.name,
                                                item.metadata.namespace);
                        if (rel)
                            rels[rel.key] = rel;
                    }
                    return rels;
                }

                function digest() {
                    var items = { };
                    var relations = [ ];

                    /* Items we're going to use for links */
                    var leaves = {
                        "Service": { },
                        "Node": { },
                        "ReplicationController": { },
                        "DeploymentConfig": { },
                        "Route": { },
                    };

                    var item, key, leaf, kind;
                    for (key in all) {
                        item = all[key];
                        kind = item.kind;
                        leaf = leaves[kind];

                        if (leaf)
                            leaf[key] = item;
                        else if (kind !== "Pod")
                            continue;

                        items[key] = item;
                    }

                    var rels, pkey;
                    for (kind in leaves) {
                        leaf = leaves[kind];
                        for (key in leaf) {
                            item = leaf[key];
                            rels = rels_for_item(item);
                            for (pkey in rels)
                                relations.push({ source: key, target: pkey });
                        }
                    }

                    $scope.items = items;
                    $scope.relations = relations;

                    if (ready)
                        $scope.$digest();
                }

                $scope.selected = null;
                $scope.$on("select", function(ev, item) {
                    $scope.selected = item;
                    $scope.$digest();
                });

                /* Make a copy since we modify */
                $scope.kinds = angular.copy(icons);

                function resized() {
                    $scope.height = { height: (window.innerHeight - 55) + "px" };
                    if (ready)
                        $scope.$digest();
                }
                $(window).on('resize', resized);
                resized();

                $scope.$on("$destroy", function() {
                    $(window).off('resize', resized);
                    client.track(all, false);
                    $(all).off();
                });

                all = client.select();
                client.track(all);
                $(all).on("changed", digest);
                digest();

                ready = true;
            }
        ]);
});
