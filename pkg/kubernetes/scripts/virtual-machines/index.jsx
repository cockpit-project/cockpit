/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import 'regenerator-runtime/runtime' // required for library initialization
import React from 'react'
import { createStore, applyMiddleware, compose } from 'redux'
import createSagaMiddleware from 'redux-saga'
import { Provider } from 'react-redux'

import reducers from './reducers.jsx'
import rootSaga from './sagas.jsx'
import * as actionCreators from './action-creators.jsx'
import VmsListing from './components/VmsListing.jsx'

const sagaMiddleware = createSagaMiddleware()
let reduxStore

function initReduxStore() {
    const initialState = {
        vms: []
    }
    const middleware = [ sagaMiddleware ]
    const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose
    const storeEnhancers = composeEnhancers(applyMiddleware(...middleware))
    reduxStore = createStore(reducers, initialState, storeEnhancers)
}

function addKubeLoaderListener ($scope, kubeLoader, kubeSelect) {
    // register load callback( callback, until )
    kubeLoader.listen(function() {
        const vms = kubeSelect().kind('VirtualMachine')
        reduxStore.dispatch(actionCreators.setVms(Object.values(vms)))
    }, $scope);

    // enable watching( watched-entity-type, until )
    kubeLoader.watch('VirtualMachine', $scope);
}

const VmsPlugin = () => (
    <Provider store={reduxStore} >
        <VmsListing />
    </Provider>
)

function addScopeVarsToStore ($scope) {
    $scope.$watch(
        (scope => scope.settings),
        (newSettings => reduxStore.dispatch(actionCreators.setSettings(newSettings))))
}

/**
 *
 * @param {$rootScope.Scope} $scope 'VirtualMachinesCtrl' controller scope
 * @param {kubeLoader} kubeLoader
 * @param {kubeSelect} kubeSelect
 */
function init($scope, kubeLoader, kubeSelect) {
    initReduxStore()
    sagaMiddleware.run(rootSaga)
    addKubeLoaderListener($scope, kubeLoader, kubeSelect)
    addScopeVarsToStore($scope)
    const rootElement = document.querySelector('#kubernetes-virtual-machines-root')
    React.render(<VmsPlugin />, rootElement)
}

export { init };
