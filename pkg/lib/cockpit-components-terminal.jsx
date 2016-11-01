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

(function() {
    "use strict";

    var React = require("react");
    var Term = require("term");

    require("console.css");

    /*
     * A terminal component that communicates over a cockpit channel.
     *
     * The only required property is 'channel', which must point to a cockpit
     * stream channel.
     *
     * The size of the terminal defaults to 80 by 25. It can be changed with the
     * 'rows' and 'cols' properties.
     *
     * If the 'onTitleChanged' callback property is set, it will be called whenever
     * the title of the terminal changes.
     *
     * Call focus() to set the input focus on the terminal.
     */
    var Terminal = React.createClass({
        propTypes: {
            cols: React.PropTypes.number,
            rows: React.PropTypes.number,
            channel: React.PropTypes.object.isRequired,
            onTitleChanged: React.PropTypes.func
        },

        getDefaultProps: function () {
            return {
                cols: 80,
                rows: 25
            };
        },

        componentWillMount: function () {
            var term = new Term({
                cols: this.props.cols,
                rows: this.props.rows,
                screenKeys: true,
                useStyle: true
            });

            term.on('data', function(data) {
                if (this.props.channel.valid)
                    this.props.channel.send(data);
            }.bind(this));

            if (this.props.onTitleChanged)
                term.on('title', this.props.onTitleChanged);

            this.setState({ terminal: term });
        },

        componentDidMount: function () {
            this.state.terminal.open(this.refs.terminal);
            this.connectChannel();
        },

        componentWillUpdate: function (nextProps) {
            if (nextProps.cols !== this.props.cols || nextProps.rows !== this.props.rows)
                this.state.terminal.resize(nextProps.cols, nextProps.rows);

            if (nextProps.channel !== this.props.channel) {
                this.state.terminal.reset();
                this.disconnectChannel();
            }
        },

        componentDidUpdate: function (prevProps) {
            if (prevProps.channel !== this.props.channel)
                this.connectChannel();
        },

        render: function () {
            // ensure react never reuses this div by keying it with the terminal widget
            return <div ref="terminal" className="console-ct" key={this.state.terminal} />;
        },

        componentWillUnmount: function () {
            this.disconnectChannel();
            this.state.terminal.destroy();
        },

        onChannelMessage: function (event, data) {
            this.state.terminal.write(data);
        },

        onChannelClose: function (event, options) {
            var term = this.state.terminal;
            term.write('\x1b[31m' + (options.problem || 'disconnected') + '\x1b[m\r\n');
            term.cursorHidden = true;
            term.refresh(term.y, term.y);
        },

        connectChannel: function () {
            var channel = this.props.channel;
            if (channel && channel.valid) {
                channel.addEventListener('message', this.onChannelMessage.bind(this));
                channel.addEventListener('close', this.onChannelClose.bind(this));
            }
        },

        disconnectChannel: function () {
            if (this.props.channel) {
                this.props.channel.removeEventListener('message', this.onChannelMessage);
                this.props.channel.removeEventListener('close', this.onChannelClose);
            }
        },

        focus: function () {
            if (this.state.terminal)
                this.state.terminal.focus();
        }
    });

    module.exports = { Terminal: Terminal };
}());
