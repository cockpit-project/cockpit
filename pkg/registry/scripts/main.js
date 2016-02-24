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
        'registry.projects',
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
        'kubeSelect',
        'cockpitKubeDiscover',
        function($scope, $location, $rootScope, $timeout, loader, select, discover) {
            $scope.settings = {
                registry: {
                    host: "hostname"
                }
            };

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
                var parts, namespace = loader.limits.namespace;
                if (angular.isArray(namespace))
                    namespace = null;
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
                discover().then(function(options) {
                    $scope.curtains = null;
                    $scope.settings.registry.password = null;

                    /* See if we have a bearer token to use */
                    var authorization, pos;
                    if (options.headers) {
                        authorization = (options.headers['Authorization'] || "").trim();
                        if (authorization.toLowerCase().indexOf("bearer ") === 0)
                            $scope.settings.registry.password = authorization.substr(7).trim();
                    }

                    visible();
                }, function(resp) {
                    $scope.curtains = { status: resp.status, message: resp.message || resp.statusText };
                    $scope.settings.registry.password = null;

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

            /*
             * HACK: Because we don't have access to the information
             * about the docker-registry Route, we cannot lookup its
             * hostname information. So for now lets just look at an
             * image stream.
             */
            var discoverHost = function() {
                var host = null;
                angular.forEach(select().kind("ImageStream"), function(stream) {
                    var repo, status = stream.status || {};
                    if (!host) {
                        repo = status.dockerImageRepository || "";
                        host = repo.split("/")[0];
                    }
                });
                return host;
            };

            /* When the loader changes digest */
            loader.listen(function() {
                var host;

                if (discoverHost) {
                    host = discoverHost();
                    if (host) {
                        $scope.settings.registry.host = host;
                        discoverHost = null;
                    }
                }

                $rootScope.$applyAsync();
            });
        }
    ])

    .directive('filterBar', [
        'kubeLoader',
        'kubeSelect',
        'filterService',
        function(loader, select, filter) {
            return {
                restrict: 'E',
                scope: true,
                link: function(scope, element, attrs) {
                    scope.filter =  filter;
                },
                templateUrl: 'views/filter-bar.html'
            };
        }
    ])

    .factory('filterService', [
        'kubeLoader',
        'kubeSelect',
        '$route',
        '$rootScope',
        function(loader, select, $route, $rootScope) {
            /*
             * We have the following cases to account for:
             *
             * Openshift:
             *  - Have Project objects
             *  - Project objects are listable by any user, only accessilbe returned
             *  - Project objects are not watchable
             *
             * Kubernetes and Openshift
             *  - Namespace objects are only accessible to all users
             */

            var globals = true;

            loader.watch("namespaces")
                .catch(function() {
                    globals = false;
                    loadNamespace($route.current);
                });

            loader.load("projects");

            /*
             * When either a Namespace or Project is loaded we'll want to reinterpret
             * how we look at the current namespace. This helps to handle cases where
             * the user can't see all projects, and one is loaded.
             */
            loader.listen(function(present) {
                var link, added, object;
                for (link in present) {
                    object = present[link];
                    if (object.kind == "Namespace" || object.kind == "Project") {
                        loadNamespace($route.current);
                        return;
                    }
                }
            });

            function calcAvailable() {
                var all;
                if (globals)
                    all = select().kind("Namespace");
                if (!all || all.length === 0)
                    all = select().kind("Project");

                var link, meta, ret = [];
                for (link in all) {
                    meta = all[link].metadata || { };
                    if (meta.name)
                        ret.push(meta.name);
                }

                return ret;
            }

            function loadNamespace(route) {
                var value = route.params["namespace"] || null;

                /*
                 * When we can't see globals, we tell the loader about
                 * all namespaces that we can see. It'll open up individual
                 * watches about those namespaces.
                 */
                if (value === null && !globals)
                    value = calcAvailable();

                if (!angular.equals(value, loader.limit.namespaces))
                    loader.limit({ namespace: value });
            }

            $rootScope.$on("$routeChangeSuccess", function (event, current, prev) {
                loadNamespace(current);
            });

            loadNamespace($route.current);

            return {
                namespaces: calcAvailable,
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
