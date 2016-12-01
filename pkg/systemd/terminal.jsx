(function() {
    "use strict";

    var cockpit = require("cockpit");
    var _ = cockpit.gettext;

    var React = require("react");
    var componentsTerminal = require("cockpit-components-terminal.jsx");

    cockpit.translate();

    /*
     * A terminal component for the cockpit user.
     *
     * Uses the Terminal component from base1 internally, but adds a header
     * with title and Reset button.
     *
     * Spawns the user's shell in the user's home directory.
     */
    var UserTerminal = React.createClass({displayName: "UserTerminal",
        createChannel: function (user) {
            return cockpit.channel({
                "payload": "stream",
                "spawn": [ user.shell || "/bin/bash", "-i"],
                "environ": [
                    "TERM=xterm-256color",
                    "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
                ],
                "directory": user.home || "/",
                "pty": true
            });
        },

        getInitialState: function () {
            return {
                title: 'Terminal'
            };
        },

        componentWillMount: function () {
            cockpit.user().done(function (user) {
                this.setState({ user: user, channel: this.createChannel(user) });
            }.bind(this));
        },

        onTitleChanged: function (title) {
            this.setState({ title: title });
        },

        onResetClick: function (event) {
            if (event.button !== 0)
                return;

            if (this.state.channel)
                this.state.channel.close();

            if (this.state.user)
                this.setState({ channel: this.createChannel(this.state.user) });

            // don't focus the button, but keep it on the terminal
            this.refs.resetButton.blur();
            this.refs.terminal.focus();
        },

        render: function () {
            var terminal;
            if (this.state.channel)
                terminal = (<componentsTerminal.Terminal ref="terminal"
                                                         channel={this.state.channel}
                                                         onTitleChanged={this.onTitleChanged} />);
            else
                terminal = <span>Loading...</span>;

            return (
                <div className="panel panel-default console-ct-container">
                    <div className="panel-heading">
                        <tt className="terminal-title">{this.state.title}</tt>
                        <button ref="resetButton"
                                className="btn btn-default pull-right"
                                onClick={this.onResetClick}>{_("Reset")}</button>
                    </div>
                    {terminal}
                </div>
            );
        }
    });

    React.render(<UserTerminal />, document.getElementById('terminal'));

    /* And show the body */
    document.body.removeAttribute("hidden");
}());
