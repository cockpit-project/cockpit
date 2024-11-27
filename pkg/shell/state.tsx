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

import { EventEmitter } from "cockpit/event";

import { Router } from "./router.jsx";
import {
    machines as machines_factory,
    Machine, Machines, Loader, Manifest
} from "./machines/machines.js";
import {
    decode_location, decode_window_location, push_window_location, replace_window_location,
    compile_manifests, compute_frame_url,
    Location, ManifestItem, CompiledComponents,
} from "./util.jsx";

export interface ShellConfig {
    language: string;
    language_direction: string;
    host_switcher_enabled: boolean;
}

export interface ShellFrame {
    name: string;
    host: string;
    path: string;
    title: string;
    url: string | null;
    hash: string;
    ready: boolean;
    loaded: boolean;
}

export interface ShellStateEvents {
    update: () => void;
    connect: () => void;
}

export class ShellState extends EventEmitter<ShellStateEvents> {
    constructor() {
        super();
        this.config = this.#init_config();

        this.machines = this.#init_machines();
        this.loader = this.#init_loader();
        this.router = this.#init_router();

        this.#init_watch_dogs();
        this.#init_page_status();

        this.#on_ready();
    }

    /* READINESS STATE
     */

    ready: boolean = false;
    problem: string | null = null;
    has_oops: boolean = false;

    #on_ready() {
        if (this.machines.ready && this.#config_ready) {
            this.ready = true;
            window.addEventListener("popstate", () => {
                this.update();
                this.ensure_frame_loaded();
                this.ensure_connection();
            });

            this.update();
            this.ensure_frame_loaded();
            this.ensure_connection();
        }
    }

    /* CONFIG
     */

    config: ShellConfig;

    #config_ready: boolean = false;

    #init_config() {
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
        this.#config_ready = false;
        cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetString",
                                                     ["Session", "WarnBeforeConnecting"], {})
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
                    this.#config_ready = true;
                    this.#on_ready();
                });

        return config;
    }

    /* MACHINES AND LOADER
     *
     * These are part of the machinery in the basement that maintains
     * the database of all hosts (including "localhost"), and monitors
     * their manifests.
     */

    machines: Machines;
    loader: Loader;

    #init_machines() {
        const machines = machines_factory.instance();

        machines.addEventListener("ready", () => this.#on_ready());

        machines.addEventListener("removed", (_, machine) => {
            this.#remove_machine_frames(machine);
        });
        machines.addEventListener("added", (_, machine) => {
            this.#preload_machine_frames(machine);
        });
        machines.addEventListener("updated", (_, machine) => {
            if (!machine.visible || machine.problem)
                this.#remove_machine_frames(machine);
            else
                this.#preload_machine_frames(machine);
        });

        return machines;
    }

    #init_loader() {
        return machines_factory.loader(this.machines);
    }

    /* WATCH DOGS
     */

    #init_watch_dogs() {
        const watchdog = cockpit.channel({ payload: "null" });
        watchdog.addEventListener("close", (_, options) => {
            const watchdog_problem = options.problem as string || "disconnected";
            console.warn("transport closed: " + watchdog_problem);
            this.problem = watchdog_problem;
            // We might get here real early, before events seem to
            // work. Let's push the update processing to the event loop.
            setTimeout(() => this.update(), 0);
        });

        const old_onerror = window.onerror;
        window.onerror = (msg, url, line) => {
            // Errors with url == "" are not logged apparently, so let's
            // not show the "Oops" for them either.
            if (url != "") {
                this.has_oops = true;
                this.update();
            }
            if (old_onerror)
                return old_onerror(msg, url, line);
            return false;
        };
    }

    /* FRAMES
     *
     * Frames are created on-demand when navigating to them for the
     * first time, by calling ensure_frame().
     *
     * Once a frame object is created it doesn't change anymore except
     * for its "ready", "loaded", and "hash" properties.
     *
     * The "ready" property starts out false and goes to true once the
     * corresponding iframe has loaded its URL. The "loaded" property
     * starts out false and goes true once the code loaded into the
     * frame has sent its "init" message.
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

    frames: { [name: string]: ShellFrame } = { };

    #ensure_frame(machine: Machine, path: string, hash: string | null, title: string): ShellFrame | null {
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
        let frame = this.frames[name];

        if (!frame) {
            frame = this.frames[name] = {
                name,
                host: machine.address,
                path,
                url: compute_frame_url(machine, path),
                hash: hash || "/",
                title,
                ready: false,
                loaded: false,
            };
        } else {
            // XXX - shouldn't we leave the hash alone when it is null here?
            frame.hash = hash || "/";
        }
        return frame;
    }

    ensure_frame_loaded (): void {
        if (this.current_frame && this.current_frame.url == null) {
            // Let update() recreate the frame.
            delete this.frames[this.current_frame.name];
            this.current_frame = null;
            this.update();
        }
    }

    #kill_frame(name: string): void {
        // Only mark frame as dead, it gets removed for real during
        // the call to "update".
        this.frames[name].url = null;
    }

    remove_frame (name: string): void {
        this.#kill_frame(name);
        this.update();
    }

    #remove_machine_frames (machine: Machine): void {
        const names = Object.keys(this.frames);
        for (const n of names) {
            if (this.frames[n].host == machine.address)
                this.#kill_frame(n);
        }
        this.update();
    }

    #preload_machine_frames (machine: Machine) {
        const manifests = machine.manifests;
        const compiled = compile_manifests(manifests);
        for (const c in manifests) {
            const preload = manifests[c].preload as unknown as string[];
            if (preload && preload.length) {
                for (const p of preload) {
                    const path = (p == "index") ? c : c + "/" + p;
                    const item = compiled.find_path_item(path);
                    this.#ensure_frame(machine, path, null, item.label);
                }
            }
        }
        this.update();
    }

    /* PAGE STATUS
     *
     * Page status notifications arrive from the Router (see
     * below). We also store them in the session storage so that
     * individual pages have access to all collected statuses.
     */

    page_status: { [host: string]: { [page: string]: unknown } } = { };

    #init_page_status() {
        sessionStorage.removeItem("cockpit:page_status");
    }

    #notify_page_status(host: string, page: string, status: unknown) {
        if (!this.page_status[host])
            this.page_status[host] = { };
        this.page_status[host][page] = status;
        sessionStorage.setItem("cockpit:page_status", JSON.stringify(this.page_status));
        this.update();
    }

    /* ROUTER
     *
     * The router is the machinery in our basement that forwards
     * Cockpit protocol messages between the WebSocket and the
     * frames. Some messages are also meant for the Shell itself, and
     * we pass a big object with callback function to the router to
     * process these and other noteworthy events.
     */

    router: Router;

    #init_router() {
        const callbacks = {
            /* The router has just processed the "init" message of the
             * code loaded into the frame named FRAME_NAME.
             *
             * We set the "loaded" property to help the tests, and also
             * tell the frame whether it is visible or not.
             */
            frame_is_initialized: (frame_name: string) => {
                const frame = this.frames[frame_name];
                if (frame) {
                    frame.loaded = true;
                    this.update();
                }
                this.#send_frame_hidden_hint(frame_name);
            },

            /* The frame named FRAME_NAME wants the shell to jump to
             * LOCATION.
             *
             * Only requests from the current frame are honored.  But the
             * tests also use this extensively for navigation, and might
             * send messages from the top-most window, which we know is
             * named "cockpit1".
             */
            perform_frame_jump_command: (frame_name: string, location: Location | string) => {
                if (frame_name == "cockpit1" || (this.current_frame && this.current_frame.name == frame_name)) {
                    this.jump(location);
                    this.ensure_connection();
                }
            },

            /* The frame named FRAME_NAMED has just changed the hash part
             * of its URL. That's how frames navigate within themselves.
             *
             * When the current frame does that, we need to reflect the
             * hash change in the shell URL as well.
             */
            perform_frame_hash_track: (frame_name: string, hash: string) => {
                /* Note that we ignore tracking for old shell code */
                if (this.current_frame && this.current_frame.name === frame_name &&
                    frame_name && frame_name.indexOf("/shell/shell") === -1) {
                    /* The browser has already pushed an appropriate entry to
                       the history, so let's just replace it with one that
                       includes the right hash.
                     */
                    const location = Object.assign({}, decode_window_location(), { hash });
                    replace_window_location(location);
                    this.#remember_location(location.host, location.path, location.hash);
                    this.update();
                }
            },

            /* A notification has been received from a frame. We only
             * handle page status notifications, such as the ones that
             * tell you when software updates are available.  PAGE is the
             * "well-known name" of a page, such as "system",
             * "network/firewall", or "updates".
             */
            handle_notifications: (host: string, page: string, data: { page_status?: unknown }) => {
                if (data.page_status !== undefined)
                    this.#notify_page_status(host, page, data.page_status);
            },

            /* One of the frames has experienced a unhandled JavaScript exception.
             */
            show_oops: () => {
                this.has_oops = true;
                this.update();
            },

            /* The host with address HOST has just initiated a restart. We
             * tell the loader.
             */
            expect_restart: (host: string) => {
                this.loader.expect_restart(host);
            },
        };

        return new Router(callbacks);
    }

    #send_frame_hidden_hint (frame_name: string) {
        const hidden = !this.current_frame || this.current_frame.name != frame_name;
        this.router.hint(frame_name, { hidden });
    }

    /* NAVIGATION
     *
     * The main navigation function, jump(), will change
     * window.location as requested and then trigger a general
     * ShellState update. The update processing will look at
     * window.location and update the various "current_*" properties
     * of the shell state accordingly.  (The update processing might
     * also change window.location again itself, in order to
     * canonicalize it.)
     *
     * The new location given to jump() can be partial; the missing
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
     * Calling jump() will also make sure that the (newly) current
     * frame will now be loaded again in the case that it was
     * explicitly removed earlier. (This also happens when
     * window.location isn't actually changed by jump().)
     *
     * But jump() will never open a new connection to a HOST that is
     * not yet connected. If you want that, call ensure_connection()
     * right after jump().  However, it is better to first connect to
     * the host using the connect_host function from hosts_dialog.jsx
     * and only call jump() when that has succeeded.
     *
     * Calling ensure_connection() will start a user interaction to
     * open a connection to the host of the current navigation
     * location, but will not wait for this to be complete.
     */

    #last_path_for_host: Record<string, string> = { };
    #last_hash_for_host_path: Record<string, Record<string, string>> = { };

    most_recent_path_for_host(host: string) {
        return this.#last_path_for_host[host] || "";
    }

    #most_recent_hash_for_path(host: string, path: string) {
        if (this.#last_hash_for_host_path[host])
            return this.#last_hash_for_host_path[host][path] || null;
        return null;
    }

    #remember_location(host: string, path: string, hash: string) {
        this.#last_path_for_host[host] = path;
        if (!this.#last_hash_for_host_path[host])
            this.#last_hash_for_host_path[host] = { };
        this.#last_hash_for_host_path[host][path] = hash;
    }

    jump (location: Partial<Location> | string): boolean {
        if (typeof (location) === "string")
            location = decode_location(location);

        const current = decode_window_location();

        /* Fill in the missing pieces, in order.
         */

        if (!location.host)
            location.host = current.host || "localhost";

        if (!location.path)
            location.path = this.most_recent_path_for_host(location.host);

        if (!location.hash) {
            if (location.host != current.host || location.path != current.path)
                location.hash = this.#most_recent_hash_for_path(location.host, location.path) || "/";
            else
                console.warn('Shell jump with hash and no frame change. Please use "/" as the hash to jump to the top sub-page.');
        }

        if (location.host !== current.host ||
            location.path !== current.path ||
            location.hash !== current.hash) {
            push_window_location(location as Location);
            this.update();
            this.ensure_frame_loaded();
            return true;
        }

        this.ensure_frame_loaded();
        return false;
    }

    ensure_connection() {
        if (this.current_machine) {
            // Handle localhost right here, we never need user
            // interactions for it, and it is kind of important to not
            // mess up connecting to localhost. So we avoid relying on
            // the bigger machinery for it.
            //
            if (this.current_machine.connection_string == "localhost") {
                this.loader.connect("localhost");
                return;
            }

            this.emit("connect");
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
     * And then, the "metrics" path has the "Overview" item associated
     * with it, although the two come from different packages.
     *
     * - current_manifest
     *
     * The manifest corresponding to the "path" part of
     * "current_location". The "current_manifest_item" is not
     * necessarily part of this manifest, but this manifest is always
     * from the same package as the files loaded for the current
     * location.
     *
     * For example, for the "metrics" path the "current_manifest" will
     * be for the "metrics" package, while "current_manifest_item" is
     * for the "Overview" menu entry from the "system" package.
     */

    current_location: Location | null = null;
    current_machine: Machine | null = null;
    current_manifest_item: ManifestItem | null = null;
    current_machine_manifest_items: CompiledComponents | null = null;
    current_manifest: Manifest | null = null;

    current_frame: ShellFrame | null = null;

    update() {
        if (!this.ready || this.problem) {
            this.emit("update");
            return;
        }

        const location = decode_window_location();

        // Force a redirect to localhost when the host switcher is
        // disabled. That way, people won't accidentally connect to
        // remote machines via URL bookmarks or similar that point to
        // them.
        if (!this.config.host_switcher_enabled) {
            location.host = "localhost";
            replace_window_location(location);
        }

        let machine = this.machines.lookup(location.host);

        /* No such machine */
        if (!machine || !machine.visible) {
            machine = {
                key: location.host,
                connection_string: location.host,
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
            else
                location.path = "system";
            replace_window_location(location);
        }

        // Remember the most recent history for each host, and each
        // host/path combinaton.  This is used by JUMP to complete
        // partial locations.
        //
        this.#remember_location(location.host, location.path, location.hash);

        const item = compiled.find_path_item(location.path);

        this.current_location = location;
        this.current_machine = machine;
        this.current_machine_manifest_items = compiled;
        this.current_manifest_item = item;
        this.current_manifest = compiled.find_path_manifest(location.path);

        let frame = null;
        if (location.path && (machine.state == "connected" || machine.state == "connecting"))
            frame = this.#ensure_frame(machine, location.path, location.hash, item.label);

        if (frame != this.current_frame) {
            const prev_frame = this.current_frame;
            this.current_frame = frame;

            if (prev_frame)
                this.#send_frame_hidden_hint(prev_frame.name);
            if (frame)
                this.#send_frame_hidden_hint(frame.name);
        }

        // Remove all dead frames that are not the current one.
        for (const n of Object.keys(this.frames)) {
            if (this.frames[n].url == null && this.frames[n] != this.current_frame)
                delete this.frames[n];
        }

        this.emit("update");
    }
}
