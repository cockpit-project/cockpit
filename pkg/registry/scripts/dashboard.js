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

    angular.module('registry.dashboard', [
        'ngRoute',
        'ui.cockpit',
        'registry.images',
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'views/dashboard-page.html',
                controller: 'DashboardCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .controller('DashboardCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'projectActions',
        'imageData',
        'filterService',
        function($scope, loader, select, projectActions, imageData, filterService) {
            loader.load("projects");
            loader.watch("users");
            loader.watch("groups");

            /*
             * For now the dashboard  has to watch all images in
             * order to display the 'Images pushed recently' data
             *
             * In the future we want to have a metadata or filtering
             * service that we can query for that data.
             */
            imageData.watchImages();

            var c = loader.listen(function() {
                $scope.projects = select().kind("Project");
                $scope.users = select().kind("Project");
                $scope.groups = select().kind("Group");
                $scope.images = select().kind("Image");
                $scope.imagestreams = select().kind("ImageStream");
            });

            $scope.$on("$destroy", function() {
                c.cancel();
            });

            $scope.createProject = projectActions.createProject;
        }
    ]);

}());
