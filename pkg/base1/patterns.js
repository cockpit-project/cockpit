define([
    "jquery"
], function($) {
    var plugins = { };

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
            if (next.is(".bootstrap-select")) {
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

    plugins.dialog = function dialog(action /* ... */) {
        if (action === "failure")
            display_errors(this, Array.prototype.slice.call(arguments, 1));
        else
            console.warn("unknown dialog action: " + action);
    };

    return plugins;
});
