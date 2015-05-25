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
                'kubernetesClient',
                'kubernetesServices',
                'kubernetesNodes',
                'kubernetesPods',
                function($scope, $location, client, services, nodes, pods) {
            $scope.services = services;
            $scope.nodes = nodes;
            $scope.pods = pods;
            $scope.client = client;

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

            $([client, services, nodes, pods]).on("changed", function() {
                $scope.$digest();
                phantom_checkpoint();
            });
        }]);
});
