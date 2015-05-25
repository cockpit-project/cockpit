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

    return angular.module('kubernetes.dashboard', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'dashboard.html',
                controller: 'DashboardCtrl'
            });
        }])
        .controller('DashboardCtrl', [
                '$scope',
                'kubernetesClient',
                'kubernetesServices',
                'kubernetesNodes',
                'kubernetesPods',
                function($scope, client, services, nodes, pods) {
            $scope.services = services;
            $scope.nodes = nodes;
            $scope.pods = pods;
            $scope.client = client;
            $([client, services, nodes, pods]).on("changed", function() {
                $scope.$digest();
                phantom_checkpoint();
            });
        }]);
});
