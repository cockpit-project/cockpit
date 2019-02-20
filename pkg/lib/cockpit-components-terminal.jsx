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
import ReactDOM from "react-dom";
import PropTypes from "prop-types";
import { Terminal as Term } from "xterm";
import { ContextMenu } from "cockpit-components-context-menu.jsx";
import "console.css";

const theme_core = {
    yellow: "#b58900",
    brightRed: "#cb4b16",
    red: "#dc322f",
    magenta: "#d33682",
    brightMagenta: "#6c71c4",
    blue: "#268bd2",
    cyan: "#2aa198",
    green: "#859900"
};

const themes = {
    "black-theme": {
        background: "#000000",
        foreground: "#ffffff"
    },
    "dark-theme": Object.assign({}, theme_core, {
        background: "#002b36",
        foreground: "#fdf6e3",
        cursor: "#eee8d5",
        selection: "#ffffff77",
        brightBlack: "#002b36",
        black: "#073642",
        brightGreen: "#586e75",
        brightYellow: "#657b83",
        brightBlue: "#839496",
        brightCyan: "#93a1a1",
        white: "#eee8d5",
        brightWhite: "#fdf6e3"
    }),
    "light-theme": Object.assign({}, theme_core, {
        background: "#fdf6e3",
        foreground: "#002b36",
        cursor: "#073642",
        selection: "#00000044",
        brightWhite: "#002b36",
        white: "#073642",
        brightCyan: "#586e75",
        brightBlue: "#657b83",
        brightYellow: "#839496",
        brightGreen: "#93a1a1",
        black: "#eee8d5",
        brightBlack: "#fdf6e3"
    }),
    "white-theme": {
        background: "#ffffff",
        foreground: "#000000",
        selection: "#00000044",
        cursor: "#000000",
    },
};

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
 *
 * Also it is possible to set up theme by property 'theme'.
 */
export class Terminal extends React.Component {
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
        this.setText = this.setText.bind(this);
        this.getText = this.getText.bind(this);
        this.setTerminalTheme = this.setTerminalTheme.bind(this);
    }

    componentWillMount() {
        var term = new Term({
            cols: this.props.cols || 80,
            rows: this.props.rows || 25,
            screenKeys: true,
            cursorBlink: true,
            fontSize: 12,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            screenReaderMode: true
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
        this.setTerminalTheme(this.props.theme || 'black-theme');
        this.state.terminal.focus();
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

        if (nextProps.theme !== this.props.theme)
            this.setTerminalTheme(nextProps.theme);
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
        this.state.terminal.focus();
    }

    render() {
        return (
            <React.Fragment>
                <div ref="terminal"
                        key={this.state.terminal}
                        className="console-ct"
                        onFocus={this.onFocusIn}
                        onContextMenu={this.contextMenu}
                        onBlur={this.onFocusOut} />
                <ContextMenu setText={this.setText} getText={this.getText} />
            </React.Fragment>
        );
    }

    componentWillUnmount() {
        this.disconnectChannel();
        this.state.terminal.destroy();
        window.removeEventListener('resize', this.onWindowResize);
    }

    setText() {
        try {
            navigator.clipboard.readText()
                    .then(text => this.props.channel.send(text))
                    .catch(e => console.error('Text could not be pasted, use Shift+Insert ', e ? e.toString() : ""))
                    .finally(() => this.state.terminal.focus());
        } catch (error) {
            console.error('Text could not be pasted, use Shift+Insert:', error.toString());
        }
    }

    getText() {
        try {
            navigator.clipboard.writeText(this.state.terminal.getSelection())
                    .catch(e => console.error('Text could not be copied, use Ctrl+Insert ', e ? e.toString() : ""))
                    .finally(() => this.state.terminal.focus());
        } catch (error) {
            console.error('Text could not be copied, use Ctrl+Insert:', error.toString());
        }
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

        var realHeight = this.state.terminal._core.renderer.dimensions.actualCellHeight;
        var realWidth = this.state.terminal._core.renderer.dimensions.actualCellWidth;
        this.setState({
            rows: Math.floor((node.parentElement.clientHeight - padding) / realHeight),
            cols: Math.floor((node.parentElement.clientWidth - padding) / realWidth)
        });
    }

    setTerminalTheme(theme) {
        this.state.terminal.setOption("theme", themes[theme]);
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

Terminal.propTypes = {
    cols: PropTypes.number,
    rows: PropTypes.number,
    channel: PropTypes.object.isRequired,
    onTitleChanged: PropTypes.func,
    theme: PropTypes.string
};
