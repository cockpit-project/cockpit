/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

/* THE MESSAGE ROUTER
 *
 * The message router forwards Cockpit protocol messages between the
 * web socket and the frames.
 *
 * It automatically starts processing messages for a frame as soon as
 * it receives the "init" message from that frame.
 *
 * The router needs a "callback" object that it uses to hook into the
 * rest of the shell. This is provided by the ShellState instance,
 * and more documentation can be found there.
 */

import cockpit from "cockpit";

export function Router(callbacks) {
    const self = this;

    let unique_id = 0;
    const origin = cockpit.transport.origin;
    const source_by_seed = { };
    const source_by_name = { };

    cockpit.transport.filter(function(message, channel, control) {
        /* Only control messages with a channel are forwardable */
        if (control) {
            if (control.channel !== undefined) {
                for (const seed in source_by_seed) {
                    const source = source_by_seed[seed];
                    if (!source.window.closed)
                        source.window.postMessage(message, origin);
                }
            } else if (control.command == "hint") {
                /* This is where we handle hint messages directed at
                 * the shell.  Right now, there aren't any.
                 */
            }

        /* Forward message to relevant frame */
        } else if (channel) {
            const pos = channel.indexOf('!');
            if (pos !== -1) {
                const seed = channel.substring(0, pos + 1);
                const source = source_by_seed[seed];
                if (source) {
                    if (!source.window.closed)
                        source.window.postMessage(message, origin);
                    return false; /* Stop delivery */
                }
            }
        }

        /* Still deliver the message locally */
        return true;
    }, false);

    function perform_jump(child, control) {
        let str = control.location || "";
        if (str[0] != "/")
            str = "/" + str;
        if (control.host)
            str = "/@" + encodeURIComponent(control.host) + str;

        callbacks.perform_frame_jump_command(child.name, str);
    }

    function perform_track(child) {
        let hash = child.location.hash;
        if (hash.indexOf("#") === 0)
            hash = hash.substring(1);
        if (hash === "/")
            hash = "";

        callbacks.perform_frame_hash_track(child.name, hash);
    }

    function on_unload(ev) {
        let source;
        if (ev.target.defaultView)
            source = source_by_name[ev.target.defaultView.name];
        else if (ev.view)
            source = source_by_name[ev.view.name];
        if (source)
            unregister(source);
    }

    function on_hashchange(ev) {
        const source = source_by_name[ev.target.name];
        if (source)
            perform_track(source.window);
    }

    function on_load(ev) {
        const source = source_by_name[ev.target.contentWindow.name];
        if (source)
            perform_track(source.window);
    }

    function unregister(source) {
        const child = source.window;
        cockpit.kill(null, child.name);
        const frame = child.frameElement;
        if (frame)
            frame.removeEventListener("load", on_load);
        /* This is often invalid when the window is closed */
        if (child.removeEventListener) {
            child.removeEventListener("unload", on_unload);
            child.removeEventListener("hashchange", on_hashchange);
        }
        delete source_by_seed[source.channel_seed];
        delete source_by_name[source.name];
    }

    function register(child) {
        let host, page;
        const name = child.name || "";
        if (name.indexOf("cockpit1:") === 0) {
            const parts = name.substring(9).split("/");
            host = parts[0];
            page = parts.slice(1).join("/");
        }
        if (!name || !host || !page) {
            console.warn("invalid child window name", child, name);
            return;
        }

        unique_id += 1;
        const seed = (cockpit.transport.options["channel-seed"] || "undefined:") + unique_id + "!";
        const source = {
            name,
            window: child,
            channel_seed: seed,
            default_host: host,
            page,
            inited: false,
        };
        source_by_seed[seed] = source;
        source_by_name[name] = source;

        const frame = child.frameElement;
        frame.addEventListener("load", on_load);
        child.addEventListener("unload", on_unload);
        child.addEventListener("hashchange", on_hashchange);

        perform_track(child);

        return source;
    }

    function message_handler(event) {
        if (event.origin !== origin)
            return;

        let data = event.data;
        const child = event.source;
        if (!child)
            return;

        /* If it's binary data just send it.
         * TODO: Once we start restricting what frames can
         * talk to which hosts, we need to parse control
         * messages here, and cross check channels */
        if (data instanceof window.ArrayBuffer) {
            cockpit.transport.inject(data, true);
            return;
        }

        if (typeof data !== "string")
            return;

        let source, control;

        /*
         * On Internet Explorer we see Access Denied when non Cockpit
         * frames send messages (such as Javascript console). This also
         * happens when the window is closed.
         */
        try {
            source = source_by_name[child.name];
        } catch (ex) {
            console.log("received message from child with inaccessible name: ", ex);
            return;
        }

        /* Closing the transport */
        if (data.length === 0) {
            if (source)
                unregister(source);
            return;
        }

        /* A control message */
        if (data[0] == '\n') {
            control = JSON.parse(data.substring(1));
            if (control.command === "init") {
                if (source)
                    unregister(source);
                if (control.problem) {
                    console.warn("child frame failed to init: " + control.problem);
                    source = null;
                } else {
                    source = register(child);
                }
                if (source) {
                    const reply = {
                        ...cockpit.transport.options,
                        command: "init",
                        host: source.default_host,
                        "channel-seed": source.channel_seed,
                    };
                    child.postMessage("\n" + JSON.stringify(reply), origin);
                    source.inited = true;

                    callbacks.frame_is_initialized(child.frameElement.name);
                }
            } else if (control.command === "jump") {
                perform_jump(child, control);
                return;
            } else if (control.command === "hint") {
                if (control.hint == "restart") {
                    /* watchdog handles current host for now */
                    if (control.host != cockpit.transport.host)
                        callbacks.expect_restart(control.host);
                } else
                    cockpit.hint(control.hint, control);
                return;
            } else if (control.command == "oops") {
                callbacks.show_oops();
                return;
            } else if (control.command == "notify") {
                if (source)
                    callbacks.handle_notifications(source.default_host, source.page, control);
                return;

            /* Only control messages with a channel are forwardable */
            } else if (control.channel === undefined && (control.command !== "logout" && control.command !== "kill")) {
                return;

            /* Add the child's group to all open channel messages */
            } else if (control.command == "open") {
                control.group = child.name;
                data = "\n" + JSON.stringify(control);
            }
        }

        if (!source) {
            console.warn("child frame " + child.name + " sending data without init");
            return;
        }

        /* Everything else gets forwarded */
        cockpit.transport.inject(data, true);
    }

    self.hint = function hint(name, data) {
        const source = source_by_name[name];
        /* This is often invalid when the window is closed */
        if (source && source.inited && !source.window.closed) {
            data.command = "hint";
            const message = "\n" + JSON.stringify(data);
            source.window.postMessage(message, origin);
        }
    };

    self.unregister_name = (name) => {
        const source = source_by_name[name];
        if (source)
            unregister(source);
    };

    cockpit.transport.wait(function() {
        window.addEventListener("message", message_handler, false);
    });
}
