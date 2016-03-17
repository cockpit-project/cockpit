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

    angular.module('kubernetes.app', [
        'ui.bootstrap',
        'kubeClient',
        'kubeClient.cockpit'
    ])

    .controller('MainCtrl', [
        '$scope',
        '$location',
        '$rootScope',
        '$timeout',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        'filterService',
        function($scope, $location, $rootScope, $timeout, loader, select, discoverSettings, filter) {
            $scope.settings = { };

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
                        return "/?namespace=" + encodeURIComponent(namespace);
                    else
                        return "/";
                } else {
                    parts = [ segment ];
                    if (namespace)
                        parts.push(namespace);
                    return "/" + parts.map(encodeURIComponent).join("/");
                }
            };

            /* Used while debugging */
            $scope.console = console;

            /* Show the body when ready */
            function visible() {
                document.getElementsByTagName("body")[0].removeAttribute("hidden");
            }

            /* Show after some seconds whether ready or not */
            $timeout(visible, 3000);

            /* Curtains related logic */
            function connect(force) {
                $scope.curtains = { };
                discoverSettings(force).then(function(settings) {
                    $scope.settings = settings;
                    $scope.curtains = null;
                    filter.globals(settings.isAdmin);
                    filter.load().then(visible);
                }, function(resp) {
                    $scope.curtains = { status: resp.status, message: resp.message || resp.statusText };
                    $scope.settings = null;
                    visible();
                });
            }

            /* Connect automatically initially */
            connect();

            /* Used by reconnect buttons */
            $scope.reconnect = function() {
                discoverSettings(true);
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
        'filterService',
        function(filter) {
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

    .directive('filterProject', [
        'filterService',
        function(filter) {
            return {
                restrict: 'E',
                scope: true,
                link: function(scope, element, attrs) {
                    scope.filter =  filter;
                },
                templateUrl: 'views/filter-project.html'
            };
        }
    ])

    .factory('filterService', [
        '$q',
        '$route',
        '$rootScope',
        'kubeLoader',
        'kubeSelect',
        'KubeDiscoverSettings',
        function($q, $route, $rootScope, loader, select, discoverSettings) {
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
             *
             * The globals variable is set based on this.
             */

            var globals = true;

            var promise = discoverSettings().then(function(settings) {
                var ret;
                if (settings.flavor === "openshift")
                    ret = loader.load("projects");
                if (settings.isAdmin)
                    ret = loader.watch("namespaces");
                return ret || $q.when([]);
            });

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
                var value = null;
                if (route)
                    value = route.params["namespace"] || null;

                /*
                 * When we can't see globals, we tell the loader about
                 * all namespaces that we can see. It'll open up individual
                 * watches about those namespaces.
                 */
                if (value === null && !globals) {
                    value = calcAvailable();
                    /* We might not be global, but the projects may not
                     * be loaded yet */
                    if (value.length < 1)
                        value = null;
                }

                if (!angular.equals(value, loader.limit.namespaces)) {
                    loader.limit({ namespace: value });
                }
            }

            $rootScope.$on("$routeChangeSuccess", function (event, current, prev) {
                loadNamespace(current);
            });

            $rootScope.$on("$routeUpdate", function (event, current, prev) {
                loadNamespace(current);
            });

            if ($route.current)
                loadNamespace($route.current);

            return {
                load: function() {
                    return promise;
                },
                globals: function(value) {
                    if (arguments.length === 0)
                        return globals;
                    value = !!value;
                    if (globals !== value) {
                        globals = value;
                        loadNamespace($route.current);
                    }
                },
                namespaces: calcAvailable,
                namespace: function(value) {
                    if (arguments.length === 0)
                        return $route.current.params["namespace"];
                    var copy = angular.copy($route.current.params);
                    copy["namespace"] = value || undefined;
                    copy["target"] = null;
                    $route.updateParams(copy);
                }
            };
        }
    ])

    /* The default orderBy filter doesn't work on objects */
    .filter('orderObjectBy', function() {
        return function(items, field) {
            var i, sorted = [];
            for (i in items)
                sorted.push(items[i]);
            if (!angular.isArray(field))
                field = [ String(criteria) ];
            var criteria = field.map(function(v) {
                return v.split('.');
            });
            function value(obj, x) {
                return obj ? obj[x] : undefined;
            }
            sorted.sort(function(a, b) {
                var ra, rb, i, len = criteria.length;
                for (i = 0; i < len; i++) {
                    ra = criteria[i].reduce(value, a);
                    rb = criteria[i].reduce(value, b);
                    if (ra === rb)
                        continue;
                    return (ra > rb ? 1 : -1);
                }
                return 0;
            });
            return sorted;
        };
    })

    .filter("formatBytes", [
        "KubeFormat",
        function(format) {
        return function(num) {
            if (typeof num == "number")
                return format.formatBytes(num);
            return num;
        };
    }]);

}());
