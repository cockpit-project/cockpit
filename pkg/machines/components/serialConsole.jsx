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

import { SerialConsole } from '@patternfly/react-console';

const _ = cockpit.gettext;

const XTERM_FONT_FAMILY = 'Menlo, Monaco, Consolas, monospace';
const XTERM_FONT_SIZE = 12;
const XTERM_COLS = 90;
const XTERM_ROWS = 30;

class SerialConsoleCockpit extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            channel: undefined,
        };

        this.onConnect = this.onConnect.bind(this);
        this.onDisconnect = this.onDisconnect.bind(this);
        this.onResize = this.onResize.bind(this);

        this.onData = this.onData.bind(this);
        this.onChannelMessage = this.onChannelMessage.bind(this);
        this.onChannelClose = this.onChannelClose.bind(this);

        this.getStatus = this.getStatus.bind(this);
    }

    /**
     * Use Cockpit channel
     */
    onConnect () {
        const channel = cockpit.channel({
            "payload": "stream",
            "spawn": this.props.spawnArgs,
            "pty": true,
        });

        channel.addEventListener('message', this.onChannelMessage);
        channel.addEventListener('close', this.onChannelClose);

        this.setState({ channel });
    }

    /**
     * Terminal component emitted data, like user key press.
     * Send them to the backend.
     */
    onData (data) {
        const channel = this.state.channel;
        if (channel && channel.valid) {
            channel.send(data);
        }
    }

    onDisconnect () {
        const channel = this.state.channel;

        if (channel) {
            channel.close();
            channel.removeEventListener('message', this.onChannelMessage);
            channel.removeEventListener('close', this.onChannelClose);
            this.setState({ channel: null });
        }
    }

    onChannelMessage (event, data) {
        if (this.refs.serialconsole) {
            this.refs.serialconsole.onDataReceived(data);
        }
    }

    onChannelClose (event, options) {
        if (this.refs.serialconsole) {
            this.refs.serialconsole.onConnectionClosed(options.problem);
        }
    }

    onResize (rows, cols) {
        if (this.state.channel) {
            this.state.channel.control({
                window: {
                    rows,
                    cols,
                }
            });
        }
    }

    getStatus () {
        if (this.state.channel)
            return 'connected';

        if (this.state.channel === null)
            return 'disconnected';

        return 'loading';
    }

    render () {
        return (
            <React.Fragment>
                {this.props.children}
                <SerialConsole id={this.props.vmName} ref='serialconsole'
                    rows={XTERM_ROWS}
                    cols={XTERM_COLS}
                    fontFamily={XTERM_FONT_FAMILY}
                    fontSize={XTERM_FONT_SIZE}
                    status={this.getStatus()}
                    onConnect={this.onConnect}
                    onDisconnect={this.onDisconnect}
                    onResize={this.onResize}
                    onData={this.onData}
                    textDisconnect={_("Disconnect")}
                    textDisconnected={_("Disconnected from serial console. Click the Reconnect button.")}
                    textReconnect={_("Reconnect")}
                    textLoading={_("Loading ...")}
                    topClassName="" />
            </React.Fragment>
        );
    }
}

SerialConsoleCockpit.propTypes = {
    vmName: PropTypes.string.isRequired,
    spawnArgs: PropTypes.array.isRequired,
    children: PropTypes.node.isRequired,
};

export default SerialConsoleCockpit;
