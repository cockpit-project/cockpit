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

/* globals d3 */

(function() {
    "use strict";


    function layer_graph(selector, options) {
        var outer = d3.select(selector);

        /* Data we've been fed */
        var layers = [ ];
        var settings = {
            height: 125,
            width: null,
            bar: 14,
            gap: 2,
            max: 90,
            title: "Image layers",
        };

        var timeout;
        var scale = null;
        var selection;
        var width;

        var svg = outer.append("svg")
            .attr("class", "image-layers")
            .on("click", function() {
                var datum = d3.select(d3.event.target).datum() || { id: null };
                select(datum.id);
            });

        var label = svg.append("text")
            .attr("class", "label");
        var title = svg.append("text")
            .attr("text-anchor", "end")
            .attr("y", "1em");

        var line = svg.append("polyline")
            .attr("class", "line");

        function select(id) {
            if (id === null)
                return;

	    selection = id;

            var value = "";
            var index = null;

            svg.selectAll("g")
                .classed("selected", function(d, i) {
                    if (d.id === id) {
                        value = d.label;
                        index = i;
                        return true;
                    }
                    return false;
                });

            label
                .text(value)
                .attr("y", settings.height);

            var y = settings.max + 15;
            var points = [];
            points.push("0," + y);
            if (index !== null) {
                points.push((index * settings.bar) + "," + y);
                points.push(((index * settings.bar) + (settings.bar / 2)) + "," + (y - 5));
                points.push(((index + 1) * settings.bar) + "," + y);
            }
            points.push(width + "," + y);
            line.attr("points", points.join(" "));
        }

        function digest() {
            timeout = null;

            width = settings.width;
            if (width === null)
                width = outer.node().clientWidth;

            svg
                .attr("width", width)
                .attr("height", settings.height);

            var max = d3.max(layers, function(d) { return d.size; });
            scale = d3.scale.linear()
                .domain([0, max])
                .range([2, settings.max]);

            var bar = svg.selectAll("g")
                .data(layers)
            .enter().append("g")
                .attr("transform", function(d, i) {
                    return "translate(" + i * settings.bar + ",0)";
                });

            bar.append("rect")
                .attr("class", "layer")
                .attr("x", settings.gap)
                .attr("y", function(d) { return scale(max - d.size); })
                .attr("width", settings.bar - (settings.gap * 2))
                .attr("height", function(d) { return scale(d.size); });
            bar.append("rect")
                .attr("class", "column")
                .attr("width", settings.bar)
                .attr("height", scale(max) + 15);

            title
                .text(settings.title)
                .attr("x", width - 5);

            select(selection);
        }

        function resized() {
	    window.clearTimeout(timeout);
	    timeout = window.setTimeout(digest, 150);
        }

        window.addEventListener('resize', resized);

        digest();
        resized();

        return {
	    data: function(new_layers, options) {
                if (!new_layers)
                    new_layers = [];
                layers = new_layers.slice();
                layers.reverse();
                if (selection === undefined && layers.length)
                    selection = layers[0].id;
                angular.extend(settings, options);
                digest();
            },
            close: function() {
	        window.removeEventListener('resize', resized);
                window.clearTimeout(timeout);
            }
        };
    }

    function configDiff(layer, lower) {
        var x, ret = { };
        for (x in layer) {
            if (!angular.equals(layer[x], lower[x]))
                ret[x] = layer[x];
        }
        return ret;
    }

    function v1CompatibilityLabel(layer, lower) {
        var cmd, last;
        if (layer.v1Compatibility.container_config) {
            cmd = layer.v1Compatibility.container_config.Cmd;
            if (cmd) {
                last = cmd[cmd.length - 1];
                if (last.indexOf("#(nop)") === 0)
                    return last.substring(6);
            }
        }

        return layer.v1Compatibility.id;
    }

    function prepareLayer(layer, index, layers) {
        /* DockerImageManifest */
        if (layer.v1Compatibility) {
            return {
                id: layer.v1Compatibility.id,
                size: layer.v1Compatibility.Size || 0,
                label: v1CompatibilityLabel(layer, layers[index + 1])
            };

        /* DockerImageLayers */
        } else if (layer.name && layer.size) {
            return {
                id: layer.name,
                size: layer.size || 0,
                label: layer.name,
            };

        /* Unsupported layer type */
        } else {
            return {
                size: 0,
                id: index,
                label: "Unknown layer",
            };
        }
    }

    return angular.module('registry.layers', [])

    .directive('imageLayers', [
        function() {
            return {
                restrict: 'E',
                scope: {
                    layers: '=',
                    settings: '=',
                    prevent: '=',
                },
                link: function($scope, element, attributes) {
                    element.css("display", "block");

                    var outer = angular.element("<div/>");
                    element.append(outer);

                    var graph;

                    function update(layers, settings) {
                        if (layers && layers.length)
                            layers = layers.map(prepareLayer);
                        graph.data(layers, settings);
                    }

                    $scope.$watchCollection('[layers, settings]', function(values) {
                        if (graph)
                            update(values[0], values[1] || { });
                    });

                    $scope.$watch("prevent", function(prevent) {
                        if (!prevent && !graph) {
                            graph = layer_graph(outer[0]);
                            update($scope.layers, $scope.settings || { });
                        }
                    });

                    element.on("$destroy", function() {
                        graph.close();
                    });
                }
            };
        }
    ]);

}());
