(function() {
    "use strict";

    var $ = require('jquery');
    var cockpit = require('cockpit');

    var unique_number = 0;
    function unique() {
        unique_number += 1;
        return "unique" + -(new Date()) + -unique_number;
    }

    /* Dialog Patterns */

    function clear_errors(sel) {
        sel.find(".dialog-error").remove();
        sel.find(".has-error").removeClass("has-error");
        sel.find(".dialog-wrapper").off(".dialog-error");
        sel.off(".dialog-error");
    }

    function field_error(target, error) {
        var wrapper = target.parent();
        var next, refresh;

        if (!wrapper.is(".dialog-wrapper")) {
            wrapper = $("<div class='dialog-wrapper'>").insertBefore(target);

            /*
             * Some bootstrap plugins replace html controls with their own
             * stuff, so we have to account for that here.
             */

            next = target.next();
            if (next.is(".bootstrap-select") && next.selectpicker) {
                next.remove();
                refresh = next.selectpicker;
            }

            target.remove().appendTo(wrapper);

            if (refresh)
                refresh.call(target);
        }

        var message;
        if (error.message)
            message = $("<div class='dialog-error help-block'>").text(error.message);
        wrapper.addClass("has-error").append(message);

        if (!wrapper.hasClass("error-keep")) {
            wrapper.on("keypress.dialog-error change.dialog-error", function() {
                wrapper.removeClass("has-error")
                    .find(".dialog-error.help-block").css("visibility", "hidden");
            });
        }
    }

    function global_error(sel, error) {
        var alert = $("<div class='alert alert-danger dialog-error'>");
        var text = error.message || error.toString();
        alert.text(text);
        $("<span class='fa fa-exclamation-triangle'>").prependTo(alert);

        /* Always log global dialog errors for easier debugging */
        console.warn(text);

        var footer = sel.find(".modal-footer");
        if (footer.length)
            alert.prependTo(footer);
        else
            alert.appendTo(sel);
    }

    function display_errors(sel, errors) {
        clear_errors(sel);

        /* The list of errors can also be passed as an array */
        if (errors.length == 1 && $.isArray(errors[0]))
            errors = errors[0];

        var any = false;
        errors.forEach(function(error) {
            var target;
            if (error) {
                target = sel.find(error.target);

                /* Errors for a specific field added below that field */
                if (target && target.length)
                    field_error(target, error);
                else
                    global_error(sel, error);

                any = true;
            }
        });

        if (!any)
            return;

        /* When dialog is shown again, remove all mods */
        sel.on("show.bs.modal.dialog-error", function() {
            clear_errors(sel);
        });
    }

    function DialogWait(promise, handle) {
        this.promise = promise;
        this.disabled = [];
        this.handle = handle;
    }

    function clear_wait(sel) {
        var data = sel.data("dialog-wait");
        sel.data("dialog-wait", null);

        sel.find(".dialog-wait-ct").remove();
        sel.find(".btn").off(".dialog-wait");
        sel.off(".dialog-wait");

        if (data) {
            data.disabled.forEach(function(ctl) {
                ctl.removeAttr("disabled");
            });
        }
    }

    function display_wait(sel, promise, handle) {
        clear_wait(sel);

        if (!promise) {
            if (handle)
                sel.modal("hide");
            return sel;
        }

        /* Clear all errors in the dialog */
        if (handle)
            display_errors(sel, []);

        var wait = $("<div class='dialog-wait-ct pull-left'>");
        $("<div class='spinner spinner-sm'>").appendTo(wait);
        var message = $("<span>").appendTo(wait);

        sel.find(".modal-footer button").first().before(wait);

        var data = new DialogWait(promise, handle);
        sel.data("dialog-wait", data);

        var cancellation = promise.cancel || promise.close;
        var cancelled = false;

        /* Disable everything and stash previous disabled state */
        var controls = sel.find(".form-control").add(".btn", sel);
        if (cancellation)
            controls = controls.not("[data-dismiss]").not(".btn-cancel");
        controls.each(function() {
            var ctl = $(this);
            if (!ctl.attr("disabled")) {
                data.disabled.push(ctl);
                ctl.attr("disabled", "disabled");
            }
        });

        sel.find(".btn[data-dismiss], .btn-cancel").on("click.dialog-wait", function() {
            cancelled = true;
            if (cancellation)
                cancellation.apply(promise);
            return false;
        });

        /* When dialog is shown again, remove all mods */
        sel.on("hide.bs.modal.dialog-wait", function() {
            clear_wait(sel);
        });

        /*
         * There is no way to remove a callback from a promise
         * so we have to be careful to only react if still
         * processing the same promise.
         */
        function restore() {
            var state, data = sel.data("dialog-wait");
            if (data && data.promise === promise) {
                clear_wait(sel);
                state = promise.state();
                if (cancelled || (state == "resolved" && data.handle))
                    sel.modal('hide');
                else if (state == "rejected" && data.handle)
                    display_errors(sel, [ arguments[0] ]);
            }
        }

        function update(arg) {
            var data = sel.data("dialog-wait");
            if (data && data.promise === promise) {
                if (typeof arg !== "string")
                    arg = "";
                message.text(arg);
            }
        }

        promise
            .always(restore)
            .progress(update);

        return sel;
    }

    $.fn.dialog = function dialog(action /* ... */) {
        if (action === "failure")
            return display_errors(this, Array.prototype.slice.call(arguments, 1));
        else if (action === "wait")
            return display_wait(this, arguments[1]);
        else if (action === "promise")
            return display_wait(this, arguments[1], true);
        else
            console.warn("unknown dialog action: " + action);
    };

    window.addEventListener("hashchange", function() {
        $(".modal").modal("hide");
    });

    /*
     * OnOff switch pattern
     */

    function onoff_refresh(sel) {
        /* During testing, no Cockpit dependency */
        var _ = cockpit.gettext || function(x) { return x; };

        sel = sel.find(".btn-onoff-ct").andSelf().filter(".btn-onoff-ct");
        sel.each(function(x, el) {
            var self = $(el)
                .attr("data-toggle", "buttons")
                .addClass("btn-group");
            var value = self.onoff("value");
            var buttons = self.find(".btn");
            var name = self.find("input").first().attr("name") || unique();
            var i, input, text;
            for (i = buttons.length; i < 2; i++) {
                input = $('<input type="radio" autocomplete="off">');
                text = document.createTextNode(i === 0 ? _("On") : _("Off"));
                self.append($('<label class="btn">').append(input, text));
                buttons = null;
            }
            buttons = buttons || self.find(".btn");
            buttons.find("input").attr("name", name);
            onoff_change(self, !!value);
        });
        return sel;
    }

    function onoff_value(sel) {
        return sel.find(".btn").first().hasClass("active");
    }

    function onoff_change(sel, value) {
        return sel.each(function(i, el) {
            var buttons = $(el).find(".btn");
            buttons.first().toggleClass("active", !!value).find("input").prop("checked", !!value);
            buttons.last().toggleClass("active", !value).find("input").prop("checked", !value);
        });
    }

    $.fn.onoff = function onoff(action /* ... */) {
        if (arguments.length === 0 || action == "refresh") {
            return onoff_refresh(this);
        } else if (action === "value") {
            if (arguments.length === 1)
                return onoff_value(this);
            else
                return onoff_change(this, arguments[1]);
        } else if (action == "disabled") {
            return this.find(".btn").toggleClass("disabled", arguments[1]);
        } else {
            console.warn("unknown switch action: " + action);
        }
    };

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
     * Bar graphs.
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

    $.fn.slider = function Slider(action) {
        var sel = this;
        var div;
        if (arguments.length === 0 || action == "refresh") {
            sel.each(function() {
                setup_slider(this);
            });
            return sel;
        } else {
            console.warn("unknown slider action: " + action);
        }
    };

    $(document).ready(setup_sliders);

    /* -----------------------------------------------------------------------------
     * Privileged UI actions.
     */

    // placement is optional, "top", "left", "bottom", "right"
    $.fn.update_privileged = function update_privileged(perm, denied_message, placement) {
        var allowed = (perm.allowed !== false);
        var selector = this;

        selector.each(function() {
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

        return selector;
    };
}());
