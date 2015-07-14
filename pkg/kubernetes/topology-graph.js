/* DO NOT EDIT. Automatically generated file */
/* jshint ignore:start */
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

(function(root, factory) {
    if (typeof(define) === 'function' && define.amd)
        define(["base1/angular", "./d3" ], factory);
    else
        factory(root.angular, root.d3);
}(this, function(angular, d3) {
    "use strict";

    /* A cache to prevent jumping when rapidly toggling views */
    var cache = { };

    function topology_graph(selector, notify) {
        var outer = d3.select(selector);

        /* Kinds of objects to show */
        var kinds = null;

        /* Data we've been fed */
        var items = { };
        var relations = [ ];

        /* Graph information */
        var width;
        var height;
        var timeout;
        var nodes = [];
        var links = [];
        var lookup = { };
        var selection = null;

        var force = d3.layout.force()
            .charge(-800)
            .gravity(0.2)
            .linkDistance(80);

        var drag = force.drag();

        var svg = outer.append("svg")
            .attr("viewBox", "0 0 1600 1200")
            .attr("preserveAspectRatio", "xMidYMid meet")
            .attr("class", "kube-topology");

        var vertices = d3.select();
        var edges = d3.select();

        force.on("tick", function() {
            edges.attr("x1", function(d) { return d.source.x; })
                 .attr("y1", function(d) { return d.source.y; })
                 .attr("x2", function(d) { return d.target.x; })
                 .attr("y2", function(d) { return d.target.y; });

            vertices.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
        });

        drag
            .on("dragstart", function(d) {
                notify(d.item);

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
                force.start();
            })
            .on("click", function(ev) {
                if (!d3.select(d3.event.target).datum()) {
	            notify(null);
                }
            });

        function select(item) {
	    selection = item;
            svg.selectAll("g")
                .classed("selected", function(d) { return d.item === item; });
        }

        function icon(d) {
	    var text;
	    if (kinds)
		text = kinds[d.item.kind];
	    return text || "";
	}

        function weak(d) {
	    var status = d.item.status;
            if (status && status.phase && status.phase !== "Running")
                return true;
            return false;
        }

        function adjust() {
            timeout = null;
            width = outer.node().clientWidth;
            height = outer.node().clientHeight;

            force.size([width, height]);
            svg.attr("viewBox", "0 0 " + width + " " + height);
            update();
        }

        function update() {
            edges = svg.selectAll("line")
                .data(links);

            edges.exit().remove();
            edges.enter().insert("line", ":first-child");

            edges.attr("class", function(d) { return d.kinds; });

            vertices = svg.selectAll("g")
                .data(nodes, function(d) { return d.id; })
                .classed("weak", weak);

            vertices.exit().remove();

            var group = vertices.enter().append("g")
                .attr("class", function(d) { return d.item.kind; })
                .classed("weak", weak)
                .call(drag);

            group.append("use")
                .attr("xlink:href", icon);
            group.append("title")
                .text(function(d) { return d.item.metadata.name; });

            select(selection);

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

            var item, id, kind, node;
            for (id in items) {
                item = items[id];
                kind = item.kind;

                if (kinds && !kinds[kind])
                    continue;

                /* Prevents flicker */
                node = pnodes[plookup[id]];
                if (!node) {
                    node = cache[id];
                    delete cache[id];
                    if (!node)
                        node = { };
                }

                node.id = id;
                node.item = item;

                lookup[id] = nodes.length;
                nodes.push(node);
            }

            var i, len, relation, s, t;
            for (i = 0, len = relations.length; i < len; i++) {
                relation = relations[i];

                s = lookup[relation.source];
                t = lookup[relation.target];
                if (s === undefined || t === undefined)
                    continue;

                links.push({ source: s, target: t, kinds: nodes[s].item.kind + nodes[t].item.kind });
            }

            if (width && height)
                update();
        }

        function resized() {
	    window.clearTimeout(timeout);
	    timeout = window.setTimeout(adjust, 150);
        }

        window.addEventListener('resize', resized);

        adjust();
        resized();

        return {
            select: select,
            kinds: function(value) {
                if (arguments.length === 0)
                    return kinds;
                kinds = value;
                digest();
            },
	    data: function(new_items, new_relations) {
                if (arguments.length === 0)
                    return [items, relations];
                items = new_items || { };
                relations = new_relations || [];
                digest();
            },
            close: function() {
	        window.removeEventListener('resize', resized);
                window.clearTimeout(timeout);

                /*
                 * Keep the positions of these items cached,
                 * in case we are asked to make the same graph again.
                 */
                var id, node;
                cache = { };
                for (id in lookup) {
                  node = nodes[lookup[id]];
                  delete node.item;
                  cache[id] = node;
                }

                nodes = [ ];
                lookup = { };
            }
        };
    }

    /* The kubernetesUI component is quite loosely bound, define if it doesn't exist */
    try { angular.module("kubernetesUI"); } catch(e) { angular.module("kubernetesUI", []); }

    return angular.module('kubernetesUI')
        .directive('kubernetesTopologyGraph', [
            function() {
                return {
                    restrict: 'E',
                    scope: {
                        items: '=',
                        relations: '=',
                        kinds: '=',
                        selection: '='
                    },
                    link: function($scope, element, attributes) {
                        element.css("display", "block");

                        function notify(item) {
                            $scope.$emit("select", item);
                            if (!("selection" in attributes))
	                        graph.select(item);
                        }

                        var graph = topology_graph(element[0], notify);
                        graph.kinds($scope.kinds);

                        /* If there's a kinds in the current scope, watch it for changes */
                        $scope.$watchCollection("kinds", function(value) {
                            graph.kinds(value);
                        });

                        $scope.$watchGroup(["items", "relations"], function(values) {
                            graph.data(values[0], values[1]);
                        });

                        /* Watch the selection for changes */
                        $scope.$watch("selection", function(item) {
                            graph.select(item);
                        });

                        element.on("$destroy", function() {
                            graph.close();
                        });
                    }
                };
            }
        ])

        .directive('kubernetesTopologyIcon',
            function() {
                return {
                    restrict: 'E',
	            transclude: true,
                    template: "<ng-transclude></ng-transclude>",
                    link: function($scope, element, attrs) {
                        var kind = attrs.kind;
                        var icon = $scope.kinds[kind];

                        $scope.$watchCollection("kinds", function() {
                            element.toggleClass("active", kind in $scope.kinds);
                        });

                        element.on("click", function() {
                            if (kind in $scope.kinds) {
	                        icon = $scope.kinds[kind];
                                delete $scope.kinds[kind];
                            } else {
                                $scope.kinds[kind] = icon;
                            }
                            if ($scope.$parent)
	                        $scope.$parent.$digest();
	                    $scope.$digest();
                        });
                    }
                };
            }
        );
}));

/* jshint ignore:end */
