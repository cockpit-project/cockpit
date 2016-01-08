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
        'registry.images',
        'openshift.projects',
        'kubeClient',
        'kubeClient.cockpit'
    ])

    .config([
        '$routeProvider',
        'KubeWatchProvider',
        'KubeRequestProvider',
        function($routeProvider, KubeWatchProvider, KubeRequestProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });

            /* Tell the kube-client code to use cockpit watches and requests */
            KubeWatchProvider.KubeWatchFactory = "CockpitKubeWatch";
            KubeRequestProvider.KubeRequestFactory = "CockpitKubeRequest";
        }
    ])

    .controller('MainCtrl', [
        '$scope',
        '$location',
        '$rootScope',
        '$timeout',
        'kubeLoader',
        'cockpitKubeDiscover',
        function($scope, $location, $rootScope, $timeout, loader, discover) {

            /* Used to set detect which route is active */
            $scope.viewActive = function(segment) {
                var url = $location.url() || "/";
                var parts = url.split('?')[0].split("/");
                if (!segment && !parts[1])
                    return true;
                if (segment === parts[1])
                    return true;
                return false;
            };

            /* Used to build simple route URLs */
            $scope.viewUrl = function(segment) {
                var parts, namespace = loader.namespace();
                if (!segment) {
                    if (namespace)
                        return "#/?namespace=" + encodeURIComponent(namespace);
                    else
                        return "#/";
                } else {
                    parts = [ segment ];
                    if (namespace)
                        parts.push(namespace);
                    return "#/" + parts.map(encodeURIComponent).join("/");
                }
            };

            /* Used while debugging */
            $scope.console = console;

            /* Show the body when ready */
            function visible() {
                document.getElementsByTagName("body")[0].removeAttribute("hidden");
            }

            /* Show after some seconds whether ready or not */
            $timeout(visible, 1000);

            /* Curtains related logic */
            function connect() {
                $scope.curtains = { };
                loader.watch("namespaces").then(function() {
                    $scope.curtains = null;
                    visible();
                }, function(resp) {
                    $scope.curtains = { status: resp.status, message: resp.message || resp.statusText };
                    visible();
                });
            }

            /* Connect automatically initially */
            connect();

            /* Used by reconnect buttons */
            $scope.reconnect = function() {
                discover(true);
                loader.reset();
                connect();
            };

            /* When the loader changes digest */
            loader.listen(function() {
                $rootScope.$applyAsync();
            });
        }
    ])

    .directive('filterBar', [
        'kubeLoader',
        'kubeSelect',
        'filterService',
        function(loader, select, filter) {
            loader.watch("namespaces");
            return {
                restrict: 'E',
                scope: true,
                link: function(scope, element, attrs) {
                    scope.filter =  filter;
                    scope.namespaces = function namespaces() {
                        return select().kind("Namespace");
                    };
                },
                templateUrl: 'views/filter-bar.html'
            };
        }
    ])

    .factory('filterService', [
        'kubeLoader',
        '$route',
        '$rootScope',
        function(loader, $route, $rootScope) {
            function loadNamespace(route) {
                var value = route.params["namespace"] || null;
                if (value !== loader.namespace())
                    loader.namespace(value);
            }

            $rootScope.$on("$routeChangeSuccess", function (event, current, prev) {
                loadNamespace(current);
            });

            loadNamespace($route.current);

            return {
                namespace: function(value) {
                    if (arguments.length === 0)
                        return $route.current.params["namespace"];
                    var copy = angular.copy($route.current.params);
                    copy["namespace"] = value || "";
                    copy["target"] = null;
                    $route.updateParams(copy);
                }
            };
        }
    ]);

}());
