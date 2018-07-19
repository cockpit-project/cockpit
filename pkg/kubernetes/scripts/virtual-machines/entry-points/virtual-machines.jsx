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

import VmsListing from '../components/vm/VmsListing.jsx';
import { initStore, getStore } from '../store.es6';
import initialize from './util/initialize.es6';
import { setVmis, setVms } from '../action-creators.jsx';
import { VM_KIND, VMI_KIND } from '../constants.es6';

import '../../../../machines/machines.less'; // once per component hierarchy

const VmsPage = () => (
    <Provider store={getStore()}>
        <VmsListing />
    </Provider>
);

function addVmsListener (store, $scope, kubeLoader, kubeSelect) {
    const cancelable = kubeLoader.listen(() => {
        const vms = kubeSelect().kind(VM_KIND);
        const vmis = kubeSelect().kind(VMI_KIND);
        store.dispatch(setVms(Object.values(vms)));
        store.dispatch(setVmis(Object.values(vmis)));
    }, $scope);
    kubeLoader.watch(VM_KIND, $scope);
    kubeLoader.watch(VMI_KIND, $scope);

    return cancelable;
}

/**
 *
 * @param {$rootScope.Scope} $scope 'VirtualMachinesCtrl' controller scope
 * @param {kubeLoader} kubeLoader
 * @param {kubeSelect} kubeSelect
 * @param {kubeMethods} kubeMethods
 * @param {KubeRequest} KubeRequest
 */
function init ($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest) {
    const store = initStore();
    const cancelable = addVmsListener(store, $scope, kubeLoader, kubeSelect);

    const onDestroy = () => {
        cancelable.cancel();
    };

    initialize($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest, store, onDestroy);

    const rootElement = document.querySelector('#kubernetes-virtual-machines-root');
    React.render(<VmsPage />, rootElement);
}

export { init };
