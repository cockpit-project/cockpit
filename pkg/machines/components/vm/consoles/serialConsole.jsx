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

import { Terminal } from "cockpit-components-terminal.jsx";

const _ = cockpit.gettext;

class SerialConsoleCockpit extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            channel: undefined,
        };

        this.createChannel = this.createChannel.bind(this);
        this.onDisconnect = this.onDisconnect.bind(this);
    }

    componentDidMount() {
        this.createChannel();
    }

    createChannel () {
        const opts = {
            payload: "stream",
            spawn: this.props.spawnArgs,
            pty: true,
        };
        if (this.props.connectionName == "system")
            opts.superuser = "try";
        const channel = cockpit.channel(opts);
        this.setState({ channel });
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

    render () {
        const pid = this.props.vmName + "-terminal";
        let t = <span>{_("Loading...")}</span>;
        if (this.state.channel) {
            t = <Terminal
             refName={this.props.vmName}
             channel={this.state.channel}
             parentId={pid}
            />;
        } else if (this.state.channel === null) {
            t = <span>{_("Disconnected from serial console. Click the connect button.")}</span>;
        }

        return (
            <>
                <div className="pf-c-console__actions-serial">
                    {this.state.channel
                        ? <button id={this.props.vmName + "-serialconsole-disconnect"} className="pf-c-button pf-m-secondary" onClick={this.onDisconnect}>{_("Disconnect")}</button>
                        : <button id={this.props.vmName + "-serialconsole-connect"} className="pf-c-button pf-m-secondary" onClick={this.createChannel}>{_("Connect")}</button>
                    }
                </div>
                <div id={pid} className="vm-terminal pf-c-console__serial">
                    {t}
                </div>
            </>
        );
    }
}

SerialConsoleCockpit.propTypes = {
    connectionName: PropTypes.string.isRequired,
    vmName: PropTypes.string.isRequired,
    spawnArgs: PropTypes.array.isRequired,
};

export default SerialConsoleCockpit;
