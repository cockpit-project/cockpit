define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "kubernetes/app"
], function($, cockpit, angular) {
    'use strict';

    var _ = cockpit.gettext;

    return angular.module('kubernetes.images', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/images', {
                templateUrl: 'views/images.html',
                controller: 'ImagesCtrl'
            });
        }])

        .controller('ImagesCtrl', [
            '$scope',
            'kubernetesClient',
            function($scope, client) {

            }
        ]);
});
