define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/app"
], function($, angular) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };

    /* TODO: Migrate this to angular */
    $("body").on("click", "#services-enable-change", function() {
        $("#service-list").toggleClass("editable");
        $("#services-enable-change").toggleClass("active");
    });

    $("body").on("click", ".editable", function(ev) {
        var target = $(ev.target);
        if (!target.is("button")) {
            $("#service-list").toggleClass("editable");
            $("#services-enable-change").toggleClass("active");
        }
    });

    return angular.module('kubernetes.dashboard', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'dashboard.html',
                controller: 'DashboardCtrl'
            });
        }])
        .controller('DashboardCtrl', [
                '$scope',
                '$location',
                'kubernetesServices',
                'kubernetesNodes',
                'kubernetesPods',
                function($scope, $location, services, nodes, pods) {
            var ready = false;

            $scope.services = services;
            $scope.nodes = nodes;
            $scope.pods = pods;

            $scope.jumpService = function jumpService(ev, service) {
                var target = $(ev.target);
                if (target.parents().is(".editable")) {
                    console.log(target.parents(".editable"));
                    return;
                }

                var meta = service.metadata;
                var spec = service.spec;
                if (spec.selector && !$.isEmptyObject(spec.selector) && meta.namespace)
                    $location.path("/pods/" + encodeURIComponent(meta.namespace)).search(spec.selector);
            };

            $scope.highlighted = null;
            $scope.$on("highlight", function(ev, uid) {
                $scope.highlighted = uid;
            });
            $scope.highlight = function highlight(uid) {
                $scope.$broadcast("highlight", uid);
            };

            function services_state() {
                if ($scope.failure)
                    return 'failed';
                var service;
                for (service in services)
                    break;
                return service ? 'ready' : 'empty';
            }

            /* Track the loading/failure state of the services area */
            $scope.state = 'loading';
            $scope.client.watches.services.wait()
                .fail(function(ex) {
                    $scope.failure = ex;
                })
                .always(function() {
                    $scope.state = services_state();
                    if (ready)
                        $scope.$digest();
                });

            $([services, nodes, pods]).on("changed", function() {
                $scope.state = services_state();
                $scope.$digest();
                phantom_checkpoint();
            });

            ready = true;
        }]);
});
