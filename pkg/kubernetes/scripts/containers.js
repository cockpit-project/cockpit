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
    require('angular-dialog.js');
    require('./kube-client');
    require('./listing');

    require('kubernetes-container-terminal/dist/container-terminal.js');

    var phantom_checkpoint = phantom_checkpoint || function () { };

    angular.module('kubernetes.containers', [
        'ngRoute',
        'ui.cockpit',
        'kubernetesUI',
        'kubeClient',
        'kubernetes.listing'
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/pods/:pod_namespace/:pod_name/:container_name', {
                    templateUrl: 'views/container-page.html',
                    controller: 'ContainerCtrl'
                })
                .when('/pods/:pod_namespace/:pod_name', {
                    redirectTo: '/pods'
                })
                .when('/pods/:pod_namespace?', {
                    templateUrl: 'views/containers-page.html',
                    controller: 'ContainersCtrl'
                });
        }
    ])

    /*
     * The controller for the containers view.
     */
    .controller('ContainersCtrl', [
        '$scope',
        'KubeContainers',
        'kubeLoader',
        'kubeSelect',
        'ListingState',
        '$routeParams',
        '$location',
        function($scope, containers, loader, select, ListingState, $routeParams, $location) {

            var selector = {};
            var qs = $location.search();
            for (var key in qs) {
                if (key !== "namespace")
                    selector[key] = qs[key];
            }

            loader.listen(function() {
                var pods = select().kind("Pod");
                if ($routeParams.pod_namespace)
                    pods.namespace($routeParams.pod_namespace);
                if (!angular.equals({}, selector))
                    pods.label(selector);

                $scope.pods = pods;
            }, $scope);

            loader.watch("Pod", $scope);

            $scope.listing = new ListingState($scope);

            $scope.containers = containers;

            $scope.$on("activate", function(ev, id) {
                ev.preventDefault();
                $location.path(id);
            });

            $scope.should_mask = function(name) {
                return name.toLowerCase().indexOf("password") !== -1;
            };
        }
    ])

    /*
     * The controller for the containers view.
     */
    .controller('ContainerCtrl', [
        '$scope',
        'KubeContainers',
        'kubeLoader',
        'kubeSelect',
        '$routeParams',
        '$route',
        function($scope, containers, loader, select, $routeParams, $route) {

            var target = $routeParams["container_name"] || "";
            $scope.target = target;

            loader.listen(function() {
                $scope.pod = select().kind("Pod")
                                   .namespace($routeParams.pod_namespace || "")
                                   .name($routeParams.pod_name  || "").one();
                if ($scope.pod) {
                     angular.forEach(containers($scope.pod) || [], function (con) {
                        if (con.spec && con.spec.name === target)
                            $scope.container = con;
                     });
                }
            }, $scope);

            loader.watch("Pod", $scope);

            $scope.back = function() {
                $route.updateParams({ "container_name" : undefined });
            };

            $scope.should_mask = function(name) {
                return name.toLowerCase().indexOf("password") !== -1;
            };
        }
    ])

    /**
     * Build an array of container objects where each object contains the data from both
     * the spec and status sections of the pod. Looks like this:
     *   { id: id, spec: pod.spec.containers[n], status: pod.status.containerStatuses[n] }
     *
     * The returned array will not change once created for a given pod item.
     */
    .factory('KubeContainers', [
        'KubeMapNamedArray',
        function(mapNamedArray) {
            return function (item) {
                var specs, statuses, pod_id;
                if (!item.containers) {
                    pod_id = "pods/" + item.metadata.namespace + "/" + item.metadata.name;
                    if (item.spec)
                        specs = mapNamedArray(item.spec.containers);
                    else
                        specs = { };

                    if (item.status)
                        statuses = mapNamedArray(item.status.containerStatuses);
                    else
                        statuses = { };

                    item.containers = Object.keys(specs).map(function(name) {
                        var key = pod_id + "/" + name;
                        return { spec: specs[name], status: statuses[name], key: key };
                    });
                }
                return item.containers;
            };
        }
    ])

    .directive('containersListing',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/containers-listing.html'
            };
        }
    )

    .directive('containerPageInline',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/container-page-inline.html'
            };
        }
    )

    .directive('kubeContainerBody',
        function() {
            return {
                restrict: 'E',
                templateUrl: 'views/container-body.html'
            };
        }
    )

    .directive('kubePodBody',
        function() {
            return {
                restrict: 'E',
                templateUrl: 'views/pod-body.html'
            };
        }
    )

    /*
     * Displays a container console.
     *
     * <kube-console namespace="ns" container="name"></kube-console>
     */
    .directive('kubeConsole', [
        'kubernetesContainerSocket',
        function(socket) {
            return {
                restrict: 'E',
                scope: {
                    pod: '&',
                    container: '&',
                    command: '@',
                    prevent: '='
                },
                link: function(scope, element, attrs) {
                    var limit = 64 * 1024;

                    var outer = angular.element("<div>");
                    outer.addClass("console-ct");
                    element.append(outer);
                    var pre = angular.element("<pre>");
                    outer.append(pre);
                    var wait = null;
                    var ws = null;

                    function connect() {
                        pre.empty();

                        var url = "", pod = scope.pod();
                        if (pod.metadata)
                            url += pod.metadata.selfLink;
                        else
                            url += pod;
                        url += "/log";
                        if (url.indexOf('?') === -1)
                            url += '?';
                        url += "follow=1";

                        var container = scope.container ? scope.container() : null;
                        if (container)
                            url += "&container=" + encodeURIComponent(container);

                        var writing = [];
                        var count = 0;

                        function drain() {
                            wait = null;
                            var at_bottom = pre[0].scrollHeight - pre[0].scrollTop <= pre[0].offsetHeight;
                            var text = writing.join("");

                            /*
                             * Stay under the limit. I wish we could use some other mechanism
                             * for limiting the log output, such as:
                             *
                             * https://github.com/kubernetes/kubernetes/issues/12447
                             */
                            count += text.length;
                            var children, first, removed;
                            while (count > limit) {
                                children = pre.children();
                                if (children.length < 1)
                                    break;

                                first = angular.element(children[0]);
                                removed = first.text().length;
                                first.remove();
                                count -= removed;
                            }

                            /* And add our text */
                            var span = angular.element("<span>").text(text);
                            writing.length = 0;
                            pre.append(span);
                            if (at_bottom)
                                pre[0].scrollTop = pre[0].scrollHeight;

                            phantom_checkpoint();
                        }

                        ws = socket(url);
                        ws.onclose = function(ev) {
                            writing.push(ev.reason);
                            drain();
                            disconnect();
                            ws = null;
                        };
                        ws.onmessage = function(ev) {
                            writing.push(ev.data);
                            if (wait === null)
                                wait = window.setTimeout(drain, 50);
                        };
                    }

                    function disconnect() {
                        if (ws) {
                            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
                            if (ws.readyState < 2) // CLOSING
                                ws.close();
                            ws = null;
                        }
                        window.clearTimeout(wait);
                        wait = null;
                    }

                    scope.$watch("prevent", function(prevent) {
                        if (!prevent && !ws)
                            connect();
                    });

                    scope.$on("$destroy", disconnect);
                }
            };
        }
    ])

    /*
     * Filter to display short docker ids
     *
     * {{ myid | kube-identifier }}
     *
     * Removes docker:// prefix and shortens.
     */
    .filter('kubeIdentifier', function() {
        var regex = /docker:\/\/([\w]{12})\w+/;
        return function(item) {
            var match = regex.exec(item);
            if (match)
                return match[1];
            return item;
        };
    });
}());
