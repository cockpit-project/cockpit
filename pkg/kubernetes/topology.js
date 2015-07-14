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
    };

    return angular.module('kubernetes.topology', [ 'ngRoute', 'kubernetesUI' ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/topology', {
                templateUrl: 'topology.html',
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

                var all = client.select();
                client.track(all);
                $(all).on("changed", digest);
                digest();

                /* TODO: This should be made unnecessary by parsing endpoints */
                function weak(item) {
                    if (item.status && item.status.phase && item.status.phase !== "Running")
                        return true;
                    return false;
                }

                function digest() {
                    var items = { };
                    var relations = [ ];

                    /* Items we're going to use for links */
                    var leaves = { "Service": { }, "Node": { }, "ReplicationController": { } };

                    var item, key, leaf, kind, pods;
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

                    var isnode, isservice, pkey;
                    for (kind in leaves) {
                        leaf = leaves[kind];
                        isnode = kind === "Node";
                        isservice = kind === "Service";
                        for (key in leaf) {
                            item = leaf[key];
                            if (isnode)
                                pods = client.hosting("Pod", item.metadata.name);
                            else
                                pods = client.select("Pod", item.metadata.namespace, item.spec.selector || { });
                            for (pkey in pods) {
                                if (isservice && weak(pods[pkey]))
                                    continue;
                                relations.push({ source: key, target: pkey });
                            }
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
                    $scope.height = { height: (window.innerHeight - 15) + "px" };
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
