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

    require('../views/user-panel.html');
    require('../views/service-panel.html');
    require('../views/pod-panel.html');
    require('../views/route-panel.html');
    require('../views/pv-panel.html');
    require('../views/default-panel.html');
    require('../views/node-panel.html');
    require('../views/project-panel.html');
    require('../views/container-panel.html');
    require('../views/deploymentconfig-panel.html');
    require('../views/group-panel.html');
    require('../views/replicationcontroller-panel.html');

    function inClassOrTag(el, cls, tag) {
        return (el && el.classList && el.classList.contains(cls)) ||
               (el && el.tagName === tag) ||
               (el && inClassOrTag(el.parentNode, cls, tag));
    }

    angular.module('kubernetes.listing', [])

            .directive('listingTable', [
                function() {
                    return {
                        restrict: 'A',
                        link: function(scope, element, attrs) {
                        }
                    };
                }
            ])

            .factory('ListingState', [
                function() {
                    return function ListingState(scope) {
                        var self = this;
                        var data = { };

                        self.selected = { };
                        self.enableActions = false;

                        /* Check that either .btn or li were not clicked */
                        function checkBrowserEvent(ev) {
                            return !(ev && inClassOrTag(ev.target, "btn", "li"));
                        }

                        self.hasSelected = function hasSelected(id) {
                            return !angular.equals({}, self.selected);
                        };

                        self.expanded = function expanded(id) {
                            if (angular.isUndefined(id)) {
                                for (id in data)
                                    return true;
                                return false;
                            } else {
                                return id in data;
                            }
                        };

                        self.toggle = function toggle(id, ev) {
                            var value;
                            if (self.enableActions) {
                                ev.stopPropagation();
                                return;
                            }

                            if (id) {
                                value = !(id in data);
                                if (value)
                                    self.expand(id, ev);
                                else
                                    self.collapse(id, ev);
                            }
                        };

                        self.expand = function expand(id, ev) {
                            data[id] = true;
                            if (ev)
                                ev.stopPropagation();
                        };

                        self.activate = function activate(id, ev) {
                            if (checkBrowserEvent(ev)) {
                                if (self.expanded(id))
                                    self.collapse(id);
                                else
                                    scope.$emit("activate", id);
                            }
                        };

                        self.collapse = function collapse(id, ev) {
                            if (id) {
                                delete data[id];
                            } else {
                                Object.keys(data).forEach(function(old) {
                                    delete data[old];
                                });
                            }
                            if (ev)
                                ev.stopPropagation();
                        };
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
