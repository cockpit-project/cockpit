/*jshint esversion: 6 */
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
import React from "react";
import cockpit from 'cockpit';
import {Terminal} from 'cockpit-components-terminal.jsx';

const _ = cockpit.gettext;


class SerialConsole extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            channel: undefined,
        };

        this.focusTerminal = this.focusTerminal.bind(this);
        this.onResetClick = this.onResetClick.bind(this);
        this.onDisconnectClick = this.onDisconnectClick.bind(this);
    }

    createChannel () {
        const { spawnArgs } = this.props;

        return cockpit.channel({
            "payload": "stream",
            "spawn": spawnArgs,
            "pty": true,
        });
    }

    componentWillMount () {
        this.setState({channel: this.createChannel()});
    }

    componentWillUnmount () {
        if (this.state.channel)
            this.state.channel.close();
    }

    onResetClick (event) {
        if (event.button !== 0)
            return;

        if (this.state.channel)
            this.state.channel.close();

        this.setState({channel: this.createChannel()});

        this.focusTerminal();
    }

    onDisconnectClick (event) {
        if (event.button !== 0)
            return;

        if (this.state.channel)
            this.state.channel.close();

        this.setState({channel: null});

        this.focusTerminal();
    }

    focusTerminal () {
        this.refs.resetButton.blur();
        this.refs.disconnectButton.blur();

        if (this.refs.terminal)
            this.refs.terminal.focus();
    }

    render () {
        const { vmName } = this.props;

        let terminal;
        if (this.state.channel) {
            terminal = (<Terminal ref="terminal" channel={this.state.channel}/>);
        } else if (this.state.channel === null) {
            terminal = <span>{_("Disconnected from serial console. Click the Reconnect button.")}</span>
        } else {
            terminal = <span>{_("Loading ...")}</span>;
        }

        const disconnectDisabled = (!this.state.channel) && 'disabled' || '';

        return (
            <div className="console-ct-container">
                <div className="console-actions">
                    <button ref="disconnectButton" id={`${vmName}-serialconsole-disconnect`}
                            className={`btn btn-default console-actions-buttons ${disconnectDisabled}`}
                            onClick={this.onDisconnectClick}>
                        {_("Disconnect")}
                    </button>

                    <button ref="resetButton" id={`${vmName}-serialconsole-reconnect`}
                            className="btn btn-default console-actions-buttons" onClick={this.onResetClick}>
                        {_("Reconnect")}
                    </button>
                </div>

                <div className="panel-body machines-terminal">
                    {terminal}
                </div>
            </div>
        );
    }
}

export default SerialConsole;
