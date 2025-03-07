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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { MenuList, MenuItem } from "@patternfly/react-core/dist/esm/components/Menu";
import { CanvasAddon } from '@xterm/addon-canvas';
import { Terminal as Term } from "@xterm/xterm";

import { ContextMenu } from "cockpit-components-context-menu.jsx";
import cockpit from "cockpit";

import "console.css";

const _ = cockpit.gettext;

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

export type TerminalTheme = keyof typeof themes;

/*
 * A terminal component that communicates over a cockpit channel.
 *
 * The state of a terminal component can be managed separately from
 * it. This allows a terminal to stay alive and keep its content while
 * it is not actually part of the DOM.
 *
 * This is done by creating a TerminalState object for the channel,
 * and then passing this object into a Terminal component via the
 * "state" property.  You can dispose of the TerminalState object by
 * calling its close() method. This will also close the channel.
 *
 * (So instead of managing the lifetime of a Cockpit channel, you
 * manage the lifetime of a TerminalState wrapper for the channel, in
 * exactly the same way.)
 *
 * If you don't need to keep a terminal alive while it is not part of
 * the DOM, you can pass the channel directly into the Terminal
 * component via the "channel" property.  The Terminal component will
 * then maintain a internal TerminalState wrapper for the channel.
 *
 * The "state" and "channel" properties are of course mutually
 * exclusive: You can only use one of them for a given Terminal
 * component.  Also, switching from one to the other over the lifetime
 * of a Terminal component is not supported.
 *
 * The size of the terminal can be set with the 'rows' and 'cols'
 * properties. If those properties are not given, the terminal will
 * fill its container.
 *
 * If the 'onTitleChanged' callback property is set, it will be called
 * whenever the title of the terminal changes.
 *
 * Call focus() on the Terminal component to set the input focus on
 * the terminal, or reset() to clear it.
 *
 * Also it is possible to set up theme by property 'theme'.
 */

export class TerminalState {
    terminal: Term;
    wrapper_element: HTMLDivElement;
    channel: cockpit.Channel<string>;

    constructor(channel: cockpit.Channel<string>) {
        this.terminal = new Term({
            cols: 80,
            rows: 1,
            cursorBlink: true,
            fontSize: 16,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            screenReaderMode: true,
        });
        this.terminal.loadAddon(new CanvasAddon());
        this.wrapper_element = document.createElement("div");
        this.channel = channel;
        this.#connectChannel(channel);
    }

    #connectChannel(channel: cockpit.Channel<string>) {
        channel.addEventListener('message', (_event, data) => {
            this.terminal.write(data);
        });

        this.terminal.onData(data => {
            if (channel.valid) {
                /* HACK: Ctrl+Space (and possibly other
                 * characters) is a disaster: While it is U+00A0
                 * in unicode, with an UTF-8 representation of
                 * 0xC2A0, the "visible" string in JS is 0x00
                 * (with TextEncoder, btoa(), and string
                 * comparison). The internal representation
                 * retains half of it, and trying to send it to
                 * the websocket would result in a single 0xA0,
                 * which is invalid UTF-8 (and causes the session
                 * to crash). So intercept and ignore such broken
                 * chars.  See
                 * https://github.com/cockpit-project/cockpit/issues/21213 */
                if (data === '\x00') {
                    console.log("terminal: ignoring invalid input", data);
                    return;
                }
                channel.send(data);
            }
        });

        channel.addEventListener('close', (_event, options) => {
            const term = this.terminal;
            term.write('\x1b[31m' + (options.problem || 'disconnected') + '\x1b[m\r\n');
            term.refresh(term.rows, term.rows);
        });
    }

    resetChannel(channel: cockpit.Channel<string>) {
        this.channel.close();
        this.terminal.reset();
        this.channel = channel;
        this.#connectChannel(channel);
    }

    close() {
        this.channel.close();
        this.terminal.dispose();
    }
}

interface TerminalComponentProps {
    parentId: string;
    state?: TerminalState;
    channel?: cockpit.Channel<string>;
    onTitleChanged?: (title: string) => void;
    fontSize?: number;
    rows?: number;
    cols?: number;
    theme?: TerminalTheme;
}

interface TerminalComponentState {
    showPastingModal: boolean,
    cols: number,
    rows: number
}

export class Terminal extends React.Component<TerminalComponentProps, TerminalComponentState> {
    terminal_state: TerminalState;
    terminalRef: React.RefObject<HTMLDivElement>;
    terminal: Term;

    constructor(props: TerminalComponentProps) {
        super(props);
        this.reset = this.reset.bind(this);
        this.focus = this.focus.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
        this.resizeTerminal = this.resizeTerminal.bind(this);
        this.onFocusIn = this.onFocusIn.bind(this);
        this.onFocusOut = this.onFocusOut.bind(this);
        this.setText = this.setText.bind(this);
        this.getText = this.getText.bind(this);
        this.setTerminalTheme = this.setTerminalTheme.bind(this);

        if (this.props.state) {
            cockpit.assert(!this.props.channel);
            this.terminal_state = this.props.state;
        } else {
            cockpit.assert(this.props.channel);
            this.terminal_state = new TerminalState(this.props.channel);
        }

        const term = this.terminal_state.terminal;

        this.terminalRef = React.createRef<HTMLDivElement>();

        if (props.onTitleChanged)
            term.onTitleChange(props.onTitleChanged);

        this.terminal = term;
        this.state = {
            showPastingModal: false,
            cols: term.cols,
            rows: term.rows
        };
    }

    mountTerminal(state: TerminalState) {
        this.terminal = state.terminal;
        this.terminalRef.current?.appendChild(state.wrapper_element);
        this.terminal.open(state.wrapper_element);

        if (this.props.fontSize)
            this.terminal.options.fontSize = this.props.fontSize;

        if (this.props.cols && this.props.rows) {
            this.resizeTerminal(this.props.cols, this.props.rows);
        }

        this.setTerminalTheme(this.props.theme || 'black-theme');
        this.terminal.focus();
    }

    unmountTerminal(state: TerminalState) {
        this.terminalRef.current?.removeChild(state.wrapper_element);
        // This makes sure that the terminal will not cause its new
        // container to grow when it is reattached later.
        if (!this.props.rows)
            this.resizeTerminal(80, 1);
    }

    componentDidMount() {
        this.mountTerminal(this.terminal_state);
        if (!this.props.rows) {
            window.addEventListener('resize', this.onWindowResize);
            this.onWindowResize();
        }
    }

    resizeTerminal(cols: number, rows: number) {
        this.terminal.resize(cols, rows);
        if (this.terminal_state.channel) {
            this.terminal_state.channel.control({
                window: {
                    rows,
                    cols
                }
            } as cockpit.JsonObject as cockpit.ControlMessage);
        }
    }

    componentDidUpdate(prevProps: TerminalComponentProps, prevState: TerminalComponentState) {
        if (this.props.state && prevProps.state !== this.props.state) {
            cockpit.assert(!this.props.channel);
            cockpit.assert(prevProps.state);
            this.unmountTerminal(prevProps.state);
            this.terminal_state = this.props.state;
            this.mountTerminal(this.terminal_state);
            if (!this.props.cols || !this.props.rows)
                this.resizeTerminal(this.state.cols, this.state.rows);
        }

        if (this.props.channel && prevProps.channel !== this.props.channel) {
            cockpit.assert(!this.props.state);
            this.terminal_state.resetChannel(this.props.channel);
            if (!this.props.cols || !this.props.rows)
                this.resizeTerminal(this.state.cols, this.state.rows);
        }

        if (this.props.fontSize && prevProps.fontSize !== this.props.fontSize) {
            this.terminal.options.fontSize = this.props.fontSize;

            // After font size is changed, resize needs to be triggered
            const dimensions = this.calculateDimensions();
            if (dimensions.cols !== this.state.cols || dimensions.rows !== this.state.rows) {
                this.onWindowResize();
            } else {
                // When font size changes but dimensions are the same, we need to force `resize`
                this.resizeTerminal(dimensions.cols - 1, dimensions.rows);
            }
        }

        if (prevState.cols !== this.state.cols || prevState.rows !== this.state.rows)
            this.resizeTerminal(this.state.cols, this.state.rows);

        if (this.props.theme && prevProps.theme !== this.props.theme)
            this.setTerminalTheme(this.props.theme);

        this.terminal.focus();
    }

    render() {
        const contextMenuList = (
            <MenuList>
                <MenuItem className="contextMenuOption" onClick={this.getText}>
                    <div className="contextMenuName"> { _("Copy") } </div>
                    <div className="contextMenuShortcut">{ _("Ctrl+Insert") }</div>
                </MenuItem>
                <MenuItem className="contextMenuOption" onClick={this.setText}>
                    <div className="contextMenuName"> { _("Paste") } </div>
                    <div className="contextMenuShortcut">{ _("Shift+Insert") }</div>
                </MenuItem>
            </MenuList>
        );

        return (
            <>
                <Modal position="top"
                       variant="small"
                       isOpen={this.state.showPastingModal}
                       onClose={() => this.setState({ showPastingModal: false })}>
                    <ModalHeader title={_("Paste error")} />
                    <ModalBody>
                        {_("Your browser does not allow paste from the context menu. You can use Shift+Insert.")}
                    </ModalBody>
                    <ModalFooter>
                        <Button key="cancel" variant="secondary" onClick={() => this.setState({ showPastingModal: false })}>
                            {_("Close")}
                        </Button>
                    </ModalFooter>
                </Modal>
                <div ref={this.terminalRef}
                     className="console-ct"
                     onFocus={this.onFocusIn}
                     onBlur={this.onFocusOut} />
                <ContextMenu parentId={this.props.parentId}>
                    {contextMenuList}
                </ContextMenu>
            </>
        );
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.onWindowResize);
        this.onFocusOut();
        this.unmountTerminal(this.terminal_state);
        if (!this.props.state)
            this.terminal_state.close();
    }

    setText() {
        try {
            navigator.clipboard.readText()
                    .then(text => this.terminal_state.channel?.send(text))
                    .catch(() => this.setState({ showPastingModal: true }))
                    .finally(() => this.terminal.focus());
        } catch {
            this.setState({ showPastingModal: true });
        }
    }

    getText() {
        try {
            navigator.clipboard.writeText(this.terminal.getSelection())
                    .catch(e => console.error('Text could not be copied, use Ctrl+Insert ', e ? e.toString() : ""))
                    .finally(() => this.terminal.focus());
        } catch (error) {
            console.error('Text could not be copied, use Ctrl+Insert:', String(error));
        }
    }

    reset() {
        this.terminal.reset();
        this.terminal_state.channel?.send(String.fromCharCode(12)); // Send SIGWINCH to show prompt on attaching
    }

    focus() {
        if (this.terminal)
            this.terminal.focus();
    }

    calculateDimensions() {
        const padding = 10; // Leave a bit of space around terminal
        // @ts-expect-error: we are accessing internals here...
        const core = this.terminal._core;
        const realHeight = core._renderService.dimensions.css.cell.height;
        const realWidth = core._renderService.dimensions.css.cell.width;
        const parentHeight = this.terminalRef.current?.parentElement?.clientHeight;
        const parentWidth = this.terminalRef.current?.parentElement?.clientWidth;
        if (realHeight && realWidth && realWidth !== 0 && realHeight !== 0 && parentHeight && parentWidth)
            return {
                // it can happen that parent{Width,Height} are not yet initialized (0), avoid negative values
                rows: Math.max(Math.floor((parentHeight - padding) / realHeight), 1),
                cols: Math.max(Math.floor((parentWidth - padding - 12) / realWidth), 1) // Remove 12px for scrollbar
            };

        return { rows: this.state.rows, cols: this.state.cols };
    }

    onWindowResize() {
        this.setState(this.calculateDimensions());
    }

    setTerminalTheme(theme: TerminalTheme) {
        this.terminal.options.theme = themes[theme];
    }

    onBeforeUnload(event: Event) {
        // Firefox requires this when the page is in an iframe
        event.preventDefault();

        // Included for legacy support, e.g. Chrome/Edge < 119
        event.returnValue = true;
    }

    onFocusIn() {
        window.addEventListener('beforeunload', this.onBeforeUnload);
    }

    onFocusOut() {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
    }
}
