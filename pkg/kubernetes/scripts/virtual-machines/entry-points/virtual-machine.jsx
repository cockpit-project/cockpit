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
import { Provider } from 'react-redux';

import { setVms, setVmis, showVm } from '../action-creators.es6';
import VmDetail from '../components/vm/VmDetail.jsx';
import { initStore, getStore } from '../store.es6';
import initialize from './util/initialize.es6';
import { VM_KIND, VMI_KIND } from '../constants.es6';

import '../../../../machines/machines.less'; // once per component hierarchy

const VmPage = ({pageParams}) => (
    <Provider store={getStore()}>
        <VmDetail pageParams={pageParams} />
    </Provider>
);

function addVmListener (store, $scope, kubeLoader, kubeSelect, namespace, name) {
    const cancelable = kubeLoader.listen(() => {
        const vm = kubeSelect().kind(VM_KIND)
                .namespace(namespace)
                .name(name)
                .one();

        const vmi = kubeSelect().kind(VMI_KIND)
                .namespace(namespace)
                .name(name)
                .one();

        if (vm) {
            store.dispatch(showVm({
                vm,
                isVisible: true
            }));
        }

        store.dispatch(setVms(vm ? [vm] : []));
        store.dispatch(setVmis(vmi ? [vmi] : []));
    }, $scope);
    kubeLoader.watch(VM_KIND, $scope);
    kubeLoader.watch(VMI_KIND, $scope);

    return cancelable;
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
        // fetch only if there is a namespace and name
        const cancelable = addVmListener(store, $scope, kubeLoader, kubeSelect, namespace, name);
        // enable metrics fetching
        onDestroy = () => {
            cancelable.cancel();
            const state = store.getState();
            if (state.vms.length > 0) {
                store.dispatch(showVm({
                    vm: state.vms[0],
                    isVisible: false,
                }));
            }
        };
    } else {
        // otherwise reset
        store.dispatch(setVms([]));
    }
    initialize($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest, store, onDestroy);

    const rootElement = document.querySelector('#kubernetes-virtual-machine-root');
    React.render(<VmPage pageParams={{name, namespace}} />, rootElement);
}

export { init };
