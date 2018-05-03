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

import { logDebug } from '../helpers.es6';
import { vmDesktopConsole } from '../actions/provider-actions.es6';

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
                <Select.SelectEntry data={'vnc-browser'} key='vnc-browser'>
                    {_("Graphics Console (VNC)")}
                </Select.SelectEntry>
            );
            isDesktop = true;
        }

        if (isDesktop || vm.displays.spice) {
            entries.push(
                <Select.SelectEntry data={'desktop'} key='desktop'>
                    {_("Graphics Console in Desktop Viewer")}
                </Select.SelectEntry>
            );
        }
    }

    if (isSerialConsole) {
        entries.push(
            <Select.SelectEntry data={'serial-browser'} key='serial-browser'>
                {_("Serial Console")}
            </Select.SelectEntry>
        );
    }

    return (
        <table className='form-table-ct'>
            <tbody>
                <tr>
                    <td className='top'>
                        <label>{_("Console Type")}</label>
                    </td>
                    <td>
                        <Select.StatelessSelect id="console-type-select"
                                                selected={selected}
                                                onChange={onChange}
                                                extraClass='console-type-select'>
                            {entries}
                        </Select.StatelessSelect>
                    </td>
                </tr>
            </tbody>
        </table>
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
        const { vm, config } = this.props;

        if (vm.displays) {
            if (vm.displays.vnc) {
                return 'vnc-browser';
            }
            if (vm.displays.spice) {
                return 'desktop';
            }
        }

        const serialConsoleCommand = config.provider.serialConsoleCommand({ vm });
        if (serialConsoleCommand) {
            return 'serial-browser';
        }

        // no console defined
        return null;
    }

    componentWillMount () {
        this.onConsoleTypeSelected(this.getDefaultConsole());
    }

    onConsoleTypeSelected (key) {
        logDebug('onConsoleTypeSelected', key);

        const { vm, config } = this.props;
        const { provider, providerState } = config;

        let consoleDetail;

        if (key === 'vnc-browser') {
            if (provider.onConsoleAboutToShow) {
                // Hook: Give provider chance to update consoleDetail before noVNC is initialized.
                // This update needs to be performed at the time of console retrieval, since provider-specific console
                // details might vary over time, like the password (in oVirt: the password is valid for 2 minutes only).
                provider.onConsoleAboutToShow({ type: 'vnc', vm, providerState }).then(consoleDetail => {
                    logDebug('onConsoleTypeSelected(), provider updated console details');
                    if (!consoleDetail) {
                        // vnc console can't be rendered (see provider for the reason)
                        console.info(`In-Browser VNC console is disabled by external provider`);
                    }

                    this.setState({
                        consoleType: key,
                        consoleDetail,
                    });
                });
            } else {
                consoleDetail = vm.displays.vnc;
            }
        }

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
        const { vm, config } = this.props;
        const { provider } = config;

        if (!provider.canConsole || !provider.canConsole(vm.state)) {
            return (<VmNotRunning />);
        }

        const serialConsoleCommand = config.provider.serialConsoleCommand({ vm });

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

        switch (this.state.consoleType) {
        case 'serial-browser':
            return <SerialConsole vmName={vm.name} spawnArgs={serialConsoleCommand}>{consoleSelector}</SerialConsole>;
        case 'vnc-browser':
            return <Vnc vm={vm} consoleDetail={this.state.consoleDetail}>{consoleSelector}</Vnc>;
        case 'desktop':
            return <DesktopConsole vm={vm} onDesktopConsole={onDesktopConsole} config={config}>{consoleSelector}</DesktopConsole>;
        default:
            break;
        }

        return (<NoConsoleDefined />);
    }
}
Consoles.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export default Consoles;
