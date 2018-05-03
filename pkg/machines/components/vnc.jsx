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
import cockpit from 'cockpit';

import { VncConsole } from '@patternfly/react-console';

import { logDebug } from '../helpers.es6';

const _ = cockpit.gettext;

class Vnc extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            path: undefined,
        };

        this.connect = this.connect.bind(this);
        this.onDisconnected = this.onDisconnected.bind(this);
        this.onInitFailed = this.onInitFailed.bind(this);
    }

    connect(props) {
        if (this.state.path) { // already initialized
            return;
        }

        // consoleDetail can be retrieved asynchronously (like in pkg/ovirt flow)
        const { consoleDetail } = props;
        if (!consoleDetail) {
            logDebug('Vnc component: console detail not yet provided');
            return;
        }

        cockpit.transport.wait(() => {
            const query = JSON.stringify({
                payload: "stream",
                protocol: "binary",
                binary: "raw",
                address: consoleDetail.address,
                port: parseInt(consoleDetail.tlsPort || consoleDetail.port, 10),
            });
            this.setState({
                path: `cockpit/channel/${cockpit.transport.csrf_token}?${window.btoa(query)}`,
            });
        });
    }

    componentWillMount() {
        this.connect(this.props);
    }

    componentWillReceiveProps(nextProps) {
        this.connect(nextProps);
    }

    getEncrypt() {
        return window.location.protocol === 'https:';
    }

    onDisconnected(detail) { // server disconnected
        console.info('Connection lost: ', detail);
    }

    onInitFailed(detail) {
        console.error('VncConsole failed to init: ', detail, this);
    }

    render() {
        const { consoleDetail } = this.props;
        const { path } = this.state;
        if (!consoleDetail || !path) {
            // postpone rendering until consoleDetail is known and channel ready
            return null;
        }

        const credentials = consoleDetail.password ? { password: consoleDetail.password } : undefined;
        const encrypt = this.getEncrypt();

        return (
            <VncConsole host={window.location.hostname}
                        port={window.location.port || (encrypt ? '443' : '80')}
                        path={path}
                        encrypt={encrypt}
                        credentials={credentials}
                        vncLogging='warn'
                        onDisconnected={this.onDisconnected}
                        onInitFailed={this.onInitFailed}
                        textConnecting={_("Connecting")}
                        textDisconnected={_("Disconnected")}
                        textSendShortcut={_("Send key")}
                        textCtrlAltDel={_("Ctrl+Alt+Del")}>
                <div className='console-menu'>
                    {this.props.children}
                </div>
            </VncConsole>
        );
    }
}

// TODO: define propTypes

export default Vnc;
