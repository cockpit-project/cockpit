require([
    'jquery',
    'base1/patterns',
], function($) {
    "use strict";

    $(document).ready(function() {
        $("body").show();
    });

    /*
     * When this dialog button is clicked, we show a global failure message
     * that is displayed in the dialog itself.
     */
    $("#error-button").on("click", function() {
        $("#test-dialog").dialog('failure', new Error("This is a global failure message"));
    });

    /*
     * These are failures targetted at specific fields. Note that we set
     * selectors on the target property of the exception. Also note how
     * the .dialog('failure') accepts multiple exceptions as arguments.
     */
    $("#fields-button").on("click", function() {
        var ex1 = new Error("This field is invalid");
        ex1.target = "#control-1";
        var ex2 = new Error("Another problem with this field");
        ex2.target = "#control-2";
        $("#test-dialog").dialog('failure', ex1, ex2);
    });

    /*
     * Clearing the failures in the dialog is done by passing a null
     * exception or no exceptions at all.
     */
    $("#clear-button").on("click", function() {
        $("#test-dialog").dialog('failure', null);
    });

    /*
     * This is an example of a dialog waiting for a promise to complete.
     *
     * If the promise has a .cancel() or .close() method then the Cancel
     * button in the dialog can be used to cancel the operation.
     *
     * In addition if the promise produces progress string information that
     * info will be shown next to the spinner.
     */
    $("#wait-button").on("click", function() {
        $("#test-dialog").dialog('wait', operation());
    });

    /* A mock operation, cancellable with progress */
    function operation() {
        var deferred = $.Deferred();
        var interval, count = 0;
        window.setInterval(function() {
            count += 1;
            deferred.notify("Step " + count);
        }, 500);
        window.setTimeout(function() {
            window.clearTimeout(interval);
            deferred.resolve();
        }, 5000);
        var promise = deferred.promise();
        promise.cancel = function() {
            window.clearTimeout(interval);
            deferred.reject();
        };
        return promise;
    }

    /* Select */

    $("#control-2").on("click", "[value]", function(ev) {
        var target = $(this);
        $("span", ev.delegateTarget).first().text(target.text());
        console.log("value: ", target.attr("value"));
    });

    /* Switches */

    $("#my-switch")
        .onoff("value", true)
        .on("change", function(ev) {
            console.log("switch: " + $(this).onoff('value'));
        });

    $("#my-switch2")
        .onoff()
        .on("change", function(ev) {
            console.log("switch 2: " + $(this).onoff('value'));
        });

    $("#my-switch3").onoff("disabled", true);

    /* Listing clicks */

    $("body")
        .on("click", ".listing-item, .listing-head", function(ev) {
            /* Only proceed if a .btn a li or .timeline was not clicked on */
            if($(ev.target).parents().addBack().filter(".btn, a, li, .timeline").length === 0)
                $(this).parents("tbody").toggleClass("open");
        })
        .on("mouseenter", ".listing-head", function(ev) {
            $(ev.target).parents("tbody").find(".listing-head").addClass("highlight");
        })
        .on("mouseleave", ".listing-head", function(ev) {
            $(ev.target).parents("tbody").find(".listing-head").removeClass("highlight");
        });
});

