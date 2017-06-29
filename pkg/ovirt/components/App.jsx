/*jshint esversion: 6 */
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
import React from "react";
import cockpit from 'cockpit';

import HostVmsList from '../../machines/hostvmslist.jsx';
import ClusterVms from './ClusterVms.jsx';
import ClusterTemplates from './ClusterTemplates.jsx';
import VdsmView from './VdsmView.jsx';

import { goToSubpage } from '../actions.es6';

const _ = cockpit.gettext;

const LoginInProgress = ({ ovirtConfig }) => {
    if (ovirtConfig && ovirtConfig.loginInProgress) {
        return (
            <p className='ovirt-login-in-progress'>
                {_("oVirt login in progress")} <span className="spinner spinner-xs spinner-inline"></span>
            </p>
        );
    }

    return null;
};

const TopMenu = ({ ovirtConfig, router, dispatch }) => {
    /* TODO: design
     - http://www.patternfly.org/pattern-library/navigation/horizontal-navigation
     - or use "dashboard" in manifest.json ?
     */
    if (!ovirtConfig) {
        return null; // oVirt is not yet initialized
    }
    const onNavigate = (target) => {
        dispatch(goToSubpage(target));
    };

    const selected = (target) => {
        if (!router) {
            return '';
        }

        if (router.route === target || (!router.route && target === 'hostvms')) {
            return ' top-menu-selected';
        }

        return '';
    };

    return (
        <div className='content-extra-header'>
            <a className={'top-menu-link' + selected('hostvms')} href='#'
               id='ovirt-topnav-hostvms'
               onClick={() => onNavigate('hostvms')}>{_("Host")}</a>
            <a className={'top-menu-link' + selected('clustervms')} href='#'
               id='ovirt-topnav-clustervms'
               onClick={() => onNavigate('clustervms')}>{_("Cluster")}</a>
            <a className={'top-menu-link' + selected('clustertemplates')} href='#'
               id='ovirt-topnav-clustertemplates'
               onClick={() => onNavigate('clustertemplates')}>{_("Templates")}</a>
            <a className={'top-menu-link' + selected('vdsm')} href='#'
               id='ovirt-topnav-vdsm'
               onClick={() => onNavigate('vdsm')}>{_("VDSM")}</a>

            <LoginInProgress ovirtConfig={ovirtConfig}/>
        </div>
    );
};

const HostVmsListDecorated = ({ vms, config, dispatch }) => {
    return (
        <div className='container-fluid'>
            <HostVmsList vms={vms}
                         config={config}
                         dispatch={dispatch} />
        </div>
    );
};

const App = ({ store }) => {
    const state = store.getState();
    const dispatch = store.dispatch;
    const { vms, config } = state;

    let ovirtConfig, router;
    if (config.providerState) {
        ovirtConfig = config.providerState.ovirtConfig;
        router = config.providerState.router;
    }

    const route = router && router.route;
    let component = null;
    switch (route) {
        case 'clustervms':
            component = (<ClusterVms config={config} dispatch={dispatch}/>);
            break;
        case 'clustertemplates':
            component = (<ClusterTemplates config={config} dispatch={dispatch}/>);
            break;
        case 'vdsm':
            component = (<VdsmView/>);
            break;
        default:
            component = (
                <HostVmsListDecorated vms={vms} config={config} dispatch={dispatch} />);
    }

    return (
        <div className='main-app-div'>
            {component}
            <TopMenu ovirtConfig={ovirtConfig} router={router} dispatch={dispatch} />
        </div>
    );
};
App.propTypes = {
    store: React.PropTypes.object.isRequired
}

export default App;