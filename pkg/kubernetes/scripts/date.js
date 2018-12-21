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
    var angular = require('angular');
    var moment = require('moment');

    require('./kube-client');

    angular.module('kubernetes.date', [
        "kubeClient"
    ])

            .factory('momentLib', [
                function() {
                    return moment;
                }
            ])

            .factory('refreshEveryMin', [
                "$rootScope",
                "$window",
                "kubeLoader",
                function($rootScope, $window, loader) {
                    var last = 0;
                    var interval = 60000;
                    var tol = 500;

                    loader.listen(function() {
                        last = (new Date()).getTime();
                    });

                    $window.setInterval(function() {
                        var now = (new Date()).getTime();
                        if ((now - last) + tol >= interval)
                            $rootScope.$applyAsync();
                        last = now;
                    }, interval);

                    return {};
                }
            ])

            .filter('dateRelative', [
                "refreshEveryMin",
                function() {
                    function dateRelative(timestamp) {
                        if (!timestamp) {
                            return timestamp;
                        }
                        return moment(timestamp).fromNow();
                    }
                    dateRelative.$stateful = true;
                    return dateRelative;
                }
            ]);
}());
