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

    angular.module('registry', [
        'ngRoute',
        'ui.bootstrap',
        'registry.dashboard',
        'openshift.images',
        'openshift.projects',
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });
        }
    ])

    .controller('MainCtrl', [
        '$scope',
        '$route',
        function($scope, $route) {

            /* Used to set detect which route is active */
            $scope.is_active = function is_active(template) {
                var current = $route.current;
                return current && current.loadedTemplateUrl === template;
            };

            /* Used while debugging */
            $scope.console = console;
        }
    ]);

}());
