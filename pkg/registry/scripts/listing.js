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

    function in_class_or_tag(el, cls, tag) {
        return (el && el.classList && el.classList.contains(cls)) ||
               (el && el.tagName === tag) ||
               (el && in_class_or_tag(el.parentNode, cls, tag));
    }

    angular.module('registry')

    .directive('listingTable', [
        function() {
            return {
                restrict: 'A',
                link: function(scope, element, attrs) {
                    var selection = { };

                    /* Only view selected items? */
                    scope.only = false;

                    scope.selection = selection;

                    scope.selected = function selected(id) {
                        if (angular.isUndefined(id)) {
                            for (id in selection)
                                return true;
                            return false;
                        } else {
                            return id in selection;
                        }
                    };

                    scope.select = function select(id, ev) {
                        var value;

                        /* Check that either .btn or li were not clicked */
                        if (ev && in_class_or_tag(ev.target, "btn", "li"))
                            return;

                        if (!id) {
                            Object.keys(selection).forEach(function(old) {
                                delete selection[old];
                            });
                            scope.only = false;
                        } else {
                            value = !(id in selection);
                            if (value)
                                selection[id] = true;
                            else
                                delete selection[id];
                        }
                    };
                }
            };
        }
    ])

    .directive('listingPanel', [
        function() {
            return {
                restrict: 'A',
                scope: true,
                link: function(scope, element, attrs) {
                    var tab = 'main';
                    scope.tab = function(name, ev) {
                        if (ev) {
                            tab = name;
                            ev.stopPropagation();
                        }
                        return tab === name;
                    };
                },
                templateUrl: function(element, attrs) {
                    var kind = attrs.kind;
                    return "views/" + kind.toLowerCase() + "-panel.html";
                }
            };
        }
    ]);
}());
