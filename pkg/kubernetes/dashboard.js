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
            $scope.showModal = false;
            $scope.toggleModal = function(){
                $scope.showModal = !$scope.showModal;
            };
        }])
        .directive('deployApp', function () {
            return {
                template: 
                '<div class="modal fade">' +
                  '<div class="modal-dialog">' +
                    '<div class="modal-content">' +
                      '<div class="modal-header">' +
                        '<h4 class="modal-title" translatable="yes">{{ title }}</h4>' +
                      '</div>' +
                      '<div class="modal-body" ng-transclude></div>' +
                    '</div>' +
                  '</div>' +
                '</div>',
                restrict: 'E',
                transclude: true,
                replace:true,
                scope:true,
                link: function postLink(scope, element, attrs) {
                    scope.title = attrs.title;

                    scope.$watch(attrs.visible, function(value){
                        if(value == true)
                            $(element).modal('show');
                        else
                            $(element).modal('hide');
                    });

                    $(element).on('shown.bs.modal', function(){
                        scope.$apply(function(){
                            scope.$parent[attrs.visible] = true;
                        });
                    });

                    $(element).on('hidden.bs.modal', function(){
                        scope.$apply(function(){
                            scope.$parent[attrs.visible] = false;
                        });
                    });
                }
            };
      });

});
