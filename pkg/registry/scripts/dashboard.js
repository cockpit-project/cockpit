/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

(function() {
    "use strict";

    angular.module('registry.dashboard', [
        'ngRoute',
        'ui.cockpit'
    ])

    .config(['$routeProvider',
        function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'views/dashboard-page.html',
                controller: 'DashboardCtrl',
                reloadOnSearch: false,
            });
        }
    ])

    .controller('DashboardCtrl', [
        '$scope',
        '$modal',
        function($scope, $modal) {
            $scope.exampleDialog = function() {
                $modal.open({
                    controller: 'ExampleDialogCtrl',
                    templateUrl: 'views/example-dialog.html',
                    resolve: {
                        exampleData: function() {
                            return [1, 2, 3];
                        }
                    },
                }).result.then(function(response) {
                    console.log("dialog response", response);
                }, function(reject) {
                    console.log("dialog reject", reject);
                });
            };
        }
    ])

    .controller('ExampleDialogCtrl', [
        '$q',
        '$timeout',
        '$interval',
        '$scope',
        "exampleData",
        function($q, $timeout, $interval, $scope, data) {
            $scope.exampleData = data;

            var ex1 = new Error("This field is invalid");
            ex1.target = "#control-1";
            var ex2 = new Error("Another problem with this field");
            ex2.target = "#control-2";
            $scope.inputErrors = [ex1, ex2];

            $scope.bigError = new Error("This is a global failure message");

            /* A mock operation, cancellable with progress */
            $scope.waitOperation = function() {
                var defer = $q.defer();
                var count = 0;
                var interval = $interval(function() {
                    count += 1;
                    defer.notify("Step " + count);
                }, 500);
                var timeout = $timeout(function() {
                    $interval.cancel(interval);
                    defer.resolve("Resolution");
                }, 5000);
                var promise = defer.promise;
                promise.cancel = function() {
                    console.log("waitOperation is cancelled");
                    $interval.cancel(interval);
                    $timeout.cancel(timeout);
                    defer.reject();
                };
                return promise;
            };
        }
    ]);

}());
