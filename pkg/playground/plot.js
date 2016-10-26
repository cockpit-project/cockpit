var $ = require("jquery");
var plot = require("plot");

require("plot.css");

var pl = plot.plot($('#plot'), 300);
pl.set_options(plot.plot_simple_template());
pl.add_metrics_sum_series({ direct: [ "mem.util.used" ]
                                }, { });
$(function () {
    $("body").show();
    pl.resize();

    var plot_controls = plot.setup_plot_controls($('body'), $('#toolbar'));
    plot_controls.reset([ pl ]);
});
