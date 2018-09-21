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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { Tooltip } from "cockpit-components-tooltip.jsx";

import HostVmsList from '../../machines/hostvmslist.jsx';
import ClusterVms from './ClusterVms.jsx';
import ClusterTemplates from './ClusterTemplates.jsx';
import VdsmView from './VdsmView.jsx';

import { goToSubpage } from '../actions.es6';
import hostToMaintenance from './HostToMaintenance.jsx';
import HostStatus from './HostStatus.jsx';
import { getHost } from "../selectors.es6";
import CONFIG from '../config.es6';

const _ = cockpit.gettext;

const onReload = () => {
    console.info('oVirt connection: page reload requested by user');
    window.location.reload();
};

const LoginInProgress = ({ ovirtConfig }) => {
    if (!ovirtConfig) {
        return null;
    }

    if (ovirtConfig.loginInProgress) {
        return (
            <p className='ovirt-login-in-progress'>
                {_("oVirt login in progress") + '\xa0'}
                <span className="spinner spinner-xs spinner-inline" />
            </p>
        );
    }

    if (!CONFIG.token) {
        // i.e. after Cancel in Installation Dialog
        return (
            <p className='ovirt-login-in-progress'>
                {_("No oVirt connection") + '\xa0'}
                <a href="#" onClick={onReload}>{_("Reload")}</a>
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

    const selected_aria = (target) => {
        return (selected(target) !== '') ? 'page' : '';
    };

    return (
        <nav className='content-extra-header'>
            <a className={'top-menu-link' + selected('hostvms')} href='#'
               id='ovirt-topnav-hostvms'
               aria-current={selected_aria('hostvms')}
               onClick={() => onNavigate('hostvms')}>{_("Host")}</a>
            <a className={'top-menu-link' + selected('clustervms')} href='#'
               id='ovirt-topnav-clustervms'
               aria-current={selected_aria('clustervms')}
               onClick={() => onNavigate('clustervms')}>{_("Cluster")}</a>
            <a className={'top-menu-link' + selected('clustertemplates')} href='#'
               id='ovirt-topnav-clustertemplates'
               aria-current={selected_aria('clustertemplates')}
               onClick={() => onNavigate('clustertemplates')}>{_("Templates")}</a>
            <a className={'top-menu-link' + selected('vdsm')} href='#'
               id='ovirt-topnav-vdsm'
               aria-current={selected_aria('vdsm')}
               onClick={() => onNavigate('vdsm')}>{_("VDSM")}</a>

            <LoginInProgress ovirtConfig={ovirtConfig} />
        </nav>
    );
};

const HostVmsListDecorated = ({ vms, config, systemInfo, ui, dispatch, host }) => {
    // TODO: add Create VM Action here once implemented for oVirt
    const actions = [ createOvirtVmAction() ];
    if (host) {
        actions.push(hostToMaintenance({ dispatch, host }));
    }

    return (
        <div className='container-fluid'>
            <HostStatus host={host} />
            <HostVmsList vms={vms}
                         config={config}
                         systemInfo={systemInfo}
                         ui={ui}
                         storagePools={{}}
                         dispatch={dispatch}
                         actions={actions} />
        </div>
    );
};

/**
 * The action is not yet implemented for oVirt.
 * See createVmDialog.jsx : createVmAction() for more info
 */
const createOvirtVmAction = () => {
    const noop = () => {
        console.debug("Create VM action is not implemented for oVirt");
    };
    const tip = _("This host is managed by a virtualization manager, so creation of new VMs from the host is not possible.");

    return (
        <div className='card-pf-link-with-icon pull-right' key='create-vm-ovirt'>
            <a className='card-pf-link-with-icon pull-right unused-link' id='create-new-vm' onClick={noop}>
                <span className="pficon pficon-add-circle-o" />
                <Tooltip tip={tip} pos="top">
                    {_("Create New VM")}
                </Tooltip>
            </a>
        </div>
    );
};

const App = ({ store }) => {
    const state = store.getState();
    const dispatch = store.dispatch;
    const { vms, config, systemInfo, ui } = state;

    let ovirtConfig, hosts, router;
    if (config.providerState) {
        ovirtConfig = config.providerState.ovirtConfig;
        hosts = config.providerState.hosts;
        router = config.providerState.router;
    }

    const host = getHost(hosts, ovirtConfig); // oVirt record for current host
    const route = router && router.route;

    let component = null;
    switch (route) {
    case 'clustervms':
        component = (<ClusterVms config={config} dispatch={dispatch} />);
        break;
    case 'clustertemplates':
        component = (<ClusterTemplates config={config} dispatch={dispatch} />);
        break;
    case 'vdsm':
        component = (<VdsmView />);
        break;
    default:
        component = (
            <HostVmsListDecorated vms={vms} config={config} systemInfo={systemInfo} ui={ui} dispatch={dispatch} host={host} />);
    }

    return (
        <div className='main-app-div'>
            {component}
            <TopMenu ovirtConfig={ovirtConfig} router={router} dispatch={dispatch} />
        </div>
    );
};
App.propTypes = {
    store: PropTypes.object.isRequired,
};

export default App;
