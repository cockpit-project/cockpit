import cockpit from "cockpit";
import 'cockpit-dark-theme'; // once per page
import '../lib/patternfly/patternfly-5-cockpit.scss';

import React from "react";
import { createRoot } from "react-dom/client";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { NumberInput } from "@patternfly/react-core/dist/esm/components/NumberInput/index.js";
import { Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { Alert, AlertActionCloseButton, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { fsinfo } from "cockpit/fsinfo";
import { Button } from '@patternfly/react-core';

import "./terminal.scss";

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
        createChannel(user, dir) {
            const ch = cockpit.channel({
                payload: "stream",
                spawn: [user.shell || "/bin/bash"],
                environ: [
                    "TERM=xterm-256color",
                ],
                directory: dir || user.home || "/",
                pty: true,
                binary: true,
            });
            ch.addEventListener("ready", (_, msg) => this.setState({ pid: msg.pid }));
            ch.addEventListener("close", () => this.setState({ pid: null }));
            return ch;
        }

        constructor(props) {
            super(props);

            let theme = localStorage.getItem('terminal:theme');
            let size = localStorage.getItem('terminal:font-size');
            // HACK: Try to read the configuration from localStorage, if it does not exists fall back
            // to the old configuration stored in a browser's cookie. After enough time has been
            // passed this can be dropped.
            if (theme === null || theme === "") {
                theme = document.cookie.replace(/(?:(?:^|.*;\s*)theme_cookie\s*=\s*([^;]*).*$)|^.*$/, "$1");
                if (theme !== "") {
                    localStorage.setItem('terminal:theme', theme);
                    this.invalidateCookie("theme_cookie");
                }
            }
            if (size === null || size === "") {
                size = document.cookie.replace(/(?:(?:^|.*;\s*)size_cookie\s*=\s*([^;]*).*$)|^.*$/, "$1");
                if (size !== "") {
                    localStorage.setItem('terminal:font-size', size);
                    this.invalidateCookie("size_cookie");
                }
            }

            this.state = {
                title: 'Terminal',
                theme: theme || "black-theme",
                size: parseInt(size) || 16,
                changePathBusy: false,
                pathError: null,
                pid: null,
            };
            this.onTitleChanged = this.onTitleChanged.bind(this);
            this.onResetClick = this.onResetClick.bind(this);
            this.onThemeChanged = this.onThemeChanged.bind(this);
            this.onPlus = this.onPlus.bind(this);
            this.onMinus = this.onMinus.bind(this);
            this.forceChangeDirectory = this.forceChangeDirectory.bind(this);
            this.onNavigate = this.onNavigate.bind(this);
            this.dismiss = this.dismiss.bind(this);

            this.terminalRef = React.createRef();
            this.resetButtonRef = React.createRef();

            this.minSize = 6;
            this.maxSize = 40;
        }

        async componentDidMount() {
            cockpit.addEventListener("locationchanged", this.onNavigate);

            let dir;
            if (cockpit.location.options.path) {
                const validPath = await this.readyPath();
                if (validPath) {
                    dir = cockpit.location.options.path;
                }
            }
            const user = await cockpit.user();
            this.setState({ user, channel: this.createChannel(user, dir) });
        }

        componentWillUnmount() {
            cockpit.removeEventListener("locationchanged", this.onNavigate);
        }

        onTitleChanged(title) {
            this.setState({ title });
        }

        invalidateCookie(key) {
            const cookie = key + "=''" +
                         "; path=/; Max-Age=0;";
            document.cookie = cookie;
        }

        forceChangeDirectory() {
            this.setState(prevState => ({
                channel: this.createChannel(prevState.user, cockpit.location.options.path),
                changePathBusy: false,
            }));
        }

        dismiss() {
            this.setState({
                pathError: null,
                changePathBusy: false,
            });
            cockpit.location.replace("");
        }

        async onNavigate() {
            // Clear old path errors
            this.setState({
                pathError: null,
                changePathBusy: false,
            });

            // If there's no path to change to, then we're done here
            if (!cockpit.location.options.path) {
                return;
            }
            const changeNow = await this.readyPath();
            if (changeNow) {
                this.setState(prevState => ({ channel: this.createChannel(prevState.user, cockpit.location.options.path) }));
            }
        }

        async readyPath() {
            // Check if path we're changing to exists
            try {
                const info = await fsinfo(String(cockpit.location.options.path), ['type']);
                if (info.type !== "dir") {
                    this.setState({ pathError: cockpit.format(_("$0 is not a directory"), cockpit.location.options.path) });
                    return false;
                }
            } catch (err) {
                this.setState({ pathError: cockpit.format(_("$0 does not exist"), cockpit.location.options.path) });
                return false;
            }

            if (this.state.pid !== null) {
                // Check if current shell has a process running in it, ie it's busy
                const command = "grep -qr '^PPid:[[:space:]]*" + this.state.pid + "$' /proc/*/status";
                try {
                    await cockpit.script(command, [], { err: "message" });
                    this.setState({ changePathBusy: true });
                    return false;
                } catch {
                    return true;
                }
            }
            return true;
        }

        onPlus() {
            this.setState((state, _) => {
                localStorage.setItem('terminal:font-size', state.size + 1);
                return { size: state.size + 1 };
            });
        }

        onMinus() {
            this.setState((state, _) => {
                localStorage.setItem('terminal:font-size', state.size - 1);
                return { size: state.size - 1 };
            });
        }

        onThemeChanged(_, value) {
            this.setState({ theme: value });
            localStorage.setItem('terminal:theme', value);
        }

        onResetClick(event) {
            if (event.button !== 0)
                return;

            if (!this.state.channel.valid && this.state.user)
                this.setState(prevState => ({ channel: this.createChannel(prevState.user) }));
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
                                            className="pf-v5-c-button pf-m-secondary terminal-reset"
                                            onClick={this.onResetClick}>{_("Reset")}</button>
                                </ToolbarItem>
                            </ToolbarContent>
                        </Toolbar>
                    </div>
                    <div className="ct-terminal-dir-alert">
                        {this.state.pathError && <Alert isInline
                            title={_("Unable to open directory")}
                            variant="warning"
                            actionClose={<AlertActionCloseButton onClose={this.dismiss} />}>
                            <p>{_(this.state.pathError)}</p>
                        </Alert>
                        }

                        {this.state.changePathBusy && <Alert isInline
                            title={_("Running process prevents directory change")}
                            variant="danger"
                            actionClose={<AlertActionCloseButton onClose={() =>
                                this.setState({ changePathBusy: false })} />}
                            actionLinks={
                                <>
                                    <Button variant="danger" size="sm" onClick={this.forceChangeDirectory}>{_("Change directory")}</Button>
                                    <AlertActionLink onClick={this.dismiss}>{_("Cancel")}</AlertActionLink>
                                </>
                            }>
                            {_("Changing the directory will forcefully stop the currently running process. The process can also be stopped manually in the terminal before continuing.")}
                        </Alert>
                        }
                    </div>
                    <div className={"terminal-body " + this.state.theme} id="the-terminal">
                        {terminal}
                    </div>
                </div>
            );
        }
    }
    UserTerminal.displayName = "UserTerminal";

    const root = createRoot(document.getElementById('terminal'));
    root.render(<UserTerminal />);

    /* And show the body */
    document.body.removeAttribute("hidden");
}());
