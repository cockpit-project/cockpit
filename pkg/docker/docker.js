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
    "base1/cockpit",
    "base1/term"
], function($, cockpit, Terminal) {
    "use strict";

    /*
     * TODO: Only part of the docker code is present in this file. The
     * remainder is in shell/cockpit-docker.js and will be migrated out
     * of there at some point.
     */

    var docker = { };

    function docker_debug() {
        if (window.debugging == "all" || window.debugging == "docker")
            console.debug.apply(console, arguments);
    }

    /* This doesn't create a channel until a request */
    var http = cockpit.http("/var/run/docker.sock", { superuser: true });

    /**
     * pull:
     * @repo: the image repository
     * @tag: the tag to pull
     *
     * Pull an image from the registry. If no @tag is specified
     * then the "latest" tag will be used.
     *
     * A Promise is returned. It completes when the image has
     * been downloaded, or fails with an error. The progress callbacks
     * on the download are called with status updates from docker.
     */
    docker.pull = function pull(repo, tag, registry) {
        var dfd = $.Deferred();

        if (!tag)
            tag = "latest";

        /*
         * Although in theory the docker images/create API has
         * a registry parameter, when you use it the resulting
         * image is labeled completely wrong.
         */

        if (registry)
            repo = registry + "/" + repo;

        console.log("pulling: " + repo + ":" + tag);

        var options = {
            method: "POST",
            path: "/v1.10/images/create",
            body: "",
            params: {
                fromImage: repo,
                tag: tag
            }
        };

        var error;

        var buffer = "";
        var req = http.request(options)
            .stream(function(data) {
                buffer += data;
                var next = docker.json_skip(buffer, 0);
                if (next === 0)
                    return; /* not enough data yet */
                var progress = JSON.parse(buffer.substring(0, next));
                buffer = buffer.substring(next);
                if (progress.error)
                    error = progress.error;
                else if (progress.status)
                    dfd.notify(progress.status, progress);
            })
            .fail(function(ex) {
                dfd.reject(ex);
            })
            .done(function() {
                if (error)
                    dfd.reject(new Error(error));
                else
                    dfd.resolve();
            });

        var promise = dfd.promise();
        promise.cancel = function cancel() {
            req.close("cancelled");
            return promise;
        };

        return promise;
    };

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
            });

        self.process = function process(buffer) {
            term.write(decoder.decode(buffer));
            return buffer.length;
        };

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

    function DockerLogs(parent, channel, failure) {
        var self = this;

        var pre = $("<pre>").addClass("logs");
        parent.empty();
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

        channel.control({ batch: 16384, latency: 50 });

        /* Just display the failure */
        if (failure) {
            write(failure);
            self.close = function() { };
            return self;
        }

        var decoder = cockpit.utf8_decoder(false);

        self.process = function process(buffer) {
            var at = 0;
            var size, block;
            var length = buffer.length;
            while (true) {
                if (length < at + 8)
                    return at; /* more data */

                size = ((buffer[at + 4] & 0xFF) << 24) | ((buffer[at + 5] & 0xFF) << 16) |
                       ((buffer[at + 6] & 0xFF) << 8) | (buffer[at + 7] & 0xFF);

                if (length < at + 8 + size)
                    return at; /* more data */

                /* Output the data */
                if (buffer.subarray)
                    block = buffer.subarray(at + 8, at + 8 + size);
                else
                    block = buffer.slice(at + 8, at + 8 + size);
                write(decoder.decode(block, { stream: true }));
                at += 8 + size;
            }

            return at;
        };

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
            });

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
            self.connected = true;

            if (view)
                view.close();
            view = null;

            channel = cockpit.channel({
                "payload": "stream",
                "unix": "/var/run/docker.sock",
                "superuser": true,
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
                });

            var headers = null;
            var buffer = channel.buffer();
            buffer.callback = function(data) {
                var pos = 0;
                var parts;

                /* Look for end of headers first */
                if (headers === null) {
                    pos = sequence_find(data, [ 13, 10, 13, 10 ]);
                    if (pos == -1)
                        return 0;

                    if (data.subarray)
                        headers = cockpit.utf8_decoder().decode(data.subarray(0, pos));
                    else
                        headers = cockpit.utf8_decoder().decode(data.slice(0, pos));
                    docker_debug(container_id + ": console headers: ", headers);

                    parts = headers.split("\r\n", 1)[0].split(" ");
                    if (parts[1] != "200") {
                        view = new DockerLogs(self, channel, parts.slice(2).join(" "));
                        buffer.callback = null;
                        self.connected = false;
                        return;
                    } else if (data.subarray) {
                        data = data.subarray(pos + 4);
                    } else {
                        data = data.slice(pos + 4);
                    }
                }

                /* We need at least two bytes to determine stream type */
                if (tty === undefined) {
                    if (data.length < 2)
                        return pos + 4;
                    tty = !((data[0] === 0 || data[0] === 1 || data[0] === 2) && data[1] === 0);
                    docker_debug(container_id + ": mode tty: " + tty);
                }

                if (tty)
                    view = new DockerTerminal(self, channel);
                else
                    view = new DockerLogs(self, channel);
                self.typeable(want_typeable);

                buffer.callback = view.process;
                var consumed = view.process(data);
                return pos + 4 + consumed;
            };
        }

        attach();

        /* Allows caller to cleanup nicely */
        self.close = function close(problem) {
            if (self.connected)
                channel.close(problem);
            if (view) {
                if (view.close)
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

    /*
     * docker.json_skip(string, pos = 0)
     * @string: the JSON string
     * @pos: optionally, the starting position in string, or zero
     *
     * Sometimes docker returns multiple JSON strings concatenated.
     *
     * Skip over one item in a stream of JSON things, like objects,
     * numbers, strings, etc... The things can be separated by whitespace
     * or in some cases (strings, objects, arrays) be right next to
     * each other.
     *
     * We do not validate the JSON. It's assumed that a later parse
     * will check for validity.
     *
     * Returns: the number of characters to skip over next json block
     * or zero if no complete json block found.
     */

    docker.json_skip = function(string, pos) {
        var any = false;
        var end = string.length;
        var depth = 0;
        var inword = false;
        var instr = false;
        var endword = " \t\n\r\v[{}]\"";
        var spaces = " \t\n\r\v";
        var ch;

        if (pos === undefined)
            pos = 0;

        for (end = string.length; pos != end; pos++) {
            if (any && depth <= 0)
                break; /* skipped over one thing */

            ch = string[pos];
            if (inword) {
                if (endword.indexOf(ch) != -1) {
                    inword = false;
                    depth--;
                    pos--;
                }
                continue;
            }

            if (spaces.indexOf(ch) != -1)
                continue;

            if (instr) {
                switch (ch) {
                case '\\':
                    if (pos + 1 == end)
                        continue;
                    pos++; /* skip char after bs */
                    break;
                case '"':
                    instr = false;
                    depth--;
                    break;
                default:
                    break;
                }
                continue;
            }

            any = true;
            switch(ch) {
            case '[':
            case '{':
                depth++;
                break;
            case ']':
            case '}':
                depth--;
                break;
            case '"':
                instr = true;
                depth++;
                break;
            default:
                inword = true;
                depth++;
                break;
            }
        }

        if (inword && depth == 1)
            depth = 0;

        /* No complete JSON blocks found */
        if (!any || depth > 0)
            return 0;

        /* The position at which we found th eend */
        return pos;
    };

    /*
     * The functions docker.quote_cmdline and docker.unquote_cmdline implement
     * a simple shell-like quoting syntax.  They are used when letting the
     * user edit a sequence of words as a single string.
     *
     * When parsing, words are separated by whitespace.  Single and double
     * quotes can be used to protect a sequence of characters that
     * contains whitespace or the other quote character.  A backslash can
     * be used to protect any character.  Quotes can appear in the middle
     * of a word.
     */

    docker.quote_cmdline = function quote_cmdline(words) {
        var text;

        words = words || [];

        function is_whitespace(c) {
            return c == ' ';
        }

        function quote(word) {
            var text = "";
            var quote_char = "";
            var i;
            for (i = 0; i < word.length; i++) {
                if (word[i] == '\\' || word[i] == quote_char)
                    text += '\\';
                else if (quote_char === "") {
                    if (word[i] == "'" || is_whitespace(word[i]))
                        quote_char = '"';
                    else if (word[i] == '"')
                        quote_char = "'";
                }
                text += word[i];
            }

            return quote_char + text + quote_char;
        }

        return words.map(quote).join(' ');
    };

    docker.unquote_cmdline = function unquote_cmdline(text) {
        var words = [ ];
        var next;

        function is_whitespace(c) {
            return c == ' ';
        }

        function skip_whitespace() {
            while (next < text.length && is_whitespace(text[next]))
                next++;
        }

        function parse_word() {
            var word = "";
            var quote_char = null;

            while (next < text.length) {
                if (text[next] == '\\') {
                    next++;
                    if (next < text.length) {
                        word += text[next];
                    }
                } else if (text[next] == quote_char) {
                    quote_char = null;
                } else if (quote_char) {
                    word += text[next];
                } else if (text[next] == '"' || text[next] == "'") {
                    quote_char = text[next];
                } else if (is_whitespace(text[next])) {
                    break;
                } else
                    word += text[next];
                next++;
            }
            return word;
        }

        next = 0;
        skip_whitespace();
        while (next < text.length) {
            words.push(parse_word());
            skip_whitespace();
        }

        return words;
    };

    var byte_suffixes = [ null, "KB", "MB", "GB", "TB", "PB", "EB", "ZB" ];

    docker.bytes_from_format = function bytes_from_format(formatted, separate) {
        var factor = 1024;

        if (separate === undefined)
            separate = " ";

        var format = formatted.split(separate).pop().toUpperCase();
        var spot = byte_suffixes.indexOf(format);

        /* TODO: Make the decimal separator translatable */
        var num = parseFloat(formatted);

        if (spot > 0 && !isNaN(num))
            return num * Math.pow(factor, spot);
        return num;
    };

    return docker;
});
