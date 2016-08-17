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
    var cockpit = require("cockpit");

    var Mustache = require("mustache");
    var React = require("react");
    var plot = require("plot");
    require("flot");

    var util = require("./util");
    var search_image = require("./search");
    var docker = require("./docker");
    var storage = require("./storage.jsx");
    var bar = require("./bar");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* OVERVIEW PAGE
     */

    function init_overview (client) {

        var danger_enabled = false;

        function set_danger_enabled(val) {
            danger_enabled = val;
            $('#containers-containers button.enable-danger').toggleClass('active', danger_enabled);
            $("#containers-containers td.container-column-actions").toggle(!danger_enabled);
            $("#containers-containers td.container-column-danger").toggle(danger_enabled);
        }

        util.setup_danger_button('#containers-containers', "#containers",
                                 function() {
                                     set_danger_enabled(!danger_enabled);
                                 });

        $('#containers-containers-filter a').on('click', function() {
            var el = $(this);
            $("#containers-containers-filter button span").text(el.text());
            $("#containers-containers table").toggleClass("filter-unimportant", el.attr('value') === "running");
        });

        $('#containers-images-search').on("click", function() {
            search_image(client);
            return false;
        });

        function highlight_container_row(event, selector) {
            $('#containers-containers tr').removeClass('highlight-ct');
            $(selector).addClass('highlight-ct');
        }

        var cpu_data = {
            internal: "cgroup.cpu.usage",
            units: "millisec",
            derive: "rate",
            factor: 0.1  // millisec / sec -> percent
        };

        var cpu_options = plot.plot_simple_template();
        $.extend(cpu_options.yaxis, { tickFormatter: function(v) { return v.toFixed(0); }
                                    });
        $.extend(cpu_options.grid,  { hoverable: true,
                                      autoHighlight: false
                                    });
        cpu_options.setup_hook = function (flot) {
            var axes = flot.getAxes();

            if (axes.yaxis.datamax)
                axes.yaxis.options.max = Math.ceil(axes.yaxis.datamax / 100) * 100;
            else
                axes.yaxis.options.max = 100;

            axes.yaxis.options.min = 0;
        };

        var cpu_plot = plot.plot($("#containers-cpu-graph"), 300);
        cpu_plot.set_options(cpu_options);
        var cpu_series = cpu_plot.add_metrics_stacked_instances_series(cpu_data, { });
        $(cpu_series).on("value", function(ev, value) {
            $('#containers-cpu-text').text(util.format_cpu_usage(value));
        });
        cpu_plot.start_walking();
        $(cpu_series).on('hover', highlight_container_row);

        var mem_data = {
            internal: "cgroup.memory.usage",
            units: "bytes"
        };

        var mem_options = plot.plot_simple_template();
        $.extend(mem_options.yaxis, { ticks: plot.memory_ticks,
                                      tickFormatter: plot.format_bytes_tick_no_unit
                                    });
        $.extend(mem_options.grid,  { hoverable: true,
                                      autoHighlight: false
                                    });
        mem_options.setup_hook = function (flot) {
            var axes = flot.getAxes();
            if (axes.yaxis.datamax < 1.5*1024*1024)
                axes.yaxis.options.max = 1.5*1024*1024;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;

            $("#containers-mem-unit").text(plot.bytes_tick_unit(axes.yaxis));
        };

        var mem_plot = plot.plot($("#containers-mem-graph"), 300);
        mem_plot.set_options(mem_options);
        var mem_series = mem_plot.add_metrics_stacked_instances_series(mem_data, { });
        $(mem_series).on("value", function(ev, value) {
            $('#containers-mem-text').text(cockpit.format_bytes(value, 1024));
        });
        mem_plot.start_walking();
        $(mem_series).on('hover', highlight_container_row);

        $(window).on('resize', function () {
            cpu_plot.resize();
            mem_plot.resize();
        });

        function render_container(id, container) {
            if (container && container.CGroup) {
                cpu_series.add_instance(container.CGroup, "#" + id);
                mem_series.add_instance(container.CGroup, "#" + id);
            }
            util.render_container(client, $('#containers-containers'),
                                  "", id, container, danger_enabled);
        }

        function render_image(id, image) {

            // Docker ID can contain funny characters such as ":" so
            // we take care not to embed them into jQuery query
            // strings or HTML.

            var tr = $(document.getElementById(id));

            if (!image ||
                !image.RepoTags ||
                image.RepoTags[0] == "<none>:<none>") {
                tr.remove();
                return;
            }

            var added = false;
            if (!tr.length) {
                var button = $('<button class="btn btn-default btn-control-ct fa fa-play">')
                    .attr("title", _("Run image"))
                    .attr("data-target", "#containers_run_image_dialog")
                    .attr("data-toggle", "modal")
                    .attr("data-image", id);
                tr = $('<tr>', { 'id': id }).append(
                    $('<td class="image-column-tags">'),
                    $('<td class="image-column-created">'),
                    $('<td class="image-column-size-graph">'),
                    $('<td class="image-column-size-text">'),
                    $('<td class="cell-buttons">').append(button));
                tr.on('click', function(ev) {
                    if (ev.target.tagName !== 'BUTTON')
                        cockpit.location.go([ 'image', id ]);
                });

                added = true;
            }

            var row = tr.children("td");
            $(row[0]).html(util.multi_line(image.RepoTags));

            /* if an image is older than two days, don't show the time */
            var threshold_date = new Date(image.Created * 1000);
            threshold_date.setDate(threshold_date.getDate() + 2);

            if (threshold_date > (new Date())) {
                $(row[1]).text(new Date(image.Created * 1000).toLocaleString());
            } else {
                var creation_date = new Date(image.Created * 1000);

                /* we hide the time, so put full timestamp in the hover text */
                $(row[1])
                    .text(creation_date.toLocaleDateString())
                    .attr("title", creation_date.toLocaleString());
            }

            $(row[2]).children("div").attr("value", image.VirtualSize);
            $(row[3]).text(cockpit.format_bytes(image.VirtualSize, 1024));

            if (added) {
                util.insert_table_sorted($('#containers-images table'), tr);
            }
        }

        $('#containers-containers table tbody tr').remove();
        $('#containers-images table tbody tr').remove();

        /* Every time a container appears, disappears, changes */
        $(client).on('container.containers', function(event, id, container) {
            render_container(id, container);
        });

        /* Every time a image appears, disappears, changes */
        $(client).on('image.containers', function(event, id, image) {
            render_image(id, image);
        });

        var id;
        $("#containers-containers button.enable-danger").toggle(false);
        for (id in client.containers) {
            render_container(id, client.containers[id]);
        }

        for (id in client.images) {
            render_image(id, client.images[id]);
        }

        React.render(React.createElement(storage.OverviewBox,
                                         { model: storage.get_storage_model(),
                                           small: true }),
                     $("#containers-storage-details")[0]);

        function hide() {
            $('#containers').hide();
        }

        function show() {
            $('#containers').show();
            cpu_plot.resize();
            mem_plot.resize();
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        init: init_overview
    };
}());
