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

/* globals cockpit */

(function() {
    "use strict";

    var angular = require('angular');

    require('../views/image-layers.html');

    function v1CompatibilityLabel(layer, lower) {
        var cmd, last;
        if (layer.v1Compatibility.container_config) {
            cmd = layer.v1Compatibility.container_config.Cmd;
            if (cmd) {
                last = cmd[cmd.length - 1];
                if (last.indexOf("#(nop)") === 0)
                    return last.substring(6).trim();
                else if (cmd.length == 1 && cmd[0].indexOf("/bin/sh -c #(nop)") === 0)
                    return cmd[0].substring(17).trim();
                else
                    return cmd.join(" ");
            }
        }

        return layer.v1Compatibility.id;
    }

    function prepareLayer(layer, index, layers) {
        var result;
        /* DockerImageManifest */
        if (layer.v1Compatibility) {
            result = {
                id: layer.v1Compatibility.id,
                size: layer.v1Compatibility.Size || 0,
                label: v1CompatibilityLabel(layer, layers[index + 1])
            };

        /* DockerImageLayers */
        } else if (layer.name && layer.size) {
            result = {
                id: layer.name,
                size: layer.size || 0,
                label: layer.name,
            };

        /* Unsupported layer type */
        } else {
            result = {
                size: 0,
                id: index,
                label: "Unknown layer",
            };
        }

        /* Some hints for coloring the display */
        if (result.label.indexOf("RUN ") === 0)
            result.hint = "run";
        else if (result.label.indexOf("ADD ") === 0 || result.size > 8192)
            result.hint = "add";
        else
            result.hint = "other";

        return result;
    }

    return angular.module('registry.layers', [])

    .directive('imageLayers', [
        function() {
            return {
                restrict: 'E',
                scope: {
                    data: '=layers',
                },
                templateUrl: 'views/image-layers.html',
                link: function($scope, element, attributes) {

                    $scope.formatSize = function(bytes) {
                        if (!bytes)
                            return "";
                        else if (bytes > 1024 && typeof cockpit != "undefined")
                            return cockpit.format_bytes(bytes);
                        else
                            return bytes + " B";
                    };

                    $scope.$watch('data', function(layers) {
                        if (layers && layers.length)
                            layers = layers.map(prepareLayer).reverse();
                        $scope.layers = layers;
                    });
                }
            };
        }
    ]);

}());
