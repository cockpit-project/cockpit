/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

/* global jQuery   */
/* global cockpit  */
/* global _        */
/* global C_       */

var shell = shell || { };

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
 * Bar graphs. Or use shell.BarRow('name') constructor.
 *
 * You can also use the el.reflow() function on the element to reflow
 * the corresponding graph.
 */

(function($, cockpit, shell) {

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

    /* see attrchange.js: http://meetselva.github.io/attrchange/ */
    $(div).attrchange({
        trackValues: false,
        callback: function(event) {
            if (event.attributeName == "graph" ||
                event.attributeName == "value") {
                reflow_bar_graph_soon(this.getAttribute("graph"), this);
            }
        }
    });

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

/* Public API */
shell.BarRow = function BarRow(graph) {
    var div = $("<div>").addClass('bar-row').attr('graph', graph);
    setup_bar_graph(div);
    return div;
};

$(document).ready(setup_bar_graphs);

})(jQuery, cockpit, shell);

/* ----------------------------------------------------------------------------
 * Sliders
 *
 * <div class="slider" value="0.5">
 *    <div class="slider-bar">
 *        <div class="slider-thumb"></div>
 *    </div>
 *    <div class="slider-bar">
 *        <!-- optional left overs -->
 *    </div>
 * </div>
 *
 * A slider control. The first div.slider-bar is the one that is resized.
 * The value will be bounded between 0 and 1 as a floating point number.
 *
 * The following div.slider-bar if present is resized to fill the remainder
 * of the slider if not given a specific size. You can put more div.slider-bar
 * inside it to reflect squashing other prevous allocations.
 *
 * If the following div.slider-bar have a width specified, then the
 * slider supports the concept of overflowing. If the slider overflows
 * it will get the .slider-warning class and go a bit red.
 *
 * On document creation any div.slider are automatically turned into
 * Bar graphs. Or use shell.Slider() constructor.
 *
 * Slider has the following extra read/write properties:
 *
 * .value: the floating point value the slider is set to.
 * .disabled: whether to display slider as disabled and refuse interacton.
 *
 * Slider has this event:
 *
 * on('change'): fired when the slider changes, passes value as additional arg.
 */

(function($, cockpit, shell) {

function resize_flex(slider, flex, total, part) {
    var value = 0;
    if (part > total)
        value = 1;
    else if (part < 0 || isNaN(part))
        value = 0;
    else if (!isNaN(total) && total > 0 && part >= 0)
        value = (part / total);
    $(flex).css('width', (value * 100) + "%").
        next("div").css('margin-left', $(flex).css('width'));

    /* Set the property and the attribute */
    slider.value = value;
}

function update_value(slider) {
    resize_flex(slider, $(slider).children("div.slider-bar").first()[0], 1, slider.value);
}

function check_overflow(slider) {
    $(slider).toggleClass("slider-warning",
                          slider.offsetWidth < slider.scrollWidth);
}

function setup_slider(slider) {
    $(slider).attr('unselectable', 'on');

    Object.defineProperty(slider, "value", {
        get: function() {
            return parseFloat(this.getAttribute("value"));
        },
        set: function(v) {
            var s = String(v);
            if (s != this.getAttribute("value"))
                this.setAttribute("value", v);
        }
    });

    Object.defineProperty(slider, "disabled", {
        get: function() {
            if (!this.hasAttribute("disabled"))
                return false;
            return this.getAttribute("disabled").toLowerCase() != "false";
        },
        set: function(v) {
            this.setAttribute("disabled", v ? "true" : "false");
        }
    });

    update_value(slider);
    check_overflow(slider);

    /* see attrchange.js: http://meetselva.github.io/attrchange/ */
    $(slider).attrchange({
        trackValues: true,
        callback: function(event) {
            if (event.attributeName == "value" && event.oldValue !== event.newValue)
                update_value(slider);
            if (event.attributeName == "disabled")
                $(slider).toggleClass("slider-disabled", slider.disabled);
        }
    });

    if (slider.disabled)
        $(slider).addClass("slider-disabled");

    $(slider).on("mousedown", function(ev) {
        if (slider.disabled)
            return true; /* default action */
        var flex;
        var offset = $(slider).offset().left;
        if ($(ev.target).hasClass("slider-thumb")) {
            var hitx  = (ev.offsetX || ev.clientX - $(ev.target).offset().left);
            offset += (hitx - $(ev.target).outerWidth() / 2);
            flex = $(ev.target).parent()[0];
        } else {
            flex = $(slider).children("div.slider-bar").first()[0];
            resize_flex(slider, flex, $(slider).width(), (ev.pageX - offset));
            $(slider).trigger("change", [slider.value]);
            check_overflow(slider);
        }

        $(document).
            on("mousemove.slider", function(ev) {
                resize_flex(slider, flex, $(slider).width(), (ev.pageX - offset));
                $(slider).trigger("change", [slider.value]);
                check_overflow(slider);
                return false;
            }).
            on("mouseup.slider", function(ev) {
                $(document).
                    off("mousemove.slider").
                    off("mouseup.slider");
                return false;
            });
        return false; /* no default action */
    });
}

function setup_sliders() {
    $("div.slider").each(function() {
        setup_slider(this);
    });
}

/* Public API */
shell.Slider = function Slider() {
    var div = $("<div class='slider'>").
        append($("<div class='slider-bar'>").
            append($("<div class='slider-thumb'>")));
    setup_slider(div);
    return div;
};

$(document).ready(setup_sliders);

/* ----------------------------------------------------------------------------

   On/Off button.

   XXX - not via HTML markup yet, only via JavaScript.
   XXX - Use events, not explicit callbacks.

   When both ON and OFF are given, they are called without arguments
   after the button has changed to the corresponding state.

   When only ON is given, it is called with the new state as the only
   parameter.

   When ROLE_CHECK is specified, it is called before the button
   changes state.  If it returns 'false', the change is declined.
 */

shell.OnOff = function OnOff(val, on, off, role_check, btn_classes) {
    function toggle(event) {
        if (role_check && !role_check())
            return false;

        box.find('.btn').toggleClass('active');
        box.find('.btn').toggleClass('btn-primary');
        box.find('.btn').toggleClass('btn-default');
        if (on_btn.hasClass('active')) {
            if (off)
                on();
            else
                on(true);
        } else {
            if (off)
                off();
            else
                on(false);
        }
        return false;
    }

    var on_btn, off_btn;
    var box =
        $('<div class="btn-group btn-toggle">').append(
            on_btn = $('<button class="btn">').
                text("On").
                addClass(btn_classes).
                addClass(!val? "btn-default" : "btn-primary active").
                click(toggle),
            off_btn = $('<button class="btn">').
                text("Off").
                addClass(btn_classes).
                addClass(val? "btn-default" : "btn-primary active").
                click(toggle));

    box.set = function set(val) {
        (val? on_btn : off_btn).addClass("btn-primary active").removeClass("btn-default");
        (val? off_btn : on_btn).removeClass("btn-primary active").addClass("btn-default");
    };

    box.enable = function enable(val) {
        box.find('button').toggleClass('disabled', !val);
    };

    return box;
};

/*
 * Update the disabled status and tooltip for all
 * elements with the given css class.
 */
shell.update_privileged_ui = function update_privileged_ui(perm, css_class, denied_message) {
    var allowed = (perm.allowed !== false);
    $(css_class).each(function() {
        // preserve old title first time to use when allowed
        // activate tooltip
        var allowed_key = 'allowed-title';
        if (typeof $(this).data(allowed_key) === 'undefined' ||
               $(this).data(allowed_key) === false)
            $(this).data(allowed_key, $(this).attr('title') || "");
            $(this).tooltip({ html: true });

        if ($(this).hasClass("disabled") === allowed) {
          $(this).toggleClass("disabled", !allowed)
               .attr('data-original-title', null);

          if (allowed)
              $(this).attr('title', $(this).data(allowed_key));
          else
              $(this).attr('title', denied_message);
          $(this).tooltip('fixTitle');
        }
    });
};

})(jQuery, cockpit, shell);
