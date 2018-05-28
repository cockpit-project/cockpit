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

import VmsListing from '../components/VmsListing.jsx';
import { initStore, getStore } from '../store.es6';
import initialize from './util/initialize.es6';
import { setVms } from '../action-creators.jsx';

import '../../../../machines/machines.less'; // once per component hierarchy

const VmsPage = () => (
    <Provider store={getStore()}>
        <VmsListing />
    </Provider>
);

function addVmsListener (store, $scope, kubeLoader, kubeSelect) {
    kubeLoader.listen(() => {
        const vms = kubeSelect().kind('VirtualMachine');
        store.dispatch(setVms(Object.values(vms)));
    }, $scope);
    kubeLoader.watch('VirtualMachine', $scope);
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
    addVmsListener(store, $scope, kubeLoader, kubeSelect);
    initialize($scope, kubeLoader, kubeSelect, kubeMethods, KubeRequest, store);

    const rootElement = document.querySelector('#kubernetes-virtual-machines-root');
    ReactDOM.render(<VmsPage />, rootElement);
}

export { init };
