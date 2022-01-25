import cockpit from "cockpit";
import '../lib/patternfly/patternfly-4-cockpit.scss';

import React from "react";
import ReactDOM from "react-dom";
import {
    FormSelect, FormSelectOption, NumberInput,
    Toolbar, ToolbarContent, ToolbarItem, ToolbarGroup
} from "@patternfly/react-core";

import { Terminal } from "cockpit-components-terminal.jsx";

const _ = cockpit.gettext;

(function() {
    cockpit.translate();

    /*
     * A terminal component for the cockpit user.
     *
     * Uses the Terminal component from base1 internally, but adds a header
     * with title and Reset button.
     *
     * Spawns the user's shell in the user's home directory.
     */
    class UserTerminal extends React.Component {
        createChannel(user) {
            return cockpit.channel({
                payload: "stream",
                spawn: [user.shell || "/bin/bash"],
                environ: [
                    "TERM=xterm-256color",
                ],
                directory: user.home || "/",
                pty: true
            });
        }

        constructor(props) {
            super(props);
            const theme = document.cookie.replace(/(?:(?:^|.*;\s*)theme_cookie\s*=\s*([^;]*).*$)|^.*$/, "$1");
            const size = document.cookie.replace(/(?:(?:^|.*;\s*)size_cookie\s*=\s*([^;]*).*$)|^.*$/, "$1");
            this.state = {
                title: 'Terminal',
                theme: theme || "black-theme",
                size: parseInt(size) || 16,
            };
            this.onTitleChanged = this.onTitleChanged.bind(this);
            this.onResetClick = this.onResetClick.bind(this);
            this.onThemeChanged = this.onThemeChanged.bind(this);
            this.onPlus = this.onPlus.bind(this);
            this.onMinus = this.onMinus.bind(this);

            this.terminalRef = React.createRef();
            this.resetButtonRef = React.createRef();

            this.minSize = 6;
            this.maxSize = 40;
        }

        componentDidMount() {
            cockpit.user().done(function (user) {
                this.setState({ user: user, channel: this.createChannel(user) });
            }.bind(this));
        }

        onTitleChanged(title) {
            this.setState({ title: title });
        }

        setCookie(key, value) {
            const cookie = key + "=" + encodeURIComponent(value) +
                         "; path=/; expires=Sun, 16 Jul 3567 06:23:41 GMT";
            document.cookie = cookie;
        }

        onPlus() {
            this.setState((state, _) => {
                this.setCookie("size_cookie", state.size + 1);
                return { size: state.size + 1 };
            });
        }

        onMinus() {
            this.setState((state, _) => {
                this.setCookie("size_cookie", state.size - 1);
                return { size: state.size - 1 };
            });
        }

        onThemeChanged(value) {
            this.setState({ theme: value });
            this.setCookie("theme_cookie", value);
        }

        onResetClick(event) {
            if (event.button !== 0)
                return;

            if (!this.state.channel.valid && this.state.user)
                this.setState({ channel: this.createChannel(this.state.user) });
            else
                this.terminalRef.current.reset();

            // don't focus the button, but keep it on the terminal
            this.resetButtonRef.current.blur();
            this.terminalRef.current.focus();
        }

        render() {
            const terminal = this.state.channel
                ? <Terminal ref={this.terminalRef}
                            channel={this.state.channel}
                            theme={this.state.theme}
                            fontSize={this.state.size}
                            parentId="the-terminal"
                            onTitleChanged={this.onTitleChanged} />
                : <span>Loading...</span>;

            return (
                <div className="console-ct-container">
                    <div className="terminal-group">
                        <tt className="terminal-title">{this.state.title}</tt>
                        <Toolbar id="toolbar">
                            <ToolbarContent>
                                <ToolbarGroup>
                                    <ToolbarItem variant="label" id="size-select">
                                        {_("Font size")}
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        <NumberInput
                                            className="font-size"
                                            value={this.state.size}
                                            min={this.minSize}
                                            max={this.maxSize}
                                            onMinus={this.onMinus}
                                            onPlus={this.onPlus}
                                            inputAriaLabel={_("Font size")}
                                            minusBtnAriaLabel={_("Decrease by one")}
                                            plusBtnAriaLabel={_("Increase by one")}
                                            widthChars={2}
                                        />
                                    </ToolbarItem>
                                </ToolbarGroup>
                                <ToolbarGroup>
                                    <ToolbarItem variant="label" id="theme-select">
                                        {_("Appearance")}
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        <FormSelect onChange={this.onThemeChanged}
                                                    aria-labelledby="theme-select"
                                                    value={this.state.theme}>
                                            <FormSelectOption value='black-theme' label={_("Black")} />
                                            <FormSelectOption value='dark-theme' label={_("Dark")} />
                                            <FormSelectOption value='light-theme' label={_("Light")} />
                                            <FormSelectOption value='white-theme' label={_("White")} />
                                        </FormSelect>
                                    </ToolbarItem>
                                </ToolbarGroup>
                                <ToolbarItem>
                                    <button ref={this.resetButtonRef}
                                            className="pf-c-button pf-m-secondary terminal-reset"
                                            onClick={this.onResetClick}>{_("Reset")}</button>
                                </ToolbarItem>
                            </ToolbarContent>
                        </Toolbar>
                    </div>
                    <div className={"terminal-body " + this.state.theme} id="the-terminal">
                        {terminal}
                    </div>
                </div>
            );
        }
    }
    UserTerminal.displayName = "UserTerminal";

    ReactDOM.render(<UserTerminal />, document.getElementById('terminal'));

    /* And show the body */
    document.body.removeAttribute("hidden");
}());
