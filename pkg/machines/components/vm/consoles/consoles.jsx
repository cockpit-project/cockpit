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
import { AccessConsoles } from "@patternfly/react-console";

import SerialConsole from './serialConsole.jsx';
import Vnc from './vnc.jsx';
import DesktopConsole from './desktopConsole.jsx';

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

class Consoles extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            consoleDetail: undefined,
        };

        this.getDefaultConsole = this.getDefaultConsole.bind(this);
        this.onDesktopConsoleDownload = this.onDesktopConsoleDownload.bind(this);
    }

    getDefaultConsole () {
        const { vm } = this.props;

        if (vm.displays) {
            if (vm.displays.vnc) {
                return 'VncConsole';
            }
            if (vm.displays.spice) {
                return 'DesktopViewer';
            }
        }

        const serialConsoleCommand = LibvirtDBus.serialConsoleCommand({ vm });
        if (serialConsoleCommand) {
            return 'SerialConsole';
        }

        // no console defined
        return null;
    }

    onDesktopConsoleDownload (type) {
        const { dispatch, vm } = this.props;
        // fire download of the .vv file
        dispatch(vmDesktopConsole(vm, vm.displays[type]));
    }

    render () {
        const { vm, onAddErrorNotification } = this.props;

        if (!LibvirtDBus.canConsole || !LibvirtDBus.canConsole(vm.state)) {
            return (<VmNotRunning />);
        }

        const serialConsoleCommand = LibvirtDBus.serialConsoleCommand({ vm });

        const onDesktopConsole = () => { // prefer spice over vnc
            this.onDesktopConsoleDownload(vm.displays.spice ? 'spice' : 'vnc');
        };

        return (
            <AccessConsoles preselectedType={this.getDefaultConsole()}
                            textSelectConsoleType={_("Select console type")}
                            textSerialConsole={_("Serial console")}
                            textVncConsole={_("VNC console")}
                            textDesktopViewerConsole={_("Desktop viewer")}>
                {!!serialConsoleCommand &&
                <SerialConsole type="SerialConsole"
                               connectionName={vm.connectionName}
                               vmName={vm.name}
                               spawnArgs={serialConsoleCommand} />}
                {vm.displays && vm.displays.vnc &&
                <Vnc type="VncConsole"
                     vm={vm}
                     consoleDetail={vm.displays.vnc}
                     onAddErrorNotification={onAddErrorNotification} />}
                {vm.displays && (vm.displays.vnc || vm.displays.spice) &&
                <DesktopConsole type="DesktopViewer"
                                onDesktopConsole={onDesktopConsole}
                                displays={vm.displays} />}
            </AccessConsoles>
        );
    }
}
Consoles.propTypes = {
    vm: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default Consoles;
