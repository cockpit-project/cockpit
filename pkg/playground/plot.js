import $ from "jquery";
import * as plot from "plot.js";

import "plot.css";

$(function () {
    var pl = new plot.Plot($('#plot'), 300);
    pl.set_options(plot.plot_simple_template());
    pl.add_metrics_sum_series({ direct: [ "mem.util.used" ], }, { });

    $("body").show();
    $("#plot").css({ height: "200px" });
    pl.resize();

    var plot_controls = plot.setup_plot_controls($('body'), $('#toolbar'));
    plot_controls.reset([ pl ]);
});
