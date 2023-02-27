/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";
import { createRoot } from "react-dom/client";

import { TimeoutModal } from "./shell-modals.jsx";

const shell_embedded = window.location.pathname.indexOf(".html") !== -1;
const _ = cockpit.gettext;

function component_checksum(machine, component) {
    const parts = component.split("/");
    const pkg = parts[0];
    if (machine.manifests && machine.manifests[pkg] && machine.manifests[pkg][".checksum"])
        return "$" + machine.manifests[pkg][".checksum"];
}

function Frames(index, setupIdleResetTimers) {
    const self = this;
    let language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*=\s*([^;]*).*$)|^.*$/, "$1");
    if (!language)
        language = navigator.language.toLowerCase(); // Default to Accept-Language header

    /* Lists of frames, by host */
    self.iframes = { };

    function remove_frame(frame) {
        frame.remove();
    }

    self.remove = function remove(machine, component) {
        let address;
        if (typeof machine == "string")
            address = machine;
        else if (machine)
            address = machine.address;
        if (!address)
            address = "localhost";
        const list = self.iframes[address] || { };
        if (!component)
            delete self.iframes[address];
        Object.keys(list).forEach(function(key) {
            if (!component || component == key) {
                remove_frame(list[key]);
                delete list[component];
            }
        });
    };

    function frame_ready(frame, count) {
        let ready = false;

        window.clearTimeout(frame.timer);
        frame.timer = null;

        try {
            if (frame.contentWindow.document && frame.contentWindow.document.body)
                ready = frame.contentWindow.document.body.offsetWidth > 0 && frame.contentWindow.document.body.offsetHeight > 0;
        } catch (ex) {
            ready = true;
        }

        if (!count)
            count = 0;
        count += 1;
        if (count > 50)
            ready = true;

        if (ready) {
            if (frame.getAttribute("data-ready") != "1") {
                frame.setAttribute("data-ready", "1");
                if (count > 0)
                    index.navigate();
            }
            if (frame.contentWindow && setupIdleResetTimers)
                setupIdleResetTimers(frame.contentWindow);

            if (frame.contentDocument && frame.contentDocument.documentElement) {
                frame.contentDocument.documentElement.lang = language;
                if (cockpit.language_direction)
                    frame.contentDocument.documentElement.dir = cockpit.language_direction;
            }
        } else {
            frame.timer = window.setTimeout(function() {
                frame_ready(frame, count + 1);
            }, 100);
        }
    }

    self.lookup = function lookup(machine, component, hash) {
        let host;
        let address;
        let new_frame = false;

        if (typeof machine == "string") {
            address = host = machine;
        } else if (machine) {
            host = machine.connection_string;
            address = machine.address;
        }

        if (!host)
            host = "localhost";
        if (!address)
            address = host;

        let list = self.iframes[address];
        if (!list)
            self.iframes[address] = list = { };

        const name = "cockpit1:" + host + "/" + component;
        let frame = list[component];
        if (frame && frame.getAttribute("name") != name) {
            remove_frame(frame);
            frame = null;
        }

        /* A preloaded frame */
        if (!frame) {
            const wind = window.frames[name];
            if (wind)
                frame = wind.frameElement;
            if (frame) {
                const src = frame.getAttribute('src');
                frame.url = src.split("#")[0];
                list[component] = frame;
            }
        }

        /* Need to create a new frame */
        if (!frame) {
            new_frame = true;
            frame = document.createElement("iframe");
            frame.setAttribute("class", "container-frame");
            frame.setAttribute("name", name);
            frame.setAttribute("data-host", host);
            frame.style.display = "none";

            let base, checksum;
            if (machine) {
                if (machine.manifests && machine.manifests[".checksum"])
                    checksum = "$" + machine.manifests[".checksum"];
                else
                    checksum = machine.checksum;
            }

            if (checksum && checksum == component_checksum(machine, component)) {
                if (host === "localhost")
                    base = "..";
                else
                    base = "../../" + checksum;
            } else {
                /* If we don't have any checksums, or if the component specifies a different
                   checksum than the machine, load it via a non-caching @<host> path.  This
                   makes sure that we get the right files, and also that we don't poisen the
                   cache with wrong files.

                   We can't use a $<component-checksum> path since cockpit-ws only knows how to
                   route the machine checksum.

                   TODO - make it possible to use $<component-checksum>.
                */
                base = "../../@" + host;
            }

            frame.url = base + "/" + component;
            if (component.indexOf("/") === -1)
                frame.url += "/index";
            frame.url += ".html";
        }

        if (!hash)
            hash = "/";
        const src = frame.url + "#" + hash;
        if (frame.getAttribute('src') != src) {
            if (frame.contentWindow) {
                // This prevents the browser from creating a new
                // history entry.  It would do that whenever the "src"
                // of a frame is changed and the window location is
                // not consistent with the new "src" value.
                //
                // This matters when a "jump" command changes both the
                // the current frame and the hash of the new frame.
                frame.contentWindow.location.replace(src);
            }
            frame.setAttribute('src', src);
        }

        /* Store frame only when fully setup */
        if (new_frame) {
            list[component] = frame;
            document.getElementById("content").appendChild(frame);

            const style = localStorage.getItem('shell:style') || 'auto';
            let dark_mode;
            // If a user set's an explicit theme, ignore system changes.
            if ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && style === "auto") || style === "dark") {
                dark_mode = true;
            } else {
                dark_mode = false;
            }

            // The new iframe is shown before any HTML/CSS is ready and loaded,
            // explicitly set a dark background so we don't see any white flashes
            if (dark_mode && frame.contentDocument && frame.contentDocument.documentElement) {
                // --pf-global--BackgroundColor--dark-300
                const dark_mode_background = '#1b1d21';
                frame.contentDocument.documentElement.style.background = dark_mode_background;
            } else {
                frame.contentDocument.documentElement.style.background = 'white';
            }
        }
        frame_ready(frame);
        return frame;
    };
}

function Router(index) {
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
        const current_frame = index.current_frame();
        if (child !== window) {
            if (!current_frame || current_frame.contentWindow != child)
                return;
        }
        let str = control.location || "";
        if (str[0] != "/")
            str = "/" + str;
        if (control.host)
            str = "/@" + encodeURIComponent(control.host) + str;
        index.jump(str);
    }

    function perform_track(child) {
        const current_frame = index.current_frame();
        /* Note that we ignore tracknig for old shell code */
        if (current_frame && current_frame.contentWindow === child &&
            child.name && child.name.indexOf("/shell/shell") === -1) {
            let hash = child.location.hash;
            if (hash.indexOf("#") === 0)
                hash = hash.substring(1);
            if (hash === "/")
                hash = "";
            /* The browser has already pushed an appropriate entry to
               the history, so let's just replace it with our custom
               state object.
            */
            const state = Object.assign({}, index.retrieve_state(), { hash });
            index.navigate(state, true);
        }
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

        /*
         * Setting the "data-loaded" attribute helps the testsuite
         * know when it can switch into the frame and inject its
         * own additions.
         */
        frame.setAttribute('data-loaded', '1');

        perform_track(child);

        index.navigate();
        return source;
    }

    function message_handler(event) {
        if (event.origin !== origin)
            return;

        let forward_command = false;
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
            console.log("received message from child with in accessible name: ", ex);
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

                    /* If this new frame is not the current one, tell it */
                    if (child.frameElement != index.current_frame())
                        self.hint(child.frameElement.contentWindow, { hidden: true });
                }
            } else if (control.command === "jump") {
                perform_jump(child, control);
                return;
            } else if (control.command == "logout" || control.command == "kill") {
                forward_command = true;
            } else if (control.command === "hint") {
                if (control.hint == "restart") {
                    /* watchdog handles current host for now */
                    if (control.host != cockpit.transport.host)
                        index.expect_restart(control.host);
                } else
                    cockpit.hint(control.hint, control);
                return;
            } else if (control.command == "oops") {
                index.show_oops();
                return;
            } else if (control.command == "notify") {
                if (source)
                    index.handle_notifications(source.default_host, source.page, control);
                return;

            /* Only control messages with a channel are forwardable */
            } else if (control.channel === undefined && !forward_command) {
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

    self.start = function start(messages) {
        window.addEventListener("message", message_handler, false);
        for (let i = 0, len = messages.length; i < len; i++)
            message_handler(messages[i]);
    };

    self.hint = function hint(child, data) {
        const source = source_by_name[child.name];
        /* This is often invalid when the window is closed */
        if (source && source.inited && !source.window.closed) {
            data.command = "hint";
            const message = "\n" + JSON.stringify(data);
            source.window.postMessage(message, origin);
        }
    };
}

/*
 * New instances of Index must be created by new_index_from_proto
 * and the caller must include a navigation function in the given
 * prototype. That function will be called by Frames and
 * Router to actually perform any navigation action.
 *
 * Emits "disconnect" and "expect_restart" signals, that should be
 * handled by the caller.
 */
function Index() {
    const self = this;
    let current_frame;

    cockpit.event_target(self);

    if (typeof self.navigate !== "function")
        throw Error("Index requires a prototype with a navigate function");

    /* Session timing out after inactivity */
    let session_final_timer = null;
    let session_timeout = 0;
    let current_idle_time = 0;
    let final_countdown = 30000; // last 30 seconds
    let title = "";
    const standard_login = window.localStorage['standard-login'];

    self.has_oops = false;

    function sessionTimeout() {
        current_idle_time += 5000;
        if (!session_final_timer && current_idle_time >= session_timeout - final_countdown) {
            title = document.title;
            sessionFinalTimeout();
        }
    }

    let session_timeout_dialog_root = null;

    function updateFinalCountdown() {
        const remaining_secs = Math.floor(final_countdown / 1000);
        const timeout_text = cockpit.format(_("You will be logged out in $0 seconds."), remaining_secs);
        document.title = "(" + remaining_secs + ") " + title;
        if (!session_timeout_dialog_root)
            session_timeout_dialog_root = createRoot(document.getElementById('session-timeout-dialog'));
        session_timeout_dialog_root.render(React.createElement(TimeoutModal, {
            onClose: () => {
                window.clearTimeout(session_final_timer);
                session_final_timer = null;
                document.title = title;
                resetTimer();
                session_timeout_dialog_root.unmount();
                session_timeout_dialog_root = null;
                final_countdown = 30000;
            },
            text: timeout_text,
        }));
    }

    function sessionFinalTimeout() {
        final_countdown -= 1000;
        if (final_countdown > 0) {
            updateFinalCountdown();
            session_final_timer = window.setTimeout(sessionFinalTimeout, 1000);
        } else {
            cockpit.logout(true, _("You have been logged out due to inactivity."));
        }
    }

    /* Auto-logout idle timer */
    function resetTimer(ev) {
        if (!session_final_timer) {
            current_idle_time = 0;
        }
    }

    function setupIdleResetTimers(win) {
        win.addEventListener("mousemove", resetTimer, false);
        win.addEventListener("mousedown", resetTimer, false);
        win.addEventListener("keypress", resetTimer, false);
        win.addEventListener("touchmove", resetTimer, false);
        win.addEventListener("scroll", resetTimer, false);
    }

    cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetUInt", ["Session", "IdleTimeout", 0, 240, 0], [])
            .then(result => {
                session_timeout = result[0] * 60000;
                if (session_timeout > 0 && standard_login) {
                    setupIdleResetTimers(window);
                    window.setInterval(sessionTimeout, 5000);
                }
            })
            .catch(e => {
                if (e.message.indexOf("GetUInt not available") === -1)
                    console.warn(e.message);
            });

    self.frames = new Frames(self, setupIdleResetTimers);
    self.router = new Router(self);

    /* Watchdog for disconnect */
    const watchdog = cockpit.channel({ payload: "null" });
    watchdog.addEventListener("close", (event, options) => {
        const watchdog_problem = options.problem || "disconnected";
        console.warn("transport closed: " + watchdog_problem);
        self.dispatchEvent("disconnect", watchdog_problem);
    });

    const old_onerror = window.onerror;
    window.onerror = function cockpit_error_handler(msg, url, line) {
        // Errors with url == "" are not logged apparently, so let's
        // not show the "Oops" for them either.
        if (url != "")
            self.show_oops();
        if (old_onerror)
            return old_onerror(msg, url, line);
        return false;
    };

    /*
     * Navigation is driven by state objects, which are used with pushState()
     * and friends. The state is the canonical navigation location, and not
     * the URL. Only when no state has been pushed or we are arriving from
     * a link, do we parse the state from the URL.
     *
     * Each state object has:
     *   host: a machine host
     *   component: the stripped component to load
     *   hash: the hash to pass to the component
     *   sidebar: set to true to hint that we want a component with a sidebar
     *
     * If state.sidebar is set, and no component has yet been chosen for the
     * given state, then we try to find one that would show a sidebar.
     */

    /* Encode navigate state into a string
     * If with_root is true the configured
     * url root will be added to the generated
     * url. with_root should be used when
     * navigating to a new url or updating
     * history, but is not needed when simply
     * generating a string for a link.
     */
    function encode(state, sidebar, with_root) {
        const path = [];
        if (state.host && (sidebar || state.host !== "localhost"))
            path.push("@" + state.host);
        if (state.component)
            path.push.apply(path, state.component.split("/"));
        let string = cockpit.location.encode(path, null, with_root);
        if (state.hash && state.hash !== "/")
            string += "#" + state.hash;
        return string;
    }

    /* Decodes navigate state from a string */
    function decode(string) {
        const state = { version: "v1", hash: "" };
        const pos = string.indexOf("#");
        if (pos !== -1) {
            state.hash = string.substring(pos + 1);
            string = string.substring(0, pos);
        }
        if (string[0] != '/')
            string = "/" + string;
        const path = cockpit.location.decode(string);
        if (path[0] && path[0][0] == "@") {
            state.host = path.shift().substring(1);
            state.sidebar = true;
        } else {
            state.host = "localhost";
        }
        if (path.length && path[path.length - 1] == "index")
            path.pop();
        state.component = path.join("/");
        return state;
    }

    self.retrieve_state = function() {
        let state = window.history.state;
        if (!state || state.version !== "v1") {
            if (shell_embedded)
                state = decode("/" + window.location.hash);
            else
                state = decode(window.location.pathname + window.location.hash);
        }
        return state;
    };

    function lookup_component_hash(address, component) {
        if (!address)
            address = "localhost";

        const list = self.frames.iframes[address];
        const iframe = list ? list[component] : undefined;

        if (iframe) {
            const src = iframe.getAttribute('src');
            if (src)
                return src.split("#")[1];
        }

        return null;
    }

    self.preload_frames = function (host, manifests) {
        for (const c in manifests) {
            const preload = manifests[c].preload;
            if (preload && preload.length) {
                for (const p of preload) {
                    if (p == "index")
                        self.frames.lookup(host, c);
                    else
                        self.frames.lookup(host, c + "/" + p);
                }
            }
        }
    };

    /* Jumps to a given navigate state */
    self.jump = function (state, replace) {
        if (typeof (state) === "string")
            state = decode(state);

        const current = self.retrieve_state();

        /* Make sure we have the data we need */
        if (!state.host)
            state.host = current.host || "localhost";

        // When switching hosts, check if we left from some page
        if (!state.component && state.host !== current.host) {
            const host_frames = self.frames.iframes[state.host] || {};
            const active = Object.keys(host_frames)
                    .filter(k => host_frames[k].getAttribute('data-active') === 'true');
            if (active.length > 0)
                state.component = active[0];
        }

        if (!("component" in state))
            state.component = current.component || "";

        const history = window.history;
        const frame_change = (state.host !== current.host ||
                            state.component !== current.component);

        if (frame_change && !state.hash)
            state.hash = lookup_component_hash(state.host, state.component);

        const target = shell_embedded ? window.location : encode(state, null, true);

        if (replace) {
            history.replaceState(state, "", target);
            return false;
        }

        if (frame_change || state.hash !== current.hash) {
            history.pushState(state, "", target);
            document.getElementById("nav-system").classList.remove("interact");
            self.navigate(state, true);
            return true;
        }

        return false;
    };

    /* Build an href for use in an <a> */
    self.href = function (state, sidebar) {
        return encode(state, sidebar);
    };

    self.show_oops = function () {
        self.has_oops = true;
        self.dispatchEvent("update");
    };

    self.current_frame = function (frame) {
        if (frame !== undefined) {
            if (current_frame !== frame) {
                if (current_frame && current_frame.contentWindow)
                    self.router.hint(current_frame.contentWindow, { hidden: true });
                if (frame && frame.contentWindow)
                    self.router.hint(frame.contentWindow, { hidden: false });
            }
            current_frame = frame;
        }
        return current_frame;
    };

    self.start = function() {
        /* window.messages is initialized in shell/indexes.jsx */
        const messages = window.messages;
        if (messages)
            messages.cancel();
        self.router.start(messages || []);
    };

    self.ready = function () {
        window.addEventListener("popstate", ev => {
            self.navigate(ev.state, true);
        });

        self.navigate(null, true);
        cockpit.translate();
        document.body.removeAttribute("hidden");
    };

    self.expect_restart = function (host) {
        self.dispatchEvent("expect_restart", host);
    };
}

function CompiledComponents() {
    const self = this;
    self.items = {};

    self.load = function(manifests, section) {
        Object.entries(manifests || { }).forEach(([name, manifest]) => {
            Object.entries(manifest[section] || { }).forEach(([prop, info]) => {
                const item = {
                    section,
                    label: cockpit.gettext(info.label) || prop,
                    order: info.order === undefined ? 1000 : info.order,
                    docs: info.docs,
                    keywords: info.keywords || [{ matches: [] }],
                    keyword: { score: -1 }
                };

                // Always first keyword should be page name
                const page_name = item.label.toLowerCase();
                if (item.keywords[0].matches.indexOf(page_name) < 0)
                    item.keywords[0].matches.unshift(page_name);

                // Keywords from manifest have different defaults than are usual
                item.keywords.forEach(i => {
                    i.weight = i.weight || 3;
                    i.translate = i.translate === undefined ? true : i.translate;
                });

                if (info.path)
                    item.path = info.path.replace(/\.html$/, "");
                else
                    item.path = name + "/" + prop;

                /* Split out any hash in the path */
                const pos = item.path.indexOf("#");
                if (pos !== -1) {
                    item.hash = item.path.substr(pos + 1);
                    item.path = item.path.substr(0, pos);
                }

                /* Fix component for compatibility and normalize it */
                if (item.path.indexOf("/") === -1)
                    item.path = name + "/" + item.path;
                if (item.path.slice(-6) == "/index")
                    item.path = item.path.slice(0, -6);
                self.items[item.path] = item;
            });
        });
    };

    self.ordered = function(section) {
        const list = [];
        for (const x in self.items) {
            if (!section || self.items[x].section === section)
                list.push(self.items[x]);
        }
        list.sort(function(a, b) {
            let ret = a.order - b.order;
            if (ret === 0)
                ret = a.label.localeCompare(b.label);
            return ret;
        });
        return list;
    };

    self.search = function(prop, value) {
        for (const x in self.items) {
            if (self.items[x][prop] === value)
                return self.items[x];
        }
    };
}

function follow(arg) {
    /* A promise of some sort */
    if (arguments.length == 1 && typeof arg.then == "function") {
        arg.then(function() { console.log.apply(console, arguments) },
                 function() { console.error.apply(console, arguments) });
        if (typeof arg.stream == "function")
            arg.stream(function() { console.log.apply(console, arguments) });
    }
}

let zz_value;

/* For debugging utility in the index window */
Object.defineProperties(window, {
    cockpit: { value: cockpit },
    zz: {
        get: function() { return zz_value },
        set: function(val) { zz_value = val; follow(val) }
    }
});

export function new_index_from_proto(proto) {
    const o = new Object(proto); // eslint-disable-line no-new-object
    Index.call(o);
    return o;
}

export function new_compiled() {
    return new CompiledComponents();
}
