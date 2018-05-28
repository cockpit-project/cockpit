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

import {
    rephraseUI,
} from "../../helpers.es6";

const _ = cockpit.gettext;

const StateIcon = ({ state, config, valueId, extra }) => {
    if (state === undefined) {
        return (<div />);
    }

    let stateMap = {
        running: { className: 'pficon pficon-ok icon-1x-vms', title: _("The VM is running.") }, // TODO: display VM screenshot if available or the ok-icon otherwise
        idle: { className: 'pficon pficon-running icon-1x-vms', title: _("The VM is idle.") },
        paused: { className: 'pficon pficon-pause icon-1x-vms', title: _("The VM is paused.") },
        shutdown: { className: 'glyphicon glyphicon-wrench icon-1x-vms', title: _("The VM is going down.") },
        'shut off': { className: 'fa fa-arrow-circle-o-down icon-1x-vms', title: _("The VM is down.") },
        crashed: { className: 'pficon pficon-error-circle-o icon-1x-vms', title: _("The VM crashed.") },
        dying: {
            className: 'pficon pficon-warning-triangle-o icon-1x-vms',
            title: _("The VM is in process of dying (shut down or crash is not completed)."),
        },
        pmsuspended: {
            className: 'pficon pficon-ok icon-1x-vms',
            title: _("The VM is suspended by guest power management."),
        },
        'creating VM': { className: 'pficon pficon-pending icon-1x-vms' },
        'creating VM installation': { className: 'pficon pficon-pending icon-1x-vms' },
    };
    if (config && config.provider && config.provider.vmStateMap) { // merge default and provider's stateMap to allow both reuse and extension
        stateMap = Object.assign(stateMap, config.provider.vmStateMap);
    }

    if (stateMap[state]) {
        return (
            <span title={stateMap[state].title} data-toggle='tooltip' data-placement='left'>
                {extra}
                <span id={valueId}>{rephraseUI('vmStates', state)}</span>
            </span>);
    }
    return (<small>{state}</small>);
};

StateIcon.propTypes = {
    state: PropTypes.string,
    config: PropTypes.object,
    valueId: PropTypes.string,
    extra: PropTypes.any,
};

export default StateIcon;
