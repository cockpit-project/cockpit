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

define([
    "jquery",
], function($) {
"use strict";

var module = { };

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
 * Bar graphs. Or use controls.Slider() constructor.
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

    $(slider).on("change", function() {
        update_value(slider);
        $(slider).toggleClass("slider-disabled", slider.disabled);
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
module.Slider = function Slider() {
    var div = $("<div class='slider'>").
        append($("<div class='slider-bar'>").
            append($("<div class='slider-thumb'>")));
    setup_slider(div[0]);
    return div;
};

$(document).ready(setup_sliders);

// placement is optional, "top", "left", "bottom", "right"
module.update_privileged_ui = function update_privileged_ui(perm, selector, denied_message, placement) {
    var allowed = (perm.allowed !== false);
    $(selector).each(function() {
        // preserve old title first time to use when allowed
        // activate tooltip
        var allowed_key = 'allowed-title';
        if (typeof $(this).data(allowed_key) === 'undefined' ||
               $(this).data(allowed_key) === false)
            $(this).data(allowed_key, $(this).attr('title') || "");

        var options = { html: true };
        if (placement)
            options['placement'] = placement;

        $(this).tooltip(options);

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

return module;
});
