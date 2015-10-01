define([
    "jquery",
    "base1/cockpit",
    "base1/term",
    "translated!base1/po"
], function($, cockpit, Terminal, po) {
    cockpit.locale(po);
    cockpit.translate();

    var term = null;
    var channel = null;

    var current_user = cockpit.user;

    var terminal_timer = null;
    var shell_update_started = null;
    function start_terminal() {
        if (shell_update_started === null)
            shell_update_started = new Date();

        /* if we don't have user information yet, retry soon
         * abort wait and just use default shell if we exceed time limit
         */
        if (current_user.shell === undefined && ((new Date()) - shell_update_started < 1000)) {
            terminal_timer = window.setTimeout(start_terminal, 50);
            return;
        }

        shell_update_started = null;
        term = new Terminal({
            cols: 80,
            rows: 24,
            screenKeys: true
        });

        /* term.js wants the parent element to build its terminal inside of */
        var container = $('#terminal');
        term.open(container[0]);
        container.children().first().css('margin', 0);

        var user_shell = "/bin/bash";
        if (current_user.shell !== undefined)
            user_shell = current_user.shell;
        channel = cockpit.channel({
            "payload": "stream",
            "spawn": [user_shell, "-i"],
            "environ": [
                "TERM=xterm-256color",
                "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
            ],
            "directory": current_user.home || "/",
            "pty": true
        });

        $(channel).
            on("close", function(ev, options) {
                if (term) {
                    var problem = options.problem || "disconnected";
                    term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                    /* There's no term.hideCursor() function */
                    term.cursorHidden = true;
                    term.refresh(term.y, term.y);
                }
            }).
            on("message", function(ev, payload) {
                /* Output from pty to terminal */
                if (term)
                    term.write(payload);
            });

        term.on('data', function(data) {
            /* Output from terminal to pty */
            if (channel && channel.valid)
                channel.send(data);
        });

        term.on('title', function(title) {
            $("#terminal-title").text(title);
        });
    }

    function show() {
        $("#terminal-reset").on('click', function() {
            /* make sure cockpit channel is closed properly */
            if (channel) {
                channel.close();
            }
            $("#terminal").empty();

            start_terminal();
        });

        start_terminal();
        $("body").show();
    }

    return show;
});
