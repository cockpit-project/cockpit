define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {
    "use strict";

    var _ = cockpit.gettext;

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
        if (error.message) {
            message = $("<div class='dialog-error help-block'>").text(error.message);
            wrapper.addClass("has-error").append(message);
        }

        wrapper.on("keypress.dialog-error change.dialog-error", function() {
            wrapper.removeClass("has-error")
                .find(".dialog-error.help-block").css("visibility", "hidden");
        });
    }

    function global_error(sel, error) {
        var alert = $("<div class='alert alert-danger dialog-error'>");
        alert.text(error.message || error.toString());
        $("<span class='fa fa-exclamation-triangle'>").prependTo(alert);

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

        sel.find(".dialog-wait").remove();
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

        var wait = $("<div class='dialog-wait pull-left'>");
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
            controls = controls.not("[data-dismiss]");
        controls.each(function() {
            var ctl = $(this);
            if (!ctl.attr("disabled")) {
                data.disabled.push(ctl);
                ctl.attr("disabled", "disabled");
            }
        });

        sel.find(".btn[data-dismiss]").on("click.dialog-wait", function() {
            cancelled = true;
            if (cancellation)
                cancellation.apply(promise);
            return false;
        });

        /* When dialog is shown again, remove all mods */
        sel.on("show.bs.modal.dialog-wait", function() {
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

    /*
     * OnOff switch pattern
     */

    function onoff_refresh(sel) {
        sel = sel.find(".btn-onoff").andSelf().filter(".btn-onoff");
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
});
