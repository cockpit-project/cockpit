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
        function($routeProvider) {
            $routeProvider
                .when('/vms', {
                    templateUrl: 'views/virtual-machines-page.html',
                    controller: 'VirtualMachinesCtrl'
                });
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
