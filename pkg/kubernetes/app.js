define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/client",
    "kubernetes/moment",
], function($, cockpit, angular, kubernetes, moment) {
    'use strict';

    return angular.module('kubernetes', [
            'ngAnimate',
            'ngRoute',
            'ui.bootstrap',
            'kubernetes.containers',
            'kubernetes.dashboard',
            'kubernetes.graph',
            'kubernetes.images',
            'kubernetes.topology',
            'kubernetes.listing'
        ])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.otherwise({ redirectTo: '/' });
        }])

        .controller('MainCtrl', [
            '$scope',
            '$route',
            '$routeParams',
            '$location',
            'kubernetesClient',
            function($scope, $route, $routeParams, $location, client) {
                $scope.$route = $route;
                $scope.$location = $location;
                $scope.$routeParams = $routeParams;

                /* Used to set detect which route is active */
                $scope.is_active = function is_active(template) {
                    var current = $scope.$route.current;
                    return current && current.loadedTemplateUrl === template;
                };

                /* Used by child scopes */
                $scope.client = client;

                /* Used while debugging */
                $scope.console = console;

                /* When set then we hide the application */
                $scope.curtains = { state: 'silent' };

                var timeout = window.setTimeout(function() {
                    $scope.curtains = { state: 'connecting' };
                    $scope.$digest();
                    timeout = null;
                }, 1000);

                function handle(promise) {
                    promise
                        .always(function() {
                            window.clearTimeout(timeout);
                            timeout = null;
                        })
                        .done(function() {
                            $scope.curtains = null;
                            $scope.$digest();
                        })
                        .fail(function(ex) {
                            $scope.curtains = { state: 'failed', failure: ex };
                            $scope.$digest();
                        });
                }

                handle(client.connect());

                $scope.reconnect = function reconnect() {
                    $scope.curtains = { state: 'connecting' };
                    handle(client.connect(true));
                };
        }])

        /* Override the default angularjs exception handler */
        .factory('$exceptionHandler', ['$log', function($log) {
            return function(exception, cause) {

                /* Displays an oops if we're running in cockpit */
                cockpit.oops();

                /* And log with the default implementation */
                $log.error.apply($log, arguments);
            };
        }])

        /* The default orderBy filter doesn't work on objects */
        .filter('orderObjectBy', function() {
            return function(items, field, reverse) {
                var i, sorted = [];
                for (i in items)
                    sorted.push(items[i]);
                function value(obj, i) { return obj[i]; }
                sorted.sort(function (a, b) {
                    var ra = field.split('.').reduce(value, a);
                    var rb = field.split('.').reduce(value, b);
                    if (ra === rb)
                        return 0;
                    return (ra > rb ? 1 : -1);
                });
                if (reverse)
                    sorted.reverse();
                return sorted;
            };
        })

        .filter("timeAgo", function() {
            return function(when) {
                if (when)
                    return moment(when).fromNow();
                return "";
            };
        })

        .filter("formatBytes", function() {
            return function(num) {
                if (typeof num == "number")
                    return cockpit.format_bytes(num);
                return num;
            };
        })

        .factory('kubernetesClient', function() {
            return kubernetes.k8client();
        })

        .directive('cockpitListing', [
            function() {
                return {
                    restrict: 'A',
                    link: function($scope, element, attrs) {
                        var selection = { };
                        var sticky = { };

                        $scope.selection = selection;

                        $scope.selected = function selected(id) {
                            if (id === undefined) {
                                for (id in selection)
                                    return true;
                                return false;
                            } else {
                                return id in selection;
                            }
                        };

                        $scope.select = function select(id, stick) {
                            if (stick === undefined) {
                                Object.keys(selection).forEach(function(old) {
                                    if (!(old in sticky))
                                        delete selection[old];
                                });
                                if (id !== undefined)
                                    selection[id] = true;
                            } else {
                                if (stick)
                                    sticky[id] = true;
                                else
                                    delete sticky[id];
                            }
                        };
                    }
                };
            }
        ])

        .directive('cockpitListingPanel', [
            function() {
                return {
                    restrict: 'A',
                    scope: true,
                    link: function(scope, element, attrs) {
                        scope.star = false;
                        scope.$watch("star", function(value) {
                            scope.select(scope.id, value);
                        });
                    },
                    templateUrl: function(element, attrs) {
                        var kind = attrs.kind || "default";
                        return "views/" + kind.toLowerCase() + "-panel.html";
                    }
                };
            }
        ]);
});
