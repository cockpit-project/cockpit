import cockpit from "cockpit";

import React from "react";
import ReactDOM from "react-dom";
import {
    FormSelect, FormSelectOption,
    Toolbar, ToolbarContent, ToolbarItem
} from "@patternfly/react-core";

import '../lib/patternfly/patternfly-4-cockpit.scss';
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
            var theme = document.cookie.replace(/(?:(?:^|.*;\s*)theme_cookie\s*=\s*([^;]*).*$)|^.*$/, "$1");
            this.state = {
                title: 'Terminal',
                theme: theme || "black-theme"
            };
            this.onTitleChanged = this.onTitleChanged.bind(this);
            this.onResetClick = this.onResetClick.bind(this);
            this.onThemeChanged = this.onThemeChanged.bind(this);
        }

        componentDidMount() {
            cockpit.user().done(function (user) {
                this.setState({ user: user, channel: this.createChannel(user) });
            }.bind(this));
        }

        onTitleChanged(title) {
            this.setState({ title: title });
        }

        onThemeChanged(value) {
            this.setState({ theme: value });
            var cookie = "theme_cookie=" + encodeURIComponent(value) +
                         "; path=/; expires=Sun, 16 Jul 3567 06:23:41 GMT";
            document.cookie = cookie;
        }

        onResetClick(event) {
            if (event.button !== 0)
                return;

            if (!this.state.channel.valid && this.state.user)
                this.setState({ channel: this.createChannel(this.state.user) });
            else
                this.refs.terminal.reset();

            // don't focus the button, but keep it on the terminal
            this.refs.resetButton.blur();
            this.refs.terminal.focus();
        }

        render() {
            var terminal;
            if (this.state.channel)
                terminal = (<Terminal ref="terminal"
                     channel={this.state.channel}
                     theme={this.state.theme}
                     parentId="the-terminal"
                     onTitleChanged={this.onTitleChanged} />);
            else
                terminal = <span>Loading...</span>;

            return (
                <div className="console-ct-container">
                    <div className="terminal-group">
                        <tt className="terminal-title">{this.state.title}</tt>
                        <Toolbar id="toolbar">
                            <ToolbarContent>
                                <ToolbarItem variant="label" id="theme-select">
                                    {_("Appearance")}
                                </ToolbarItem>
                                <ToolbarItem>
                                    <FormSelect onChange={this.onThemeChanged}
                                                aria-label={_("Appearance")}
                                                aria-labelledby="theme-select"
                                                value={this.state.theme}>
                                        <FormSelectOption value='black-theme' label={_("Black")} />
                                        <FormSelectOption value='dark-theme' label={_("Dark")} />
                                        <FormSelectOption value='light-theme' label={_("Light")} />
                                        <FormSelectOption value='white-theme' label={_("White")} />
                                    </FormSelect>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <button ref="resetButton"
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
