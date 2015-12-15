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

    angular.module('openshift.images', [
        'ngRoute',
        'kubeClient',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/images', {
                templateUrl: 'views/images-page.html',
                controller: 'ImagesCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .controller('ImagesCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        function($scope, loader, select) {

            /* nothing here yet */
            loader.watch("images");
            $scope.images = function() {
                return select().kind("Image");
            };
        }
    ]);

}());
