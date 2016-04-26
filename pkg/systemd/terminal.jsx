define([
    "base1/react",
    "base1/cockpit",
    "base1/cockpit-components-terminal",
    "translated!base1/po",
], function(React, cockpit, componentsTerminal, po) {

    "use strict";

    cockpit.locale(po);
    cockpit.translate();

    function getUser(fn) {
        if (cockpit.user.user) {
            fn();
        }
        else {
            cockpit.user.addEventListener('changed', function userChanged() {
                cockpit.user.removeEventListener('changed', userChanged);
                fn();
            });
        }
    }

    /*
     * A terminal component for the cockpit user.
     *
     * Uses the Terminal component from base1 internally, but adds a header
     * with title and Reset button.
     *
     * Spawns the user's shell in the user's home directory.
     */
    var UserTerminal = React.createClass({displayName: "UserTerminal",
        createChannel: function () {
            return cockpit.channel({
                "payload": "stream",
                "spawn": [cockpit.user.shell || "/bin/bash", "-i"],
                "environ": [
                    "TERM=xterm-256color",
                    "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
                ],
                "directory": cockpit.user.home || "/",
                "pty": true
            });
        },

        getInitialState: function () {
            return {
                title: 'Terminal'
            };
        },

        componentWillMount: function () {
            getUser(function () {
                this.setState({ channel: this.createChannel() });
            }.bind(this));
        },

        componentWillUnmount: function () {
            cockpit.user.removeEventListener('changed', this.createChannel);
        },

        onTitleChanged: function (title) {
            this.setState({ title: title });
        },

        onResetClick: function (event) {
            if (event.button !== 0)
                return;

            // only reset if we had a channel before (cockpit.user is filled in)
            if (this.state.channel) {
                this.state.channel.close();
                this.setState({ channel: this.createChannel() });
            }

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
                <div className="panel panel-default console-container">
                    <div className="panel-heading">
                        <tt className="terminal-title">{this.state.title}</tt>
                        <button ref="resetButton"
                                className="btn btn-default pull-right"
                                onClick={this.onResetClick}>Reset</button>
                    </div>
                    {terminal}
                </div>
            );
        }
    });

    React.render(<UserTerminal />, document.getElementById('terminal'));

    /* And show the body */
    document.body.removeAttribute("hidden");
});
