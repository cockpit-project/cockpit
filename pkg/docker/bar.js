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

    var $ = require("jquery");

    /* ----------------------------------------------------------------------------
     * Bar Graphs (in table rows)
     *
     * <td>
     *    <div class="bar-row" graph="name" value="50/100"/>
     * </td>
     * <td>
     *    <div class="bar-row" graph="name" value="80"/>
     * </td>
     *
     * The various rows must have class="bar-row". Add the "bar-row-danger"
     * class if you want the bar to show up as a warning (ie: red)
     *
     * The graph="xxx" attribute must for all the bars that are part of the
     * same graph, in order for the rows lengths to be coordinated with one
     * another. Length are based on percentage, so the parent of each
     * div.bar-row must be the same size.
     *
     * value="x" can either be a number, or two numbers separated by a slash
     * the latter one is the limit. Change the attribute on the DOM and the
     * graph should update a short while later.
     *
     * On document creation any div.bar-row are automatically turned into
     * Bar graphs. Or use controls.BarRow('name') constructor.
     *
     * You can also use the el.reflow() function on the element to reflow
     * the corresponding graph.
     */

    function reflow_bar_graph(graph, div) {
        var parts;
        if (graph) {
            var selector = "div.bar-row[graph='" + graph + "']";
            parts = $(selector);
        } else if (div) {
            parts = $(div);
        } else {
            parts = $([]);
        }

        function value_parts(el) {
            var value = $(el).attr('value');
            if (value === undefined)
                return [NaN];
            var values = value.split("/", 2);
            var portion = parseInt(values[0], 10);
            if (values.length == 1)
                return [portion];
            var limit = parseInt(values[1], 10);
            if (!isNaN(limit) && portion > limit)
                portion = limit;
            if (portion < 0)
                portion = 0;
            return [portion, limit];
        }

        /* One pass to calculate the absolute maximum */
        var max = 0;
        parts.each(function() {
            var limit = value_parts(this).pop();
            if (!isNaN(limit) && limit > max)
                max = limit;
        });

        /* Max gets rounded up to the nearest 100 MiB for sets of bar rows
         */
        if (graph) {
            var bound = 100*1024*1024;
            max = max - (max % bound) + bound;
        }

        /* Now resize everything to the right aspect */
        parts.each(function() {
            var bits = value_parts(this);
            var portion = bits.shift();
            var limit = bits.pop();
            if (isNaN(portion) || limit === 0) {
                $(this).css("visibility", "hidden");
            } else {
                var bar_progress = $(this).data('bar-progress');
                if (isNaN(limit)) {
                    bar_progress.addClass("progress-no-limit");
                    limit = portion;
                } else {
                    bar_progress.removeClass("progress-no-limit");
                }
                $(this).css('visibility', 'visible');
                bar_progress.css("width", ((limit / max) * 100) + "%");
                $(this).data('bar-progress-bar').
                    css('width', ((portion / limit) * 100) + "%").
                    toggle(portion > 0);
            }
        });
    }

    var reflow_timeouts = { };
    function reflow_bar_graph_soon(graph, div) {
        if (graph === undefined) {
            if (div)
                graph = $(div).attr("graph");
        }

        /* If no other parts to this bar, no sense in waiting */
        if (!graph) {
            reflow_bar_graph(undefined, div);
            return;
        }

        /* Wait until later in case other updates come in to other bits */
        if (reflow_timeouts[graph] !== "undefined")
            window.clearTimeout(reflow_timeouts[graph]);
        reflow_timeouts[graph] = window.setTimeout(function() {
            delete reflow_timeouts[graph];
            reflow_bar_graph(graph);
        }, 10);
    }

    function setup_bar_graph(div) {

        /*
         * We consume <div class="bar-row"> elements and turn them into:
         *
         * <div class="bar-row">
         *    <div class="progress">
         *      <div class="progress-bar">
         *    </div>
         * </div>
         */
        var progress_bar = $("<div>").addClass("progress-bar");
        var progress = $("<div>").addClass("progress").append(progress_bar);
        $(div).
            addClass('bar-row').
            append(progress).
            data('bar-progress', progress).
            data('bar-progress-bar', progress_bar);

        /* Public API */
        div.reflow = function() {
            reflow_bar_graph(this.getAttribute("graph"), this);
        };

        reflow_bar_graph_soon(undefined, div);
    }

    function setup_bar_graphs() {
        $("div.bar-row").each(function() {
            setup_bar_graph(this, false);
        });
    }

    $(document).ready(setup_bar_graphs);

    /* Public API */
    module.exports = {
        create: function create(graph) {
            var div = $("<div>").addClass('bar-row').attr('graph', graph);
            setup_bar_graph(div);
            return div;
        },
        update: function update() {
            $("div.bar-row").each(function() {
                reflow_bar_graph_soon(this.getAttribute("graph"), this);
            });
        }
    };

}());
