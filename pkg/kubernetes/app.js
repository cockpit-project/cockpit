define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/client"
], function($, cockpit, angular, kubernetes) {
    'use strict';

    return angular.module('kubernetes', [
            'ngRoute',
            'ui.bootstrap',
            'kubernetes.dashboard',
            'kubernetes.graph',
            'kubernetes.details',
            'kubernetes.topology'
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
                    client.close();
                    handle(client.connect());
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

        .factory('kubernetesClient', function() {
            return kubernetes.k8client();
        });
});
