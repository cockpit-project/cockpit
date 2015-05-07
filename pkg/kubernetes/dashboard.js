define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/app"
], function($, angular) {
    'use strict';

    /* TODO: Migrate this to angular */
    $("#content").on("click", "#services-enable-change", function() {
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
                'kubernetesServices',
                'kubernetesNodes',
                'kubernetesPods',
                function($scope, services, nodes, pods) {
            $scope.services = services;
            $scope.nodes = nodes;
            $scope.pods = pods;
            $([services, nodes, pods]).on("changed", function() {
                $scope.$digest();
            });
        }]);
});
