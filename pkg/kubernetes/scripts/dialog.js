/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

(function() {
    "use strict";

    var angular = require('angular');
    require('angular-bootstrap/ui-bootstrap.js');

    angular.module('ui.cockpit', [
        'ui.bootstrap',
    ])

    /*
     * Implements a <modal-dialog> directive that works with ui-bootstrap's
     * $modal service. Implements Cockpit dialog HIG behavior.
     *
     * This dialog treats a button with .btn-cancel class as a cancel
     * button. Clicking it will dismiss the dialog or (see below) cancel
     * a completion promise.
     *
     * From inside the dialog, you can invoke the following methods on
     * the scope:
     *
     * failure(ex)
     * failure([ex1, ex2])
     *
     * Displays errors either globally or on fields. The ex.message or
     * ex.toString() is displayed as the failure message. If ex.target
     * is a valid CSS selector, then the failure message will be displayed
     * under the selected field.
     *
     * failure()
     * failure(null)
     *
     * Clears all failures from display.
     *
     * complete(promise)
     * complete(data)
     *
     * Complete the dialog. If a promise is passed, then the dialog will
     * enter into a wait state until the promise completes. If promise resolves
     * then the dialog will be closed with the resolve value. If the promise
     * rejects, then failures will be displayed by invoking failure() above.
     *
     * While the promise is completing, all .form-control and .btn will
     * be disabled. If promise.cancel() is a method, then the .btn-cancel
     * will remain clickable, and clicking it will cancel the promise, and
     * when the promise completes, will dismiss the dialog.
     */
    .directive('modalDialog', [
        "$q",
        function($q) {
            return {
                restrict: 'E',
                transclude: true,
                template: '<ng-transclude></ng-transclude>',
                link: function(scope, element, attrs) {
                    var state = null;

                    function detach() {
                        if (state)
                            state.detach();
                        state = null;
                    }

                    scope.complete = function(thing) {
                        detach();
                        if (!thing || !thing.then)
                            thing = $q(thing);
                        state = new DialogState(element, thing, scope);
                    };

                    scope.failure = function(/* ... */) {
                        var errors;
                        var n = arguments.length;
                        if (n === 0) {
                            errors = null;
                        } else if (n === 1) {
                            errors = arguments[0];
                        } else {
                            errors = [];
                            errors.push.apply(errors, arguments);
                        }

                        if (!errors) {
                            detach();
                            return;
                        }

                        var defer = $q.defer();
                        defer.reject(errors);
                        scope.complete(defer.promise);
                    };

                    /* Dialog cancellation before promises kick in */
                    function dismissDialog() {
                        scope.$dismiss();
                    }

                    var cancel = queryFirst(element, ".btn-cancel");
                    cancel.on("click", dismissDialog);
                    scope.$on("$routeChangeStart", dismissDialog);

                    scope.$on("$destroy", function() {
                        cancel.off("click", dismissDialog);
                        detach();
                    });
                },
            };
        }
    ]);

    function queryAll(element, selector) {
        var list, result = [];
        var j, i, jlen, len = element.length;
        for (i = 0; i < len; i++) {
            list = element[i].querySelectorAll(selector);
            if (list) {
                for (j = 0, jlen = list.length; j < jlen; j++)
                    result.push(list[i]);
            }
        }
        return angular.element(result);
    }

    function queryFirst(element, selector) {
        var result = null;
        var i, len = element.length;
        for (i = 0; !result && i < len; i++)
            result = element[i].querySelector(selector);
        return angular.element(result);
    }

    /*
     * This state object handles one of three different states.
     * This does not exist in the case "before" these states are relevant.
     *
     * state = null: pending
     * state = true: succeeded
     * state = false: failed
     */
    function DialogState(element, promise, scope) {
        var state = null;
        var result = null;

        /* Set to true when cancel was requested */
        var cancelled = false;
        var detached = false;

        /* The wait field elements */
        var disabled = [];
        var wait = angular.element("<div class='dialog-wait-ct pull-left'>");
        wait.append(angular.element("<div class='spinner spinner-sm'>"));
        var notify = angular.element("<span>");
        wait.append(notify);

        this.detach = detachState;

        if (!promise) {
            detachState();
            return;
        }

        promise.then(function(data) {
            result = data;
            if (promise)
                changeState(true);
        }, function(data) {
            result = data;
            if (promise)
                changeState(false);
        }, function(data) {
            if (promise)
                notifyWait(data);
        });

        window.setTimeout(function() {
            if (promise && scope && state === null) {
                changeState(null);
                scope.$digest();
            }
        }, 0);

        function changeState(value) {
            if (detached)
                return;
            state = value;
            if (cancelled) {
                scope.$dismiss();
                return;
            } else if (state === null) {
                clearErrors();
                displayWait();
            } else if (state === true) {
                clearErrors();
                scope.$close(result); /* Close dialog */
            } else if (state === false) {
                clearWait();
                displayErrors(result);
            } else {
                console.warn("invalid dialog state", state);
            }
        }

        function detachState() {
            scope = null;
            promise = null;
            clearErrors();
            clearWait();
        }

        function displayErrors(errors) {
            clearErrors();

            if (!angular.isArray(errors))
                errors = [errors];
            errors.forEach(function(error) {
                var target = null;
                /* Each error can have a target field */
                if (error.target)
                    target = queryFirst(element, error.target);
                if (target && target[0])
                    fieldError(target, error);
                else
                    globalError(error);
            });
        }

        function globalError(error) {
            var alert = angular.element("<div class='alert alert-danger dialog-error'>");
            alert.text(error.message || error.toString());
            alert.prepend(angular.element("<span class='fa fa-exclamation-triangle'>"));

            var wrapper = queryFirst(element, ".modal-footer");
            if (wrapper.length)
                wrapper.prepend(alert);
            else
                element.append(alert);
        }

        function fieldError(target, error) {
            var message = angular.element("<div class='dialog-error help-block'>");
            message.text(error.message || error.toString());
            var wrapper = target.parent();
            wrapper.addClass("has-error");
            target.after(message);
            wrapper.on("keypress change", handleClear);
        }

        function handleClear(ev) {
            var target = ev.target;
            /* jshint validthis:true */
            while (target !== this) {
                clearError(angular.element(target));
                target = target.parentNode;
            }
        }

        function clearError(target) {
            var wrapper = target.parent();
            queryAll(wrapper, ".dialog-error").remove();
            wrapper.removeClass("has-error");
            wrapper.off("keypress change", handleClear);
        }

        function clearErrors() {
            var messages = queryAll(element, ".dialog-error");
            angular.forEach(messages, function(message) {
                clearError(angular.element(message));
            });
        }

        function handleCancel(ev) {
            if (promise.cancel)
                promise.cancel();
            cancelled = true;
            ev.stopPropagation();
            ev.preventDefault();
            return false;
        }

        function notifyWait(data) {
            var message = data.message || data;
            if (typeof message == "string" || typeof message == "number")
                notify.text(message);
            else if (!message)
                notify.text("");
        }

        function clearWait() {
            var control;
            while (true) {
                control = disabled.pop();
                if (!control)
                    break;
                control.removeAttr("disabled");
            }
            wait.remove();
            queryFirst(element, ".btn-cancel").off("click", handleCancel);
        }

        function displayWait() {
            clearWait();

            /* Insert the wait area */
            queryFirst(element, ".modal-footer").prepend(wait);

            /* Disable everything and stash previous disabled state */
            function disable(el) {
                var control = angular.element(el);
                if (control.attr("disabled") ||
                    promise.cancel && control.hasClass("btn-cancel"))
                    return;
                disabled.push(control);
                control.attr("disabled", "disabled");
            }

            angular.forEach(queryAll(element, ".form-control"), disable);
            angular.forEach(queryAll(element, ".btn"), disable);

            queryFirst(element, ".btn-cancel").on("click", handleCancel);
        }
    }

}());
