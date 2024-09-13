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

import cockpit from "cockpit";

import { Router } from "./router.jsx";
import { machines as machines_factory } from "./machines/machines.js";
import {
    decode_location, decode_window_location, push_window_location, replace_window_location,
    compile_manifests, compute_frame_url,
} from "./util.jsx";

export function ShellState() {
    /* CONFIG
     */

    let language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*=\s*([^;]*).*$)|^.*$/, "$1");
    if (!language)
        language = navigator.language.toLowerCase(); // Default to Accept-Language header

    const config = {
        language,
        language_direction: cockpit.language_direction,
        host_switcher_enabled: false,
    };

    /* Host switcher enabled? */
    const meta_multihost = document.head.querySelector("meta[name='allow-multihost']");
    if (meta_multihost instanceof HTMLMetaElement && meta_multihost.content == "yes")
        config.host_switcher_enabled = true;

    /* Should show warning before connecting? */
    let config_ready = false;
    cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetString",
                                                 ["Session", "WarnBeforeConnecting"], [])
            .then(([result]) => {
                if (result == "false" || result == "no") {
                    window.sessionStorage.setItem("connection-warning-shown", "yes");
                }
            })
            .catch(e => {
                if (e.name != "cockpit.Config.KeyError")
                    console.warn("Error reading WarnBeforeConnecting configuration:", e.message);
            })
            .finally(() => {
                config_ready = true;
                on_ready();
            });

    /* MACHINES DATABASE AND MANIFEST LOADER
     *
     * These are part of the machinery in the basement that maintains
     * the database of all hosts (including "localhost", and monitors
     * their manifests.
     */

    const machines = machines_factory.instance();
    const loader = machines_factory.loader(machines);

    machines.addEventListener("ready", on_ready);

    machines.addEventListener("removed", (ev, machine) => {
        remove_machine_frames(machine);
    });
    machines.addEventListener("added", (ev, machine) => {
        preload_machine_frames(machine);
    });
    machines.addEventListener("updated", (ev, machine) => {
        if (!machine.visible || machine.problem)
            remove_machine_frames(machine);
        else
            preload_machine_frames(machine);
    });

    if (machines.ready)
        on_ready();

    function on_ready() {
        if (machines.ready && config_ready) {
            self.ready = true;
            window.addEventListener("popstate", ev => {
                update();
                ensure_frame_loaded();
                ensure_connection();
            });

            update();
            ensure_frame_loaded();
            ensure_connection();
        }
    }

    /* WATCH DOGS
     */

    const watchdog = cockpit.channel({ payload: "null" });
    watchdog.addEventListener("close", (event, options) => {
        const watchdog_problem = options.problem || "disconnected";
        console.warn("transport closed: " + watchdog_problem);
        self.problem = watchdog_problem;
        // We might get here real early, before events seem to
        // work. Let's push the update processing to the event loop.
        setTimeout(() => update(), 0);
    });

    const old_onerror = window.onerror;
    window.onerror = function cockpit_error_handler(msg, url, line) {
        // Errors with url == "" are not logged apparently, so let's
        // not show the "Oops" for them either.
        if (url != "") {
            self.has_oops = true;
            update();
        }
        if (old_onerror)
            return old_onerror(msg, url, line);
        return false;
    };

    /* FRAMES
     *
     * Frames are created on-demand when navigating to them for the
     * first time, by calling ENSURE_FRAME.
     *
     * Once a frame object is created it doesn't change anymore except
     * for its "ready", "loaded", and "hash" properties.
     *
     * The "ready" property starts out false and goes to true once the
     * corresponding iframe has created the document and window
     * objects for the actual frame content and you can attach event
     * handlers to it. The "loaded" property starts out false and goes
     * true once the code loaded into the frame has sent its "init"
     * message.
     *
     * Removing things (frames) is complicated, as usual.  We need to
     * be able to represent the state "The current frame has been
     * removed" without any call to update() re-creating it
     * spontaneously. Thus, a frame has a special "dead" state where
     * its "url" property is null. Actually clicking on navigation
     * elements will call the "ensure_frame_loaded" hook, which will
     * bring the current frame back to life if necessary. This happens
     * in the "jump" method.
     */

    const frames = { };

    function ensure_frame(machine, path, hash, title) {
        /* Never create new frames for machines that are not
           connected yet. That would open a channel to them (for
           loading the URL), which woould trigger the bridge to
           attempt a log in. We want all logins to happen in a
           single place (in hosts.jsx) so that we can get the
           options right, and show a warning dialog.
        */
        if (machine.address != "localhost" && machine.state !== "connected")
            return null;

        const name = "cockpit1:" + machine.connection_string + "/" + path;
        let frame = frames[name];

        if (!frame) {
            frame = frames[name] = {
                name,
                host: machine.address,
                path,
                url: compute_frame_url(machine, path),
                title,
                ready: false,
                loaded: false,
            };
        }

        frame.hash = hash || "/";
        return frame;
    }

    function ensure_frame_loaded () {
        if (self.current_frame && self.current_frame.url == null) {
            console.log("REQUEST TO LOAD", self.current_frame.name);
            // Let update() recreate the frame.
            delete frames[self.current_frame.name];
            self.current_frame = null;
            update();
        }
    }

    function kill_frame(name) {
        // Only mark frame as dead, it gets removed for real during
        // the call to "update".
        frames[name].url = null;
    }

    function remove_frame (name) {
        kill_frame(name);
        update();
    }

    function remove_machine_frames (machine) {
        const names = Object.keys(frames);
        for (const n of names) {
            if (frames[n].host == machine.address)
                kill_frame(n);
        }
        update();
    }

    function preload_machine_frames (machine) {
        const manifests = machine.manifests;
        const compiled = compile_manifests(manifests);
        for (const c in manifests) {
            const preload = manifests[c].preload;
            if (preload && preload.length) {
                for (const p of preload) {
                    const path = (p == "index") ? c : c + "/" + p;
                    const item = compiled.find_path_item(path);
                    ensure_frame(machine, path, null, item.label);
                }
            }
        }
        update();
    }

    /* PAGE STATUS
     *
     * Page status notifications arrive from the Router (see
     * below). We also store them in the session storage so that
     * individual pages have access to all collected statuses.
     */

    const page_status = { };
    sessionStorage.removeItem("cockpit:page_status");

    function notify_page_status(host, page, status) {
        if (!page_status[host])
            page_status[host] = { };
        page_status[host][page] = status;
        sessionStorage.setItem("cockpit:page_status", JSON.stringify(page_status));
        update();
    }

    /* ROUTER
     *
     * The router is the machinery in our basement that forwards
     * Cockpit protocol messages between the WebSocket and the
     * frames. Some messages are also meant for the Shell itself, and
     * we pass a big object with callback function to the router to
     * process these and other noteworthy events.
     */

    const router_callbacks = {
        /* The router has just processed the "init" message of the
         * code loaded into the frame named FRAME_NAME.
         *
         * We set the "loaded" property to help the tests, and also
         * tell the frame whether it is visible or not.
         */
        frame_is_initialized: function (frame_name) {
            const frame = frames[frame_name];
            if (frame) {
                console.log("FRAME INITIALIZED", frame_name);
                frame.loaded = true;
                update();
            }
            send_frame_hidden_hint(frame_name);
        },

        /* The frame named FRAME_NAME wants the shell to jump to
         * LOCATION.
         *
         * Only requests from the current frame are honored.  But the
         * tests also use this extensively for navigation, and might
         * send messages from the top-most window, which we know is
         * named "cockpit1".
         */
        perform_frame_jump_command: function (frame_name, location) {
            console.log("FRAME JUMP", frame_name, location);
            if (frame_name == "cockpit1" || (self.current_frame && self.current_frame.name == frame_name)) {
                jump(location);
                ensure_connection();
            }
        },

        /* The frame named FRAME_NAMED has just changed the hash part
         * of its URL. That's how frames navigate within themselves.
         *
         * When the current frame does that, we need to reflect the
         * hash change in the shell URL as well.
         */
        perform_frame_hash_track: function (frame_name, hash) {
            /* Note that we ignore tracking for old shell code */
            if (self.current_frame && self.current_frame.name === frame_name &&
                frame_name && frame_name.indexOf("/shell/shell") === -1) {
                /* The browser has already pushed an appropriate entry to
                   the history, so let's just replace it with one that
                   includes the right hash.
                */
                const location = Object.assign({}, decode_window_location(), { hash });
                replace_window_location(location);
                remember_location(location.host, location.path, location.hash);
                update();
            }
        },

        /* A notification has been received from a frame. We only
         * handle page status notifications, such as the ones that
         * tell you when software updates are available.  PAGE is the
         * "well-known name" of a page, such as "system",
         * "network/firewall", or "updates".
         */
        handle_notifications: function (host, page, data) {
            if (data.page_status !== undefined)
                notify_page_status(host, page, data.page_status);
        },

        /* One of the frames has experienced a unhandled JavaScript exception.
         */
        show_oops: function () {
            self.has_oops = true;
            update();
        },

        /* The host with address HOST has just initiated a restart. We
         * tell the loader.
         */
        expect_restart: function (host) {
            loader.expect_restart(host);
        },
    };

    function send_frame_hidden_hint (frame_name) {
        const hidden = !self.current_frame || self.current_frame.name != frame_name;
        console.log("HIDDEN HINT", frame_name, hidden);
        router.hint(frame_name, { hidden });
    }

    const router = new Router(router_callbacks);

    /* NAVIGATION
     *
     * The main navigation function, JUMP, will change window.location
     * as requested and then trigger a general ShellState update. The
     * update processing will look at window.location and update the
     * various "current_*" properties of the shell state accordingly.
     * (The update processing might also change window.location again
     * itself, in order to canonicalize it.)
     *
     * The new location given to JUMP can be partial; the missing
     * pieces are filled in from the browsing history in a (almost)
     * natural way. If the HOST part is missing, it will be taken from
     * the current location. If the PATH part is missing, the last
     * path visited on the given host is used. And if the HASH is
     * missing, the last one from the given HOST/PATH combination is
     * used. But only, and this is a historical quirk, when the new
     * host/path differs from the current host/path. Don't rely on
     * that, always use "/" as the hash when jumping to the top
     * sub-page.
     *
     * Calling JUMP will also make sure that the (newly) current frame
     * will now be loaded again in the case that it was explicitly
     * removed earlier. (This also happens when window.location isn't
     * actually changed by JUMP.)
     *
     * But JUMP will never open a new connection to a HOST that is not
     * yet connected. If you want that, call ENSURE_CONNECTION right
     * after JUMP.  However, it is better to first connect to the host
     * using the connect_host function from hosts_dialog.jsx and only
     * call JUMP when that has succeeded.
     *
     * Calling ENSURE_CONNECTION will start a user interaction to open
     * a connection to the host of the current navigation location,
     * but will not wait for this to be complete.
     */

    const last_path_for_host = { };
    const last_hash_for_host_path = { };

    function most_recent_path_for_host(host) {
        return last_path_for_host[host] || "";
    }

    function most_recent_hash_for_path(host, path) {
        if (last_hash_for_host_path[host])
            return last_hash_for_host_path[host][path] || null;
        return null;
    }

    function remember_location(host, path, hash) {
        last_path_for_host[host] = path;
        if (!last_hash_for_host_path[host])
            last_hash_for_host_path[host] = { };
        last_hash_for_host_path[host][path] = hash;
    }

    function jump (location) {
        if (typeof (location) === "string")
            location = decode_location(location);

        console.log("JUMP", JSON.stringify(location));

        const current = decode_window_location();

        /* Fill in the missing pieces, in order.
         */

        if (!location.host)
            location.host = current.host || "localhost";

        if (!location.path)
            location.path = most_recent_path_for_host(location.host);

        if (!location.hash) {
            if (location.host != current.host || location.path != current.path)
                location.hash = most_recent_hash_for_path(location.host, location.path);
            else
                console.warn('Shell jump with hash and no frame change. Please use "/" as the hash to jump to the top sub-page.');
        }

        if (location.host !== current.host ||
            location.path !== current.pathframe_change ||
            location.hash !== current.hash) {
            console.log("PUSH", JSON.stringify(location));
            push_window_location(location);
            update();
            ensure_frame_loaded();
            return true;
        }

        ensure_frame_loaded();
        return false;
    }

    function ensure_connection() {
        if (self.current_machine) {
            // Handle localhost right here, we never need user
            // interactions for it, and it is kind of important to not
            // mess up connecting to localhost. So we avoid relying on
            // the bigger machinery for it.
            //
            if (self.current_machine.connection_string == "localhost") {
                console.log("CONNECTING local");
                loader.connect("localhost");
                return;
            }

            console.log("CONNECT EVENT");
            self.dispatchEvent("connect");
        }
    }

    /* STATE
     *
     * Whenever the shell state changes, the "updated" event is
     * dispatched.
     *
     * The main part of the shell state is the information related to
     * the current navigation location:
     *
     * - current_location
     *
     * A object with "host", "path", and "hash" fields that reflect
     * the current location. "hash" does not have the "#" character.
     *
     * - current_machine
     *
     * The machine object (see machines/machines.js) for the "host"
     * part of "current_location". This is never null when
     * "current_location" isn't null. But the machine might not be
     * connected, and might not have manifests, etc.
     *
     * - current_manifest_item
     *
     * The manifest item corresponding to the "path" part of
     * "current_location". This is a piece of the current machines
     * manifests, from the "menu", "tools", or "dashboard" arrays.
     *
     * The item describes the navigation item in the sidebar that gets
     * highlighted for "path". The correspondence between the two is
     * not always straightforward. For example, both "network" and
     * "network/firewall" will have the same item, the one for
     * "Networking". But "system/logs" has its own item, "Logs",
     * eventhough it comes from the same package as the "system" path.
     *
     * And then, the "metrics" path has the "System" item associated
     * with it, although the two come from different packages.
     */

    const self = {
        ready: false,
        problem: null,
        has_oops: false,

        config,
        page_status,
        frames,

        current_location: null,
        current_machine: null,
        current_manifest_item: null,
        current_machine_manifest_items: null,

        // Methods
        jump,
        remove_frame,
        most_recent_path_for_host,

        // Access to the inner parts of the machinery, use with
        // caution.
        machines,
        loader,
        router,
    };

    cockpit.event_target(self);

    function update() {
        if (!self.ready || self.problem) {
            self.dispatchEvent("update");
            return;
        }

        const location = decode_window_location();

        // Force a redirect to localhost when the host switcher is
        // disabled. That way, people won't accidentally connect to
        // remote machines via URL bookmarks or similar that point to
        // them.
        if (!self.config.host_switcher_enabled) {
            location.host = "localhost";
            replace_window_location(location);
        }

        let machine = machines.lookup(location.host);

        /* No such machine */
        if (!machine || !machine.visible) {
            machine = {
                key: location.host,
                address: location.host,
                label: location.host,
                state: "failed",
                problem: "not-found",
            };
        }

        const compiled = compile_manifests(machine.manifests);
        if (machine.manifests && !location.path) {
            // Find the default path based on the manifest.
            const menu_items = compiled.ordered("menu");
            if (menu_items.length > 0 && menu_items[0])
                location.path = menu_items[0].path;
            location.path = "system";
            replace_window_location(location);
        }

        // Remember the most recent history for each host, and each
        // host/path combinaton.  This is used by JUMP to complete
        // partial locations.
        //
        remember_location(location.host, location.path, location.hash);

        const item = compiled.find_path_item(location.path);

        self.current_location = location;
        self.current_machine = machine;
        self.current_machine_manifest_items = compiled;
        self.current_manifest_item = item;

        let frame = null;
        if (location.path && (machine.state == "connected" || machine.state == "connecting"))
            frame = ensure_frame(machine, location.path, location.hash, item.label);

        if (frame != self.current_frame) {
            const prev_frame = self.current_frame;
            self.current_frame = frame;

            if (prev_frame)
                send_frame_hidden_hint(prev_frame.name);
            if (frame)
                send_frame_hidden_hint(frame.name);
        }

        // Remove all dead frames that are not the current one.
        for (const n of Object.keys(frames)) {
            if (frames[n].url == null && frames[n] != self.current_frame)
                delete frames[n];
        }

        self.dispatchEvent("update");
    }

    self.update = update;

    return self;
}
