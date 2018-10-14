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
    var ReactDOM = require("react-dom");
    var PropTypes = require("prop-types");

    var Term = require("term");

    require("console.css");

    /*
     * A terminal component that communicates over a cockpit channel.
     *
     * The only required property is 'channel', which must point to a cockpit
     * stream channel.
     *
     * The size of the terminal can be set with the 'rows' and 'cols'
     * properties. If those properties are not given, the terminal will fill
     * its container.
     *
     * If the 'onTitleChanged' callback property is set, it will be called whenever
     * the title of the terminal changes.
     *
     * Call focus() to set the input focus on the terminal.
     */
    class Terminal extends React.Component {
        constructor(props) {
            super(props);
            this.onChannelMessage = this.onChannelMessage.bind(this);
            this.onChannelClose = this.onChannelClose.bind(this);
            this.onWindowResize = this.onWindowResize.bind(this);
            this.connectChannel = this.connectChannel.bind(this);
            this.disconnectChannel = this.disconnectChannel.bind(this);
            this.focus = this.focus.bind(this);
            this.onWindowResize = this.onWindowResize.bind(this);
            this.onFocusIn = this.onFocusIn.bind(this);
            this.onFocusOut = this.onFocusOut.bind(this);
        }

        componentWillMount() {
            var term = new Term({
                cols: this.props.cols || 80,
                rows: this.props.rows || 25,
                screenKeys: true
            });

            term.on('data', function(data) {
                if (this.props.channel.valid)
                    this.props.channel.send(data);
            }.bind(this));

            if (this.props.onTitleChanged)
                term.on('title', this.props.onTitleChanged);

            this.setState({ terminal: term });
        }

        componentDidMount() {
            this.state.terminal.open(this.refs.terminal);
            this.connectChannel();

            if (!this.props.rows) {
                window.addEventListener('resize', this.onWindowResize);
                this.onWindowResize();
            }
        }

        componentWillUpdate(nextProps, nextState) {
            if (nextState.cols !== this.state.cols || nextState.rows !== this.state.rows) {
                this.state.terminal.resize(nextState.cols, nextState.rows);
                this.props.channel.control({
                    window: {
                        rows: nextState.rows,
                        cols: nextState.cols
                    }
                });
            }

            if (nextProps.channel !== this.props.channel) {
                this.state.terminal.reset();
                this.disconnectChannel();
            }
        }

        componentDidUpdate(prevProps) {
            if (prevProps.channel !== this.props.channel) {
                this.connectChannel();
                this.props.channel.control({
                    window: {
                        rows: this.state.rows,
                        cols: this.state.cols
                    }
                });
            }
        }

        render() {
            // ensure react never reuses this div by keying it with the terminal widget
            return <div ref="terminal"
                        key={this.state.terminal}
                        className="console-ct"
                        onFocus={this.onFocusIn}
                        onBlur={this.onFocusOut} />;
        }

        componentWillUnmount() {
            this.disconnectChannel();
            this.state.terminal.destroy();
            window.removeEventListener('resize', this.onWindowResize);
        }

        onChannelMessage(event, data) {
            this.state.terminal.write(data);
        }

        onChannelClose(event, options) {
            var term = this.state.terminal;
            term.write('\x1b[31m' + (options.problem || 'disconnected') + '\x1b[m\r\n');
            term.cursorHidden = true;
            term.refresh(term.y, term.y);
        }

        connectChannel() {
            var channel = this.props.channel;
            if (channel && channel.valid) {
                channel.addEventListener('message', this.onChannelMessage.bind(this));
                channel.addEventListener('close', this.onChannelClose.bind(this));
            }
        }

        disconnectChannel() {
            if (this.props.channel) {
                this.props.channel.removeEventListener('message', this.onChannelMessage);
                this.props.channel.removeEventListener('close', this.onChannelClose);
            }
        }

        focus() {
            if (this.state.terminal)
                this.state.terminal.focus();
        }

        onWindowResize() {
            var padding = 2 * 11;
            var node = ReactDOM.findDOMNode(this);
            var terminal = this.refs.terminal.querySelector('.terminal');

            var ch = document.createElement('span');
            ch.textContent = 'M';
            ch.style.position = 'absolute';
            terminal.appendChild(ch);
            var rect = ch.getBoundingClientRect();
            terminal.removeChild(ch);

            this.setState({
                rows: Math.floor((node.parentElement.clientHeight - padding) / rect.height),
                cols: Math.floor((node.parentElement.clientWidth - padding) / rect.width)
            });
        }

        onBeforeUnload(event) {
            // Firefox requires this when the page is in an iframe
            event.preventDefault();

            // see "an almost cross-browser solution" at
            // https://developer.mozilla.org/en-US/docs/Web/Events/beforeunload
            event.returnValue = '';
            return '';
        }

        onFocusIn() {
            window.addEventListener('beforeunload', this.onBeforeUnload);
        }

        onFocusOut() {
            window.removeEventListener('beforeunload', this.onBeforeUnload);
        }
    }
    Terminal.PropTypes = {
        cols: PropTypes.number,
        rows: PropTypes.number,
        channel: PropTypes.object.isRequired,
        onTitleChanged: PropTypes.func
    };

    module.exports = { Terminal: Terminal };
}());
