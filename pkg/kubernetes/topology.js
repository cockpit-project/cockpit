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
        var lookup = { };

        /* Kinds of objects to show */
        var kinds = null;

        var force = d3.layout.force()
            .charge(-800)
            .gravity(0.2)
            .linkDistance(80);

        var drag = force.drag();

        var svg = outer.append("svg").attr("class", "kube-topology");

        var node = d3.select();
        var link = d3.select();

        force.on("tick", function() {
            link.attr("x1", function(d) { return d.source.x; })
                .attr("y1", function(d) { return d.source.y; })
                .attr("x2", function(d) { return d.target.x; })
                .attr("y2", function(d) { return d.target.y; });

            node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
        });

        drag
            .on("dragstart", function(d) {
                notify(d);
                svg.selectAll("g").classed("selected", false);
                d3.select(this).classed("selected", true);

                if (d.fixed !== true)
                    d.floatpoint = [ d.x, d.y ];
                d.fixed = true;
                d3.select(this).classed("fixed", true);
            })
            .on("dragend", function(d) {
                var moved = true;
                if (d.floatpoint) {
                    moved = (d.x < d.floatpoint[0] - 5 || d.x > d.floatpoint[0] + 5) ||
                            (d.y < d.floatpoint[1] - 5 || d.y > d.floatpoint[1] + 5);
                    delete d.floatpoint;
                }
                d.fixed = moved && d.x > 3 && d.x < (width - 3) && d.y >= 3 && d.y < (height - 3);
                d3.select(this).classed("fixed", d.fixed);
            });

        svg
            .on("dblclick", function() {
                svg.selectAll("g")
                    .classed("fixed", false)
                    .each(function(d) { d.fixed = false; });
            })
            .on("click", function(ev) {
                if (!d3.select(d3.event.target).datum()) {
                    notify(null);
                    svg.selectAll("g").classed("selected", false);
                }
            });

        function adjust() {
            force.size([width, height]);
            svg.attr("width", width).attr("height", height);
            update();
        }

        function update() {
            link = svg.selectAll("line")
                .data(links);

            link.exit().remove();
            link.enter().insert("line", ":first-child");

            link.attr("class", function(d) { return d.kind; });

            node = svg.selectAll("g")
                .data(nodes, function(d) { return d.metadata.uid; })
                .classed("weak", is_weak);

            node.exit().remove();

            var group = node.enter().append("g")
                .attr("class", function(d) { return d.kind; })
                .classed("weak", is_weak)
                .call(drag);

            group.append("circle")
                .attr("r", 15);
            group.append("text")
                .attr("y", 6)
                .text(function(d) { return icons[d.kind]; });
            group.append("title")
                .text(function(d) { return d.metadata.name; });

            /* HACK: around broken fonts */
            group.selectAll("g.ReplicationController > text")
                .attr("dy", "1");

            force
                .nodes(nodes)
                .links(links)
                .start();
        }

        function digest() {
            var pnodes = nodes;
            var plookup = lookup;

            /* The actual data for the graph */
            nodes = [];
            links = [];
            lookup = { };

            /* Items we're going to use for links */
            var leaves = { "Service": [], "Node": [], "ReplicationController": [] };

            var i, len, item, key, leaf, kind, pods, old;
            var items = all.items || [];
            for (i = 0, len = items.length; i < len; i++) {
                item = items[i];

                key = item.metadata.uid;
                kind = item.kind;

                /* Requesting to only show certain kinds */
                if (kinds && kinds.indexOf(kind) === -1)
                    continue;

                leaf = leaves[kind];

                if (leaf) {

                    /* Prevents flicker */
                    old = pnodes[plookup[key]];
                    if (old) {
                        item.x = old.x;
                        item.y = old.y;
                        item.px = old.px;
                        item.py = old.py;
                        item.fixed = old.fixed;
                        item.weight = old.weight;
                    }

                    leaf.push(item);

                } else if (kind !== "Pod") {
                    continue;
                }

                lookup[key] = nodes.length;
                nodes.push(item);
            }

            var isnode, isservice, s, t;
            for (kind in leaves) {
                leaf = leaves[kind];
                for (i = 0, len = leaf.length; i < len; i++) {
                    item = leaf[i];
                    isnode = kind === "Node";
                    isservice = kind === "Service";
                    if (isnode)
                        pods = client.hosting("Pod", item.metadata.name);
                    else
                        pods = client.select("Pod", item.metadata.namespace, item.spec.selector || { });
                    for (key in pods) {
                        s = lookup[item.metadata.uid];
                        t = lookup[key];
                        if (s === undefined || t === undefined)
                            continue;

                        /* Don't link pods that aren't running to services */
                        if (isservice && is_weak(pods[key]))
                            continue;

                        links.push({ source: s, target: t, kind: kind, });
                    }
                }
            }

            update();
        }

        function is_weak(d) {
            if (d.status && d.status.phase && d.status.phase !== "Running")
                return true;
            return false;
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
            kinds: function(value) {
                kinds = value;
                digest();
            },
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

            $scope.kinds = [ "Service", "Pod", "ReplicationController", "Node" ];
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
                        graph.kinds($scope.kinds);

                        $scope.$watchCollection("kinds", function(value) {
                            graph.kinds(value);
                        });

                        element.on("$destroy", function() {
                            graph.close();
                        });
                    }
                };
            }
        ])

        .directive('kubeTopologyKind',
            function() {
                return {
                    restrict: 'E',
                    link: function($scope, element, attrs) {
                        var kind = attrs.kind;

                        var svg = d3.select(element[0]).append("svg")
                            .attr("width", "32")
                            .attr("height", "32")
                            .attr("class", "kube-topology");

                        var g = svg.append("g")
                            .attr("class", kind)
                            .attr("transform", "translate(16, 16)");

                        g.append("circle").attr("r", "15");

                        /* HACK around broken font, will be fixed when we use real icons */
                        var offset = kind == "ReplicationController" ? "7.5": "6";
                        g.append("text").attr("y", offset).text(icons[kind]);

                        $scope.$watchCollection("kinds", function() {
                            var have = $scope.kinds.indexOf(kind) !== -1;
                            svg.classed("active", have);
                        });

                        svg.on("click", function() {
                            var pos = $scope.kinds.indexOf(kind);
                            if (pos === -1)
                                $scope.kinds.push(kind);
                            else
                                $scope.kinds.splice(pos, 1);
                            $scope.$parent.$digest();
                        });
                    }
                };
            }
        );
});
