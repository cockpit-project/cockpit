import $ from "jquery";
import * as plot from "plot.js";

import "plot.css";

$(function () {
    var plot_direct = new plot.Plot($('#plot_direct'), 300);
    var options_direct = plot.plot_simple_template();
    $.extend(options_direct.yaxis, {
        ticks: plot.memory_ticks,
        tickFormatter: plot.format_bytes_tick_no_unit
    });
    options_direct.post_hook = function memory_post_hook(p) {
        var axes = p.getAxes();
        $('#plot_direct_unit').text(plot.bytes_tick_unit(axes.yaxis));
    };
    plot_direct.set_options(options_direct);
    plot_direct.add_metrics_difference_series({
        direct: [ "mem.physmem", "mem.util.available" ],
        units: "bytes"
    }, { });

    var plot_pmcd = new plot.Plot($('#plot_pmcd'), 300);
    var options_pmcd = plot.plot_simple_template();
    $.extend(options_pmcd.yaxis, {
        ticks: plot.memory_ticks,
        tickFormatter: plot.format_bytes_tick_no_unit
    });
    options_pmcd.post_hook = function memory_post_hook(p) {
        var axes = p.getAxes();
        $('#plot_pmcd_unit').text(plot.bytes_tick_unit(axes.yaxis));
    };
    plot_pmcd.set_options(options_pmcd);
    plot_pmcd.add_metrics_difference_series({
        pmcd: [ "mem.physmem", "mem.util.available" ],
        units: "bytes"
    }, { });

    $("body").show();
    $("#plot_direct").css({ height: "200px" });
    $("#plot_pmcd").css({ height: "200px" });
    plot_direct.resize();
    plot_pmcd.resize();

    var plot_controls = plot.setup_plot_controls($('body'), $('#toolbar'));
    plot_controls.reset([ plot_direct, plot_pmcd ]);
});
