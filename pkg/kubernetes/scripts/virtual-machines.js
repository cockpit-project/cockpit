/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

    var angular = require('angular');
    require('angular-route');
    require('angular-dialog.js');
    require('./kube-client');
    require('./listing');
    var vmsReact = require('./virtual-machines/index.jsx');

    require('../views/virtual-machines-page.html');

    angular.module('kubernetes.virtualMachines', [
        'ngRoute',
        'ui.cockpit',
        'kubernetesUI',
        'kubeClient',
        'kubernetes.listing'
    ])

    .config([
        '$routeProvider',
        '$locationProvider',
        function($routeProvider, $locationProvider) {
            $routeProvider
                .when('/vms', {
                    templateUrl: 'views/virtual-machines-page.html',
                    controller: 'VirtualMachinesCtrl'
                });
            /*
            Links rewriting is enabled by default. It does two things:
            * It changes links href in older browsers.
            * It handles the navigation instead of the browser.

            The link rewriting code runs in 'click' event handler registered
            to the `document` element to bubbling phase. It calls `preventDefault()`
            event method and instructs browser to go to the destination.

            Such behavior breaks event handling in React since:
            * React always gets event with flag `defaultPrevented` set.
            * Navigation is performed no matter if `event.preventDefault()` is called
              in React handler.

            @see https://docs.angularjs.org/api/ng/provider/$locationProvider
            @see https://docs.angularjs.org/guide/$location#html5-mode
             */
            $locationProvider.html5Mode({ rewriteLinks: false });
        }
    ])

    .controller('VirtualMachinesCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        function($scope, loader, select) {
            vmsReact.init($scope, loader, select);
        }]
    );

}());
