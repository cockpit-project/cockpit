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

    var angular = require('angular');
    require('angular-bootstrap/ui-bootstrap.js');

    var d3 = require('d3');

    var focusedClasses = {
        "chart-focused": true,
        "chart-unfocused": false
    };
    var unfocusedClasses = {
        "chart-focused": false,
        "chart-unfocused": true
    };
    var focusResetClasses = {
        "chart-focused": false,
        "chart-unfocused": false
    };

    function parsePXVal(val) {
        var n;
        if (val)
            n = parseInt(val.slice(0, val.length-2), 10);

        if (!n || isNaN(n))
            n = 0;

        return n;
    }

    function getPadding(el) {
        // May return null on FF when iframe is hidden.
        var style = window.getComputedStyle(el, null);
        if (style) {
            return {
                left: parsePXVal(style.getPropertyValue('padding-left')),
                right: parsePXVal(style.getPropertyValue('padding-right')),
                top: parsePXVal(style.getPropertyValue('padding-top')),
                bottom: parsePXVal(style.getPropertyValue('padding-bottom'))
            };
        } else {
            return {
                left: 0,
                right: 0,
                top: 0,
                bottom: 0
            };
        }
    }

    function getSize(el) {
        var p = getPadding(el);
        var width = el.clientWidth - p.left - p.right;
        var height = el.clientHeight - p.top - p.bottom;

        if (width < 0)
            width = 0;
        if (height < 0)
            height = 0;

        return {
            width: width,
            height: height
        };
    }

    angular.module('ui.charts', [
        'ui.bootstrap',
    ])

    .directive('thresholdHeatMap', [
        "$window",
        "KubeTranslate",
        "$timeout",
        function ($window, translate, $timeout) {
            var _ = translate.gettext;

            return {
                restrict: 'A',
                scope: {
                    data: '=?',
                    legendLabels: '=?',
                    thresholds: '=?',
                    colors: '=?',
                },
                link: function($scope, element, attributes) {
                    var data;
                    var padding = 2;
                    var thresholdDefaults = [0, 0.7, 0.8, 0.9];
                    var heatmapColorDefaults = ['#bbbbbb', '#d4f0fa', '#F9D67A', '#EC7A08', '#CE0000' ];
                    var legendLabelDefaults = [_("Unavailable"), '< 70%', '70-80%', '80-90%', '> 90%'];

                    var maxSize = attributes['maxBlockSize'];
                    if (!maxSize || isNaN(maxSize)) {
                        maxSize = 64;
                    } else {
                        maxSize = parseInt(maxSize, 10);
                        if (maxSize < 5)
                            maxSize = 5;
                        else if (maxSize > 64)
                            maxSize = 64;
                    }

                    if (!$scope.thresholds)
                        $scope.thresholds = thresholdDefaults;

                    if (!$scope.colors)
                        $scope.colors = heatmapColorDefaults;

                    if (!$scope.legendLabels)
                        $scope.legendLabels = legendLabelDefaults;

                    var svg = d3.select(element[0]).append("svg")
                        .classed("heatmap-pf-svg", true)
                        .style("width", "100%");

                    if (attributes['legend'])
                        buildLegend();

                    function getBlockSize(n, x, y) {
                        if (x < 1 || y < 1)
                            return 0;

                        if (n === 0)
                            return maxSize;

                        var px = Math.ceil(Math.sqrt(n * x / y));
                        var py = Math.ceil(Math.sqrt(n * y / x));
                        var sx, sy;

                        if (Math.floor(px * y / x) * px < n)
                            sx = y / Math.ceil(px * y / x);
                        else
                            sx = x / px;

                        if (Math.floor(py * x / y) * py < n)
                            sy = x / Math.ceil(x * py / y);
                        else
                            sy = y / py;

                        return Math.max(sx, sy);
                    }

                    function getSizeInfo() {
                        var length = data ? data.length : 0;
                        var size = getSize(element[0]);
                        var h = size.height;
                        var w = size.width;

                        var rows;

                        var blockSize = getBlockSize(length, w, h);
                        if ((blockSize - padding) > maxSize) {
                            blockSize = padding + maxSize;

                            // Attempt to square off the area, check if square fits
                            rows = Math.ceil(Math.sqrt(length));
                            if (blockSize * rows > w ||
                                blockSize * rows > h) {
                                rows = (blockSize === 0) ? 0 : Math.floor(h / blockSize);
                            }

                        } else {
                            rows = (blockSize === 0) ? 0 : Math.floor(h / blockSize);
                        }
                        return {
                            rows: rows,
                            block: blockSize
                        };
                    }

                    function buildLegend() {
                        var colors = $scope.colors.slice(0);
                        var labels = $scope.legendLabels.slice(0);

                        labels.reverse();
                        colors.reverse();

                        var legend = d3.select("#" + attributes['legend'])
                            .append('ul').classed('chart-legend', true);

                        var li = legend.selectAll("li").data(labels);

                        var newLi = li.enter().append("li")
                            .classed('chart-legend-item', true)
                            .on("mouseover", function(d, i) {
                                var color = colors[i];
                                var rsel = "rect[data-color='" + color + "']";
                                var lsel = "li[data-color='" + color + "']";

                                legend.selectAll("li").classed(unfocusedClasses);
                                legend.select(lsel).classed(focusedClasses);

                                svg.selectAll("rect").classed(unfocusedClasses);
                                svg.selectAll(rsel).classed(focusedClasses);
                            })
                            .on("mouseout", function (d, i) {
                               svg.selectAll("rect").classed(focusResetClasses);
                               legend.selectAll("li").classed(focusResetClasses);
                            });

                        newLi.append("span")
                            .classed('legend-pf-color-box', true);

                        newLi.append("span")
                            .classed('legend-pf-text', true);

                        li.attr("data-color", function (d, i) {
                            return colors[i];
                        });

                        li.select("span.legend-pf-color-box")
                            .style("background-color", function (d, i) {
                                return colors[i];
                            });

                        li.select("span.legend-pf-text")
                            .text(function (d) {
                                return d;
                            });
                    }

                    function getcolor(d, colorFunc) {
                        var value = d;
                        if (d && d.value !== undefined)
                            value = d.value;

                        if (isNaN(value))
                            value = -1;

                        return colorFunc(value);
                    }

                    function refresh() {
                        var colorFunc = d3.scale.threshold()
                            .domain($scope.thresholds)
                            .range($scope.colors);

                        var size = getSizeInfo();
                        if (!data)
                            data = [ ];

                        var fillSize = size.block - padding;
                        if (fillSize < 1)
                            return;

                        svg.attr("height", size.block * size.rows);
                        var blocks = svg.selectAll('rect').data(data);

                        blocks.enter().append('rect')
                            .on("mouseover", function(d, i) {
                                svg.selectAll('rect').classed(unfocusedClasses);
                                d3.select(this).classed(focusedClasses);
                            })
                            .on("mouseout", function (d, i) {
                                svg.selectAll('rect').classed(focusResetClasses);
                            })
                            .append("title");

                        blocks
                            .attr('x', function (d, i) {
                                return Math.floor(i / size.rows) * size.block;
                            })
                            .attr('y', function (d, i) {
                                return i % size.rows * size.block;
                            })
                            .attr('width', fillSize)
                            .attr('height', fillSize)
                            .attr('data-color', function (d) {
                                return getcolor(d, colorFunc);
                            })
                            .style('fill', function (d) {
                                return getcolor(d, colorFunc);
                            })
                            .on('click', function (d) {
                                if (d && d.name)
                                    $scope.$emit("boxClick", d.name);
                            })
                            .select("title").text(function(d) {
                               return d.tooltip;
                            });

                        blocks.exit().remove();
                    }

                    $scope.$watchCollection('data', function(newValue) {
                        data = newValue;
                        refresh();
                    });

                    angular.element($window).bind('resize', function () {
                        refresh();
                    });

                    $scope.$watch(
                        function () {
                            return [element[0].offsetWidth, element[0].offsetHeight].join('x');
                        },
                        function (value) {
                            refresh();
                        }
                    );
                }
            };
        }
    ])

    .directive('donutPctChart', [
        "$window",
        function ($window) {

            return {
                restrict: 'A',
                scope: {
                    data: '=?',
                    largeTitle: '=?',
                    smallTitle: '=?',
                },
                link: function($scope, element, attributes) {
                    var arc, selectedArc, data;
                    var colors = d3.scale.category20();

                    var pie = d3.layout.pie().value(function (d) {
                        if (typeof d === 'object')
                            return d.value;
                        else
                            return d;
                    });

                    var legend;
                    if (attributes['legend']) {
                        legend = d3.select("#"+attributes['legend'])
                            .append('ul').classed('chart-legend', true);
                    }

                    var svg = d3.select(element[0]).append("svg");
                    svg.style("width", "100%");
                    svg.style("height", "100%");

                    var g = svg.append("g");
                    g.append('text').attr('class', "chart-title");

                    function updateSize() {
                        var size = getSize(element[0]);
                        var width = size.width;
                        var height = size.height;
                        var c, radius = Math.min(width, height) / 2;
                        var barSize = parseInt(attributes['barSize'], 10);
                        if (isNaN(barSize))
                            barSize = 20;

                        if ((barSize * 2) > radius)
                            barSize = radius;

                        arc = d3.svg.arc()
                            .innerRadius(radius - (barSize * 2))
                            .outerRadius(radius - barSize);

                        selectedArc = d3.svg.arc()
                                        .innerRadius(radius - (barSize * 2))
                                        .outerRadius(radius - (barSize - 2));

                        c = (radius - barSize - 2) * 2;
                        g.attr('data-innersize', Math.sqrt((c * c) / 2));
                        updateTitle();

                        g.attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");
                        refresh();
                    }

                    function calFontSize() {
                        /* jshint validthis:true */
                        var width = this.getComputedTextLength();
                        var inner = parseInt(g.attr("data-innersize"), 10);
                        var style = window.getComputedStyle(this, null);
                        var size, ratio;

                        if (style && width) {
                            size = style.getPropertyValue('font-size');
                            ratio = inner / width;
                        } else {
                            width = 0;
                        }

                        if (!isNaN(inner) && width > inner)
                            return "calc(" + size + " * " + ratio + ")";
                    }

                    function updateTitle() {
                        var title = g.select('text.chart-title');
                        var size = parseInt(g.attr("data-innersize"), 10);
                        if (isNaN(size))
                            return;

                        title.selectAll('tspan').remove();
                        if ($scope.largeTitle) {
                            title.insert('tspan').text($scope.largeTitle)
                                .classed('donut-title-big-pf', true)
                                .attr('dy', 0).attr('x', 0)
                                .style("font-size", calFontSize);
                        }

                        if ($scope.smallTitle) {
                            title.insert('tspan').text($scope.smallTitle)
                                .classed('donut-title-small-pf', true)
                                .attr('dy', 20).attr('x', 0)
                                .style("font-size", calFontSize);
                        }
                    }

                    function select(id) {
                        var sel = "path[data-id='" + id + "']";
                        var lsel = "li[data-id='" + id + "']";
                        g.selectAll("path").classed(unfocusedClasses);

                        g.select(sel).attr("d", function (d, i) {
                            return selectedArc(d, i);
                        });
                        g.select(sel).classed(focusedClasses);

                        if (legend) {
                            legend.selectAll("li").classed(unfocusedClasses);
                            legend.select(lsel).classed(focusedClasses);
                        }
                    }

                    function unselect() {
                       g.selectAll("path")
                          .classed(focusResetClasses)
                          .attr("d", arc);
                        if (legend) {
                            legend.selectAll("li")
                                .classed(focusResetClasses);
                        }
                    }

                    function refreshLegend() {
                        var li = legend.selectAll("li").data(data);

                        var newLi = li.enter().append("li")
                            .classed('chart-legend-item', true)
                            .on("mouseover", function() {
                                select(this.getAttribute('data-id'));
                            })
                            .on("mouseout", unselect);

                        newLi.append("span").classed('legend-pf-color-box', true);
                        newLi.append("span").classed('legend-pf-text', true);

                        li.attr("data-id", function (d, i) {
                                return i;
                            });

                        li.select("span.legend-pf-color-box")
                            .style("background-color", function (d, i) {
                                if (d && d.color)
                                    return d.color;
                                else
                                    return colors(i);
                            });

                        li.select("span.legend-pf-text")
                            .text(function (d) {
                                if (d && d.label)
                                    return d.label;
                                else
                                    return d;
                            });

                        li.exit().remove();
                    }

                    function refresh() {
                        if (!data)
                            data = [];

                        var path = g.selectAll("path")
                            .data(pie(data));

                        path.enter().append("path")
                            .on("mouseover", function(i) {
                                select(this.getAttribute('data-id'));
                            })
                            .on("mouseout", unselect)
                            .append("title");

                        path.attr("fill", function(d, i) {
                                if (d.data && d.data.color)
                                    return d.data.color;
                                else
                                    return colors(i);
                            })
                            .attr("d", arc)
                            .attr("data-id", function (d, i) {
                                return i;
                            })
                            .select("title").text(function(d) {
                               if (d.data && d.data.tooltip)
                                   return d.data.tooltip;
                            });

                        path.exit().remove();

                        if (legend)
                            refreshLegend();
                    }

                    $scope.$watchCollection('data', function(newValue) {
                        data = newValue;
                        refresh();
                    });

                    /* Watch the selection for changes */
                    $scope.$watchGroup(["largeTitle", "smallTitle"], function() {
                        updateTitle();
                    });

                    angular.element($window).bind('resize', function () {
                        updateSize();
                    });

                    $scope.$watch(
                        function () {
                            return [element[0].offsetWidth, element[0].offsetHeight].join('x');
                        },
                        function (value) {
                            updateSize();
                        }
                    );
                }
            };
        }
    ]);
}());
