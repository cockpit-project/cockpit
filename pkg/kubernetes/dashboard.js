define([
    "jquery",
    "kubernetes/angular",
    "kubernetes/app"
], function($, angular) {
    'use strict';

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
                function($scope, services, nodes) {
            $scope.services = services;
            $scope.nodes = nodes;
            $([services, nodes]).on("changed", function() {
                $scope.$digest();
            });
        }]);
});
