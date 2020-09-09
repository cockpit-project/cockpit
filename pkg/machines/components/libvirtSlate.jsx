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
import { mouseClick } from "../helpers.js";
import {
    checkLibvirtStatus,
    startLibvirt,
    enableLibvirt,
} from "../actions/provider-actions.js";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { Button } from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

const _ = cockpit.gettext;

class LibvirtSlate extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            libvirtEnabled: true,
        };

        this.onLibvirtEnabledChanged = this.onLibvirtEnabledChanged.bind(this);
        this.startService = this.startService.bind(this);
        this.checkStatus = this.checkStatus.bind(this);
        this.goToServicePage = this.goToServicePage.bind(this);
    }

    onLibvirtEnabledChanged(e) {
        if (e && e.target && typeof e.target.checked === "boolean") {
            this.setState({
                libvirtEnabled: e.target.checked,
            });
        }
    }

    checkStatus() {
        const service = this.props.libvirtService;

        this.props.dispatch(checkLibvirtStatus(service.name));
    }

    startService() {
        const service = this.props.libvirtService;

        this.props.dispatch(enableLibvirt(this.state.libvirtEnabled, service.name));
        this.props.dispatch(startLibvirt(service.name));
    }

    goToServicePage() {
        const name = this.props.libvirtService.name ? this.props.libvirtService.name : 'libvirtd.service'; // fallback
        cockpit.jump("/system/services#/" + name);
    }

    render() {
        const name = this.props.libvirtService.name;

        if (name && this.props.libvirtService.activeState === 'unknown')
            return <EmptyStatePanel title={ _("Connecting to virtualization service") } loading />;

        if (this.props.loadingResources)
            return <EmptyStatePanel title={ _("Loading resources") } loading />;

        this.checkStatus();
        // TODO: Convert to PF4-React Checkbox, but this is badly aligned
        const detail = (
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

        const troubleshoot_btn = (
            <Button variant="link" onClick={ mouseClick(this.goToServicePage) }>
                { _("Troubleshoot") }
            </Button>);

        return <EmptyStatePanel icon={ ExclamationCircleIcon }
                                title={ _("Virtualization service (libvirt) is not active") }
                                paragraph={ detail }
                                action={ name ? _("Start libvirt") : null }
                                onAction={ mouseClick(this.startService) }
                                secondary={ troubleshoot_btn } />;
    }
}

LibvirtSlate.propTypes = {
    dispatch: PropTypes.func.isRequired,
    libvirtService: PropTypes.object.isRequired,
};

export default LibvirtSlate;
