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

    angular.module('kubernetes', [
        'ngRoute',
        'ui.bootstrap',
        'kubeClient',
        'kubeClient.cockpit',
        'kubernetes.app',
        'kubernetes.graph',
        'kubernetes.dashboard',
        'kubernetes.containers',
        'kubernetes.details',
        'kubernetes.topology',
        'registry.images',
        'registry.projects',
        'kubernetesUI'
    ])

    .config([
        '$routeProvider',
        'KubeWatchProvider',
        'KubeRequestProvider',
        'KubeSocketProvider',
        'KubeTranslateProvider',
        'KubeFormatProvider',
        'kubernetesContainerSocketProvider',
        'KubeDiscoverSettingsProvider',
        '$provide',
        function($routeProvider, KubeWatchProvider, KubeRequestProvider,
                 KubeSocketProvider, KubeTranslateProvider, KubeFormatProvider,
                 kubernetesContainerSocketProvider, KubeDiscoverSettingsProvider,
                 $provide) {

            $routeProvider.otherwise({ redirectTo: '/' });

            /* Tell the kube-client code to use cockpit watches and requests */
            KubeWatchProvider.KubeWatchFactory = "CockpitKubeWatch";
            KubeRequestProvider.KubeRequestFactory = "CockpitKubeRequest";
            KubeSocketProvider.KubeSocketFactory = "CockpitKubeSocket";
            KubeTranslateProvider.KubeTranslateFactory = "CockpitTranslate";
            KubeFormatProvider.KubeFormatFactory = "CockpitFormat";
            KubeDiscoverSettingsProvider.KubeDiscoverSettingsFactory = "cockpitKubeDiscoverSettings";

            /* Tell the container-terminal that we want to be involved in WebSocket creation */
            kubernetesContainerSocketProvider.WebSocketFactory = 'cockpitContainerWebSocket';

            $provide.decorator("$exceptionHandler",
                ['$delegate',
                 '$log',
                 function($delegate, $log) {
                    return function (exception, cause) {
                        /* Displays an oops if we're running in cockpit */
                        if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
                            window.parent.postMessage("\n{ \"command\": \"oops\" }", "*");

                        $delegate(exception, cause);
                    };
              }]);
        }
    ]);
}());
