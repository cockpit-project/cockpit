define([
    "jquery",
    "docker/docker",
    "kubernetes/angular",
    "kubernetes/app"
], function($, docker, angular) {
    'use strict';

    return angular.module('kubernetes.details', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/pods/:namespace', {
                templateUrl: 'details.html',
                controller: 'DetailsCtrl'
            });
        }])

        /*
         * The controller for the details view.
         */
        .controller('DetailsCtrl', [
            '$scope',
            '$routeParams',
            '$location',
            'kubernetesClient',
            function($scope, $routeParams, $location, client) {

            /* Setup a persistent search for this object */
            var list = client.select("Pod", $routeParams.namespace, $location.search());
            client.track(list);

            angular.extend($scope, {
                client: client,
                selection: list
            });

            /*
             * TODO: The selection will be a dynamic object dependent on what
             * sorta selection is made, not just pods. We'll list:
             */

            $(list).on("changed", function() {
                $scope.$digest();
            });

            $scope.$on("$destroy", function() {
                client.track(list, false);
            });
        }])

        /*
         * Displays a kubernetes pod.
         *
         * <kube-pod> ... </kube-pod>
         *
         * Expected in scope:
         * pod: raw pod JSON
         */
        .directive('kubePod', function() {
            return {
                restrict: 'E',
                transclude: true,
                templateUrl: 'pod.html'
            };
        })

        /*
         * Displays an interactive container.
         *
         * <kube-container></kube-container>
         *
         * Expected in scope:
         * container: raw pod JSON
         *
         * Exported into scope:
         * connect(): causes interactive elements to connect.
         *
         * Events in scope:
         * connect: causes interactive elements to connect.
         */
        .directive('kubeContainer', function() {
            return {
                restrict: 'E',
                scope: true,
                templateUrl: 'container.html',
                link: function(scope, element, attrs) {
                    scope.connect = function connect() {
                        scope.$broadcast("connect");
                    };
                }
            };
        })

        /*
         * Displays a container console.
         *
         * <kube-console id="abcdef" host="127.0.0.1" shell="true"></kube-console>
         *
         * Arguments:
         * id: the full container identifier
         * host: the host the container is running on
         * shell: whether to run a shell, or attach to container
         */
        .directive('kubeConsole', function() {
            return {
                restrict: 'E',
                link: function(scope, element, attrs) {
                    var options = { };
                    if (attrs.host && attrs.host != "localhost")
                        options.host = attrs.host;

                    var id = attrs.id || "";
                    if (id.indexOf("docker://") === 0)
                        id = id.substring(9);

                    var cons;
                    if (scope.$eval(attrs.shell || "false"))
                        cons = docker.console(id, ["/bin/sh", "-i"], options);
                    else
                        cons = docker.console(id, options);

                    element.append(cons);

                    /* Don't connect immediately, wait for event */
                    scope.$on("connect", function() {
                        if (!cons.connected) {
                            cons.typeable(true);
                            cons.connect();
                        }
                    });
                }
            };
        })

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
});
