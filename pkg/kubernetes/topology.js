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
    "base1/cockpit",
    "kubernetes/angular",
    "kubernetes/d3",
    "kubernetes/object-describer"
], function($, cockpit, angular, d3) {
    "use strict";

    var _ = cockpit.gettext;

    var colors = {
        Node: '#636363',
        Pod: '#e6550d',
        Service: '#31a354',
        ReplicationController: '#3182bd'
    };

    var strengths = {
        Node: 5,
        Service: 3,
        ReplicationController: 1
    };

    var icons = {
        Pod: '\uf1b3', /* fa-cubes */
        ReplicationController: '\uf1b8', /* fa-cog */
        Node: '\uf1c0', /* fa-database */
        Service: '\uf0ec', /* fa-exchange */
    };

    function topology_graph(selector, client, notify) {

        var outer = d3.select(selector);

        var width;
        var height;

        var all = { };
        var nodes = [];
        var links = [];

        var color = d3.scale.category10();

        var force = d3.layout.force()
            .charge(-400)
            .linkDistance(40);

        var drag = force.drag();

        var svg = outer.append("svg");

        var node = d3.select();
        var link = d3.select();

        force.on("tick", function() {
            link.attr("x1", function(d) { return d.source.x; })
                .attr("y1", function(d) { return d.source.y; })
                .attr("x2", function(d) { return d.target.x; })
                .attr("y2", function(d) { return d.target.y; });

            node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
        });

        drag.on("dragstart", function(d) {
            notify(d);
        });

        function adjust() {
            force.size([width, height]);
            svg.attr("width", width).attr("height", height);
            update();
        }

        function update() {
            link = svg.selectAll(".link")
                .data(links);

            link.exit().remove();
            link.enter().append("line")
                .attr("class", "link")
                .style("stroke-width", function(d) { return Math.sqrt(strengths[d.kind]); });

            node = svg.selectAll(".node")
                .data(nodes, function(d) { return d.metadata.uid; });

            node.exit().remove();

            var group = node.enter().append("g")
                .attr("class", "node")
                .style("fill", function(d) { return colors[d.kind]; })
                .call(drag);

            group.append("circle")
                .attr("r", 15);
            group.append("text")
                .attr("y", 7)
                .text(function(d) { return icons[d.kind]; });
            group.append("title")
                .text(function(d) { return d.metadata.name; });

            force
                .nodes(nodes)
                .links(links)
                .start();
        }

        function digest() {

            /* The actual data for the graph */
            nodes = [];
            links = [];

            /* Lookup of key to node index */
            var lookup = { };

            /* Items we're going to use for links */
            var leaves = { "Service": [], "Node": [], "ReplicationController": [] };

            var i, len, item, key, leaf, kind, pods;
            var items = all.items;
            for (i = 0, len = items.length; i < len; i++) {
                item = items[i];

                kind = item.kind;
                leaf = leaves[kind];

                if (leaf)
                    leaf.push(item);
                else if (kind !== "Pod")
                    continue;

                lookup[item.metadata.uid] = nodes.length;
                nodes.push(item);
            }

            var isnode, isservice;
            for (kind in leaves) {
                leaf = leaves[kind];
                for (i = 0, len = leaf.length; i < len; i++) {
                    item = leaf[i];
                    isnode = kind === "Node";
                    isservice = kind === "Service";
                    if (isnode)
                        pods = client.hosting("Pod", item.metadata.name);
                    else
                        pods = client.select("Pod", item.metadata.namespace, item.spec.selector);
                    for (key in pods) {

                        /* Don't link pods that aren't running to services */
                        if (isservice && pods[key].status.phase !== "Running")
                            continue;

                        links.push({
                            source: lookup[item.metadata.uid],
                            target: lookup[key],
                            kind: kind,
                        });
                    }
                }
            }

            update();
        }

        function resized() {
            width = outer.node().clientWidth;
            height = window.innerHeight - 15;
            adjust();
        }

        $(window).on('resize', resized);
        resized();

        client.wait(function() {
            all = client.select();
            client.track(all);
            $(all).on("changed", digest);
            digest();
        });


        return {
            close: function() {
                $(window).off('resize', resized);
                client.track(all, false);
                $(all).off();
            }
        };
    }

    return angular.module('kubernetes.topology', [ 'ngRoute', 'kubernetesUI' ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/topology', {
                templateUrl: 'topology.html',
                controller: 'TopologyCtrl'
            });
        }])
        .controller('TopologyCtrl', [
                '$scope',
                'kubernetesClient',
                function($scope, client) {
            $scope.client = client;
            $scope.selected = null;
        }])
        .directive('kubeTopology', [
            'kubernetesClient',
            function(client) {
                return {
                    restrict: 'E',
                    link: function($scope, element, attributes) {
                        function notify(item) {
                            $scope.selected = item;
                            $scope.$digest();
                        }

                        var graph = topology_graph(element[0], client, notify);
                        element.on("$destroy", function() {
                            graph.close();
                        });
                    }
                };
            }
        ]);
});
