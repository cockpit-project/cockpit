import $ from "jquery";
import * as plot from "plot.js";

import "plot.css";

$(function () {
    var pl = new plot.Plot($('#plot'), 300);
    var options = plot.plot_simple_template();
    $.extend(options.yaxis, {
        ticks: plot.memory_ticks,
        tickFormatter: plot.format_bytes_tick_no_unit
    });
    options.post_hook = function memory_post_hook(p) {
        var axes = p.getAxes();
        $('#plot_unit').text(plot.bytes_tick_unit(axes.yaxis));
    };

    pl.set_options(options);
    pl.add_metrics_difference_series({
        direct: [ "mem.physmem", "mem.util.available" ],
        units: "bytes"
    }, { });

    $("body").show();
    $("#plot").css({ height: "200px" });
    pl.resize();

    var plot_controls = plot.setup_plot_controls($('body'), $('#toolbar'));
    plot_controls.reset([ pl ]);
});
