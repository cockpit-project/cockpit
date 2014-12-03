/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

define([
    "jquery",
    "latest/cockpit",
    "latest/term"
], function($, cockpit, Terminal) {
    "use strict";

    var docker = { };

    function docker_debug() {
        if (window.debugging == "all" || window.debugging == "docker")
            console.debug.apply(console, arguments);
    }

    function DockerTerminal(parent, channel) {
        var self = this;

        var term = new Terminal({
            cols: 80,
            rows: 24,
            screenKeys: true
        });

        var enable_input = true;
        var decoder = cockpit.utf8_decoder();
        var encoder = cockpit.utf8_encoder();

        /* term.js wants the parent element to build its terminal inside of */
        parent.empty();
        term.open(parent[0]);

        $(channel).
            on("close", function(ev, options) {
                self.connected = false;
                var problem = options.problem || "disconnected";
                term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                self.typeable(false);
                $(channel).off("message");
                channel = null;
            }).
            on("message", function(ev, payload) {
                term.write(decoder.decode(payload));
            });

        term.on('data', function(data) {
            /* Send typed input back through channel */
            if (enable_input && channel)
                channel.send(encoder.encode(data));
        });

        /* Shows and hides the cursor */
        self.typeable = function typeable(yes) {
            if (yes) {
                term.cursorHidden = false;
                term.showCursor();
            } else {
                /* There's no term.hideCursor() function */
                term.cursorHidden = true;
                term.refresh(term.y, term.y);
            }
            enable_input = yes;
        };

        /* Allows caller to cleanup nicely */
        self.close = function close() {
            term.destroy();
        };

        return self;
    }

    /* Nastiness necessary for some browsers */
    function push_all(a, b) {
        for (var i = 0, length = b.length; i < length; i++)
            a.push(b[i]);
    }

    function DockerLogs(parent, channel, failure) {
        var self = this;

        var pre = $("<pre>").addClass("logs");
        parent.append(pre);

        var wait;
        var writing = [];
        function write(data) {
            writing.push(data);
            if (!wait) {
                wait = window.setTimeout(function() {
                    wait = null;
                    var at_bottom = pre[0].scrollHeight - pre.scrollTop() <= pre.outerHeight();
                    var span = $("<span>").text(writing.join(""));
                    writing.length = 0;
                    pre.append(span);
                    if (at_bottom)
                        pre.scrollTop(pre.prop("scrollHeight"));
                }, 50);
            }
        }

        /* Just display the failure */
        if (failure) {
            write(failure);
            self.close = function() { };
            return self;
        }

        var decoder = cockpit.utf8_decoder(false);
        var buffer = [];

        /*
         * A raw channel over which we speak Docker's even stranger /logs
         * protocol. It starts with a HTTP GET, and then quickly
         * degenerates into a stream with framing.
         */
        $(channel).
            on("close", function(ev, options) {
                write(options.reason || "disconnected");
                self.connected = false;
                $(channel).off();
                channel = null;
            }).
            on("message", function(ev, payload) {
                push_all(buffer, payload);

                while (true) {
                    if (buffer.length < 8)
                        return; /* more data */

                    var size = ((buffer[4] & 0xFF) << 24) | ((buffer[5] & 0xFF) << 16) |
                               ((buffer[6] & 0xFF) << 8) | (buffer[7] & 0xFF);

                    if (buffer.length < 8 + size)
                        return; /* more data */

                    /* Output the data */
                    write(decoder.decode(buffer.slice(8, 8 + size), { stream: true }));
                    buffer = buffer.slice(8 + size);
                }
            });

        /* Allows caller to cleanup nicely */
        self.close = function close() {
            if (self.connected)
                channel.close(null);
        };

        return self;
    }

    function sequence_find(seq, find) {
        var f, fl = find.length;
        var s, sl = (seq.length - fl) + 1;
        for (s = 0; s < sl; s++) {
            for (f = 0; f < fl; f++) {
                if (seq[s + f] !== find[f])
                    break;
            }
            if (f == fl)
                return s;
        }

        return -1;
    }

    docker.console = function console_(container_id, tty) {
        var self = $("<div>").addClass("console");
        var want_typeable = false;
        var channel = null;
        var view = null;

        /*
         * A raw channel over which we speak Docker's strange /attach
         * protocol. It starts with a HTTP POST, and then quickly
         * degenerates into a stream sometimes binary.
         *
         * See: http://docs.docker.io/en/latest/reference/api/docker_remote_api_v1.8/#attach-to-a-container
         */
        function attach() {
            var buffer = [];
            var headers = null;
            self.connected = true;

            channel = cockpit.channel({
                "payload": "stream",
                "unix": "/var/run/docker.sock",
                "binary": true
            });

            var req = "POST /v1.10/containers/" + encodeURIComponent(container_id) +
                      "/attach?logs=1&stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.0\r\n" +
                      "Content-Length: 0\r\n\r\n";
            docker_debug(req);
            channel.send(req);

            $(channel).
                on("close.attach", function(ev, options) {
                    docker_debug(container_id + ": console close: ", options);
                    self.connected = false;
                    $(channel).off(".attach");
                    channel = null;
                }).
                on("message.attach", function(ev, payload) {
                    push_all(buffer, payload);

                    var pos = 0;
                    var failure;
                    var parts;

                    /* Look for end of headers first */
                    if (headers === null) {
                        pos = sequence_find(buffer, [ 13, 10, 13, 10 ]);
                        if (pos == -1)
                            return;

                        headers = cockpit.utf8_decoder().decode(buffer.slice(0, pos));
                        docker_debug(container_id + ": console headers: ", headers);

                        parts = headers.split("\r\n", 1)[0].split(" ");
                        if (parts[1] != "200") {
                            tty = false;
                            failure = parts.slice(2).join(" ");
                        } else {
                            buffer = buffer.slice(pos + 4);
                        }
                    }

                    /* We need at least two bytes to determine stream type */
                    if (tty === undefined) {
                        if (buffer.length < 2)
                            return;
                        tty = !((buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) && buffer[1] === 0);
                        docker_debug(container_id + ": mode tty: " + tty);
                    }

                    $(channel).off("message.attach");

                    if (tty)
                        view = new DockerTerminal(self, channel);
                    else
                        view = new DockerLogs(self, channel, failure);

                    $(channel).triggerHandler("message", [ buffer ]);
                    self.typeable(want_typeable);
                });
        }

        attach();

        /* Allows caller to cleanup nicely */
        self.close = function close(problem) {
            if (self.connected)
                channel.close(problem);
            if (view) {
                view.close();
                view = null;
            }
        };

        /* Allows the curser to restart the attach request */
        self.connect = function connect() {
            self.close("disconnected");
            attach();
        };

        self.typeable = function typeable(yes) {
            if (view && view.typeable)
                view.typeable(yes);
            want_typeable = yes;
        };

        return self;
    };

    return docker;
});
