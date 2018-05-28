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

import 'regenerator-runtime/runtime'; // required for library initialization
import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { setVms, vmExpanded } from '../action-creators.jsx';
import VmDetail from '../components/VmDetail.jsx';
import { initStore, getStore } from '../store.es6';
import initialize from './util/initialize.es6';

import '../../../../machines/machines.less'; // once per component hierarchy

const VmPage = ({pageParams}) => (
    <Provider store={getStore()}>
        <VmDetail pageParams={pageParams} />
    </Provider>
);

function addVmListener (store, $scope, kubeLoader, kubeSelect, namespace, name) {
    kubeLoader.listen(() => {
        const vm = kubeSelect().kind('VirtualMachine')
                .namespace(namespace)
                .name(name)
                .one();
        const result = vm ? [vm] : [];

        if (vm) {
            store.dispatch(vmExpanded({
                vm,
                isExpanded: true
            }));
        }

        store.dispatch(setVms(result));
    }, $scope);
    kubeLoader.watch('VirtualMachine', $scope);
}

/**
 *
 * @param {$rootScope.Scope} $scope 'VirtualMachinesCtrl' controller scope
 * @param {$routeParams} $routeParams
 * @param {kubeLoader} kubeLoader
 * @param {kubeSelect} kubeSelect
 * @param {kubeMethods} kubeMethods
 * @param {KubeRequest} KubeRequest
 */
function init ($scope, $routeParams, kubeLoader, kubeSelect, kubeMethods, KubeRequest) {
    const store = initStore();
    const name = $routeParams.name;
    const namespace = $routeParams.namespace;

    let onDestroy;
    if (namespace && name) {
        // enable metrics fetching
        onDestroy = () => {
            const state = store.getState();
            if (state.vms.length > 0) {
                store.dispatch(vmExpanded({
                    vm: state.vms[0],
                    isExpanded: false,
                }));
            }
        };

        // fetch only if there is a namespace and name
        addVmListener(store, $scope, kubeLoader, kubeSelect, namespace, name);
    } else {
        // otherwise reset
        store.dispatch(setVms([]));
    }
    initialize($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest, store, onDestroy);

    const rootElement = document.querySelector('#kubernetes-virtual-machine-root');
    ReactDOM.render(<VmPage pageParams={{name, namespace}} />, rootElement);
}

export { init };
