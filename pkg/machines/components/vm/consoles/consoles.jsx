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
import * as Select from "cockpit-components-select.jsx";

import SerialConsole from './serialConsole.jsx';
import Vnc from './vnc.jsx';
import DesktopConsole from './desktopConsole.jsx';

import { logDebug } from '../../../helpers.js';
import { vmDesktopConsole } from '../../../actions/provider-actions.js';
import LibvirtDBus from '../../../libvirt-dbus.js';

import './consoles.css';

const _ = cockpit.gettext;

const VmNotRunning = () => {
    return (
        <div>
            {_("Please start the virtual machine to access its console.")}
        </div>
    );
};

const ConsoleSelector = ({ onChange, selected, isSerialConsole, vm }) => {
    const entries = [];

    let isDesktop = false;
    if (vm.displays) {
        if (vm.displays.vnc) {
            entries.push(
                <Select.SelectEntry data="vnc-browser" key='vnc-browser'>
                    {_("Graphics console (VNC)")}
                </Select.SelectEntry>
            );
            isDesktop = true;
        }

        if (isDesktop || vm.displays.spice) {
            entries.push(
                <Select.SelectEntry data="desktop" key='desktop'>
                    {_("Graphics console in desktop viewer")}
                </Select.SelectEntry>
            );
        }
    }

    if (isSerialConsole) {
        entries.push(
            <Select.SelectEntry data="serial-browser" key='serial-browser'>
                {_("Serial console")}
            </Select.SelectEntry>
        );
    }

    return (
        <div className="pf-c-console__actions">
            <label htmlFor="console-type-select">{_("Console type")}</label>
            <Select.StatelessSelect id="console-type-select"
                                    selected={selected}
                                    onChange={onChange}>
                {entries}
            </Select.StatelessSelect>
        </div>
    );
};

const NoConsoleDefined = () => {
    return (
        <div>
            {_("No console defined for this virtual machine.")}
        </div>
    );
};

class Consoles extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            consoleType: undefined,
            consoleDetail: undefined,
        };

        this.onConsoleTypeSelected = this.onConsoleTypeSelected.bind(this);
        this.getDefaultConsole = this.getDefaultConsole.bind(this);
        this.onDesktopConsoleDownload = this.onDesktopConsoleDownload.bind(this);
    }

    getDefaultConsole () {
        const { vm } = this.props;

        if (vm.displays) {
            if (vm.displays.vnc) {
                return 'vnc-browser';
            }
            if (vm.displays.spice) {
                return 'desktop';
            }
        }

        const serialConsoleCommand = LibvirtDBus.serialConsoleCommand({ vm });
        if (serialConsoleCommand) {
            return 'serial-browser';
        }

        // no console defined
        return null;
    }

    componentDidMount () {
        this.onConsoleTypeSelected(this.getDefaultConsole());
    }

    onConsoleTypeSelected (key) {
        logDebug('onConsoleTypeSelected', key);

        const { vm } = this.props;
        let consoleDetail;

        if (key === 'vnc-browser')
            consoleDetail = vm.displays.vnc;

        this.setState({
            consoleType: key,
            consoleDetail,
        });
    }

    onDesktopConsoleDownload (type) {
        const { dispatch, vm } = this.props;
        // fire download of the .vv file
        dispatch(vmDesktopConsole(vm, vm.displays[type]));
    }

    render () {
        const { vm, config, onAddErrorNotification } = this.props;

        if (!LibvirtDBus.canConsole || !LibvirtDBus.canConsole(vm.state)) {
            return (<VmNotRunning />);
        }

        const serialConsoleCommand = LibvirtDBus.serialConsoleCommand({ vm });

        const onDesktopConsole = () => { // prefer spice over vnc
            this.onDesktopConsoleDownload(vm.displays.spice ? 'spice' : 'vnc');
        };

        logDebug('Consoles render, this.state.consoleType: ', this.state.consoleType);

        const consoleSelector = (
            <ConsoleSelector onChange={this.onConsoleTypeSelected}
                             isSerialConsole={!!serialConsoleCommand}
                             selected={this.state.consoleType}
                             vm={vm} />
        );

        let consoleType;
        switch (this.state.consoleType) {
        case 'serial-browser':
            if (serialConsoleCommand)
                consoleType = <SerialConsole connectionName={vm.connectionName} vmName={vm.name} spawnArgs={serialConsoleCommand} />;
            break;
        case 'vnc-browser':
            consoleType = <Vnc vm={vm} consoleDetail={this.state.consoleDetail} onAddErrorNotification={onAddErrorNotification} />;
            break;
        case 'desktop':
            consoleType = <DesktopConsole vm={vm} onDesktopConsole={onDesktopConsole} config={config} />;
            break;
        default:
            break;
        }
        if (consoleType) {
            return (
                <div className="pf-c-console">
                    {consoleSelector}
                    {consoleType}
                </div>
            );
        }

        return (<NoConsoleDefined />);
    }
}
Consoles.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default Consoles;
