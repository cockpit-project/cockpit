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

import { initMiddleware } from '../../kube-middleware.jsx';
import { watchMetrics, cleanupMetricsWatch } from '../../watch-metrics.es6';
import * as actionCreators from '../../action-creators.jsx';

function addKubeLoaderListener (store, $scope, kubeLoader, kubeSelect) {
    // register load callback( callback, until )
    kubeLoader.listen(() => {
        const persistentVolumes = kubeSelect().kind('PersistentVolume');
        const pods = kubeSelect().kind('Pod');

        store.dispatch(actionCreators.setPVs(Object.values(persistentVolumes)));
        store.dispatch(actionCreators.setPods(Object.values(pods)));
    }, $scope);

    // enable watching( watched-entity-type, until )
    kubeLoader.watch('PersistentVolume', $scope);
    kubeLoader.watch('Pod', $scope);
}

function addScopeVarsToStore (store, $scope) {
    $scope.$watch(
        scope => scope.settings,
        newSettings => store.dispatch(actionCreators.setSettings(newSettings)));
}

/**
 *
 * @param {$rootScope.Scope} $scope '.*Ctrl' controller scope
 * @param {kubeLoader} kubeLoader
 * @param {kubeSelect} kubeSelect
 * @param {kubeMethods} kubeMethods
 * @param {KubeRequest} KubeRequest
 * @param {store} store
 * @param {onDestroy} onDestroy
 */
export default function initialize($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest, store, onDestroy) {
    addKubeLoaderListener(store, $scope, kubeLoader, kubeSelect);
    initMiddleware(kubeMethods, kubeLoader, KubeRequest);
    addScopeVarsToStore(store, $scope);

    watchMetrics(store);
    $scope.$on("$destroy", () => {
        typeof onDestroy === 'function' && onDestroy();
        cleanupMetricsWatch();
    });
}
