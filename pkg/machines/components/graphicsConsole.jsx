/*jshint esversion: 6 */
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
import React from "react";
import cockpit from 'cockpit';
import Vnc from './vnc.jsx';
import DesktopConsoleDownload from './desktopConsole.jsx';
import { vmDesktopConsole } from '../actions.es6';
import { logDebug } from '../helpers.es6';

const _ = cockpit.gettext;

const NoConsole = () => { // TODO: add option to define graphics consoles
    return (
        <div>
            {_("No graphics console is defined for this virtual machine.")}
        </div>
    );
};

// TODO: fix: check the flow
const VmNotRunning = () => {
  return (
      <div>
          {_("Please start the virtual machine to access its graphics console.")}
      </div>
  );
};

const SwitchConsole = ({ displays, inBrowserConsole, onBrowserVNC, onDesktopConsole }) => {
    const onSwitchToDesktop = () => {
        setDefaultBrowserMode(false);
        onDesktopConsole();
    };
    const onSwitchToBrowser = () => {
        setDefaultBrowserMode(true);
        onBrowserVNC();
    };

    if (inBrowserConsole) {
        return (
            <div className='top-right-menu'>
                <a className='left-delimiter' href='#' onClick={onSwitchToDesktop}>
                    {_("Switch to Desktop Viewer")}
                </a>
            </div>
        );
    }

    if (displays.vnc) { // the VM has VNC defined
        return (
            <div className='top-right-menu'>
                <a className='left-delimiter' href='#' onClick={onSwitchToBrowser}>
                    {_("Switch to In-Browser Viewer")}
                </a>
            </div>
        );
    }

    return null;
};

const setDefaultBrowserMode = (inBrowser) => {
    const value = inBrowser ? 'true' : 'false';
    logDebug('Default Browser Console mode set to: ', value);
    window.localStorage.setItem('MACHINES_CONSOLE_IN_BROWSER_DEFAULT', value);
};

const getDefaultBrowserConsole = (displays) => {
    if (!displays) {
        return null;
    }

    // TODO: prefer SPICE over VNC once spice-html5 is implemented

    if (displays.vnc) {
        const vncInBrowserDefault = window.localStorage.getItem('MACHINES_CONSOLE_IN_BROWSER_DEFAULT') !== 'false';
        if (vncInBrowserDefault) {
            return 'vnc';
        }
    }

    return null; // no in-browser console is rendered
};

/**
 * Please note, this is React functional component.
 *
 * In addition to redux store, the GraphicsConsole component state depends on:
 *   - window.localStorage (browser/desktop default)
 *   - provider.onConsoleAboutToShow() processing (populating consoleDetails by provider-specifics on the time of opening)
 *   - internally managed this.setState() manipulations (to handle component-local user actions)
 */
class GraphicsConsole extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            inBrowserConsole: null,
            consoleDetail: null,
        };

        this.onBrowserVnc = this.onBrowserVnc.bind(this);
        this.onDesktopConsole = this.onDesktopConsole.bind(this);
    }

    componentDidMount () {
        if (getDefaultBrowserConsole(this.props.vm.displays) === 'vnc') {
            this.onBrowserVnc();
        } else if (this.props.vm.displays.spice) {
            this.onDesktopConsole();
        }
    }

    onBrowserVnc() {
        const { vm, config } = this.props;
        const { provider, providerState } = config;

        if (provider.onConsoleAboutToShow) {
            // Hook: Give provider chance to update consoleDetail before noVNC is initialized.
            // This update needs to be performed at the time of console retrieval, since provider-specific console
            // details might vary over time, like the password (in oVirt: the password is valid for 2 minutes only).
            provider.onConsoleAboutToShow({ type: 'vnc', vm, providerState }).then( consoleDetail => {
                if (consoleDetail) {
                    this.setState({inBrowserConsole: 'vnc', consoleDetail});
                } else { // vnc console can't be rendered (see provider for the reason)
                    console.info(`In-Browser VNC console is disabled by external provider`);
                    this.setState({inBrowserConsole: null, consoleDetail: null});
                }
            });
        } else {
            this.setState({inBrowserConsole: 'vnc', consoleDetail: vm.displays.vnc});
        }
    }

    onDesktopConsole(detail) {
        const { vm, dispatch } = this.props;

        this.setState({inBrowserConsole: null, consoleDetail: null});

        if (detail) { // fire download of the .vv file
            dispatch(vmDesktopConsole(vm, detail));
        }
    }

    render() {
        const { vm, config } = this.props;
        const provider = config.provider;
        const displays = vm.displays;

        if (!(displays && (displays.spice || displays.vnc))) {
            return (<NoConsole />);
        }

        if (!provider.canConsole || !provider.canConsole(vm.state)) {
            return (<VmNotRunning />);
        }

        let content = null;
        switch (this.state.inBrowserConsole) { // TODO: add spice once implemented for in-browser
            case 'vnc':
                content = <Vnc vm={vm} consoleDetail={this.state.consoleDetail} />;
                break;
            case null: // no in-browser console rendered
                content = <DesktopConsoleDownload vm={vm} config={config} onDesktopConsole={this.onDesktopConsole} />;
                break;
            default:
                console.error(`Unexpected in-browser console type: ${this.state.inBrowserConsole}`);
        }

        return (
            <div>
                <SwitchConsole displays={displays}
                               inBrowserConsole={this.state.inBrowserConsole}
                               onBrowserVNC={this.onBrowserVnc}
                               onDesktopConsole={this.onDesktopConsole} />
                {content}
            </div>
        );
    }
}

export default GraphicsConsole;
