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
    require('angular-route');
    require('angular-gettext/dist/angular-gettext.js');
    require('angular-bootstrap-npm/dist/angular-bootstrap.js');

    require('./app');
    require('./date');
    require('./images');
    require('./projects');
    require('./policy');
    require('./kube-client');
    require('./kube-client-cockpit');

    require('../views/registry-dashboard-page.html');

    var MAX_RECENT_STREAMS = 15;
    var MAX_RECENT_TAGS = 8;

    angular.module('registry', [
        'ngRoute',
        'ui.bootstrap',
        'ui.bootstrap.popover',
        'gettext',
        'kubernetes.app',
        'kubernetes.date',
        'registry.images',
        'registry.projects',
        'registry.policy',
        'registryUI.date',
        'kubeClient',
        'kubeClient.cockpit'
    ])

    .config([
        '$routeProvider',
        'KubeWatchProvider',
        'KubeRequestProvider',
        'KubeDiscoverSettingsProvider',
        'MomentLibProvider',
        '$provide',
        function($routeProvider, KubeWatchProvider, KubeRequestProvider,
                 KubeDiscoverSettingsProvider, MomentLibProvider, $provide) {

            $routeProvider
                .when('/', {
                    templateUrl: 'views/registry-dashboard-page.html',
                    controller: 'DashboardCtrl',
                    reloadOnSearch: false,
                })
                .otherwise({ redirectTo: '/' });

            /* Tell the kube-client code to use cockpit watches and requests */
            KubeWatchProvider.KubeWatchFactory = "CockpitKubeWatch";
            KubeRequestProvider.KubeRequestFactory = "CockpitKubeRequest";
            KubeDiscoverSettingsProvider.KubeDiscoverSettingsFactory = "cockpitKubeDiscoverSettings";
            MomentLibProvider.MomentLibFactory = "momentLib";

            $provide.decorator("$exceptionHandler",
                ['$delegate',
                 '$log',
                 function($delegate, $log) {
                    return function (exception, cause) {
                        /* Displays an oops if we're running in cockpit */
                        if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
                            window.parent.postMessage("\n{ \"command\": \"oops\" }", "*");

                        $delegate(exception, cause);
                    };
              }]);
        }
    ])

    .controller('DashboardCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        'imageData',
        'imageActions',
        'projectActions',
        'projectData',
        'projectPolicy',
        'filterService',
        function($scope, loader, select, discoverSettings, imageData, imageActions, projectActions, projectData, projectPolicy, filter) {
            loader.load("projects");
            /* Watch the for project access changes */
            projectPolicy.watch($scope);

            /*
             * For now the dashboard  has to watch all images in
             * order to display the 'Images pushed recently' data
             *
             * In the future we want to have a metadata or filtering
             * service that we can query for that data.
             */
            imageData.watchImages($scope);

            function compareVersion(a, b) {
                a = (a.metadata || { }).resourceVersion || 0;
                b = (b.metadata || { }).resourceVersion || 0;
                return b - a;
            }
            function compareCreated(a, b) {
                a = a.items && a.items[0] || {};
                b = b.items && b.items[0] || {};
                a = a.created || "";
                b = b.created || "";
                return (b < a ? -1 : (b > a ? 1 : 0));
            }

            select.register("buildRecentStreams", function() {
                var link, array = [];
                for (link in this)
                    array.push(this[link]);
                array.sort(compareVersion);
                array.splice(MAX_RECENT_STREAMS);

                var result = [];
                var status, tags, stream, i, len, total;
                for (i = 0, len = array.length; i < len; i++) {
                    stream = array[i];

                    status = stream.status || { };
                    tags = (status.tags || []).slice();
                    tags.sort(compareCreated);
                    total = tags.length;
                    tags.splice(MAX_RECENT_TAGS);

                    if (tags.length > 0)
                        result.push({ stream: stream, tags: tags, truncated: total > tags.length });
                }

                return result;
            });

            function setShowDockerPushCommands(visible) {
                if (visible != $scope.showDockerPushCommands) {
                    $scope.showDockerPushCommands = visible;
                    $scope.$applyAsync();
                }
            }

            function updateShowDockerPushCommands() {
                var ns = filter.namespace();

                if (ns) {
                    discoverSettings().then(function(settings) {
                        projectPolicy.subjectAccessReview(ns, settings.currentUser, 'update', 'imagestreamimages')
                           .then(setShowDockerPushCommands);
                    });
                } else {
                    // no current project, always show push commands; too expensive to iterate through all projects
                    setShowDockerPushCommands(true);
                }
            }

            // watch for project changes to update showDockerPushCommands, and initialize it
            $scope.$on("$routeUpdate", updateShowDockerPushCommands);
            updateShowDockerPushCommands();

            $scope.createProject = projectActions.createProject;
            $scope.createImageStream = imageActions.createImageStream;
            $scope.sharedImages = projectData.sharedImages;

            $scope.recentlyUpdated = function recentlyUpdated() {
                return select().kind("ImageStream").buildRecentStreams();
            };

            $scope.projects = function projects() {
                return select().kind("Project").statusPhase("Active");
            };

            $scope.filter = filter;
        }
    ]);

}());
