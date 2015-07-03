define([
    "jquery",
    "base1/cockpit",
    "kubernetes/angular",
    "kubernetes/client",
    "kubernetes/angular-bootstrap"
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

        .factory('kubernetesClient', function() {
            return kubernetes.k8client();
        })
        .directive('kubernetesStatusIcon', function() {
            return {
                restrict: 'A',
                link: function($scope, element, attributes) {
                    $scope.$watch("item.status", function(status) {
                        element
                            .toggleClass("spinner spinner-sm", status == "wait")
                            .toggleClass("fa fa-exclamation-triangle fa-failed", status == "fail");
                    });
                }
            };
        })
        .directive('kubernetesAddress', function() {
            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    $scope.$watchGroup(["item.address", "item.ports"], function(values) {
                        var address = values[0];
                        var ports = values[1];
                        var href = null;
                        var text = null;

                        /* No ports */
                        if (!ports || !ports.length) {
                            text = address;

                        /* One single HTTP or HTTPS port */
                        } else if (ports.length == 1) {
                            text = address + ":" + ports[0].port;
                            if (ports[0].protocol === "TCP") {
                                if (ports[0].port === 80)
                                    href = "http://" + encodeURIComponent(address);
                                else if (ports[0].port === 443)
                                    href = "https://" + encodeURIComponent(address);
                            } else {
                                text += "/" + ports[0].protocol;
                            }
                        } else {
                            text = " " + address + " " + ports.map(function(p) {
                                if (p.protocol === "TCP")
                                    return p.port;
                                else
                                    return p.port + "/" + p.protocol;
                            }).join(" ");
                        }

                        var el;
                        element.empty();
                        if (href) {
                            el = $("<a>")
                                .attr("href", href)
                                .attr("target", "_blank")
                                .on("click", function(ev) { ev.stopPropagation(); });
                            element.append(el);
                        } else {
                            el = element;
                        }
                        el.text(text);
                    });
                }
            };
        });
});
