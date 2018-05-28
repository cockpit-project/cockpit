/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import { mouseClick } from "../helpers.es6";
import {
    startLibvirt,
    enableLibvirt,
} from "../actions/provider-actions.es6";

import './libvirtSlate.css';

const _ = cockpit.gettext;

const ENABLED = 'enabled';

class LibvirtSlate extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            libvirtEnabled: this.isUnitStateEnabled(),
            userActivityFlag: false,
        };

        this.onLibvirtEnabledChanged = this.onLibvirtEnabledChanged.bind(this);
        this.isUnitStateEnabled = this.isUnitStateEnabled.bind(this);
        this.startService = this.startService.bind(this);
        this.goToServicePage = this.goToServicePage.bind(this);
    }

    componentWillReceiveProps() {
        // unitState will be usually received after this component was created
        // but, do not update from backend after the user decides to change it (is fired by the update loop)
        if (!this.state.userActivityFlag) {
            this.setState({
                libvirtEnabled: this.isUnitStateEnabled(),
            });
        }
    }

    isUnitStateEnabled() {
        return this.props.libvirtService.unitState === ENABLED;
    }

    onLibvirtEnabledChanged(e) {
        if (e && e.target && typeof e.target.checked === "boolean") {
            this.setState({
                libvirtEnabled: e.target.checked,
                userActivityFlag: true,
            });
        }
    }

    startService() {
        const service = this.props.libvirtService;

        if (this.state.libvirtEnabled !== (this.isUnitStateEnabled())) {
            // different from original
            this.props.dispatch(enableLibvirt(this.state.libvirtEnabled, service.name));
        }
        this.props.dispatch(startLibvirt(service.name));
    }

    goToServicePage() {
        const name = this.props.libvirtService.name ? this.props.libvirtService.name : 'libvirtd.service'; // fallback
        cockpit.jump("/system/services#/" + name);
    }

    render() {
        let activeState = this.props.libvirtService.activeState;
        let name = this.props.libvirtService.name;
        let message;
        let icon;
        let detail;
        let action;

        if (activeState === 'running') {
            message = _("Virtualization Service is Available");
            icon = (<span className="pficon-ok" />);
        } else if (name && activeState === 'unknown') { // name === 'unknown' first
            message = _("Connecting to Virtualization Service");
            icon = (<div className="spinner spinner-lg" />);
        } else {
            message = _("Virtualization Service (libvirt) is Not Active");
            icon = (<span className="fa fa-exclamation-circle" />);
            detail = (
                <div className="checkbox">
                    <label>
                        <input type="checkbox"
                               id="enable-libvirt"
                               disabled={!name}
                               checked={this.state.libvirtEnabled}
                               onChange={this.onLibvirtEnabledChanged} />
                        {_("Automatically start libvirt on boot")}
                    </label>
                </div>
            );
            action = (
                <div className="blank-slate-pf-main-action">
                    <button className="btn btn-default btn-lg"
                            id="troubleshoot"
                            onClick={mouseClick(this.goToServicePage)}>
                        {_("Troubleshoot")}
                    </button>
                    <button className="btn btn-primary btn-lg"
                            id="start-libvirt"
                            disabled={!name}
                            onClick={mouseClick(this.startService)}>
                        {_("Start libvirt")}
                    </button>
                </div>
            );
        }
        return (
            <div className="curtains-ct blank-slate-pf">
                <div className="blank-slate-pf-icon">
                    {icon}
                </div>
                <h1 className="header" id="slate-header">
                    {message}
                </h1>
                {detail}
                {action}
            </div>);
    }
}

LibvirtSlate.propTypes = {
    dispatch: PropTypes.func.isRequired,
    libvirtService: PropTypes.object.isRequired,
};

export default LibvirtSlate;
