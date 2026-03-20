// SPDX-License-Identifier: LGPL-2.1-or-later

import { transport_globals, ensure_transport } from './_internal/transport';
import { localStorage, sessionStorage } from './_internal/storage';
import { EventEmitter } from './event';
import { Channel } from './channel';
import { _ } from './_internal/gettext';

/* Logout
 */

export function logout(reload: boolean, reason?: string) {
    /* fully clear session storage */
    sessionStorage.clear(true);

    /* Only clean application data from localStorage,
     * except for login-data. Clear that completely */
    localStorage.removeItem('login-data', true);
    localStorage.clear(false);

    if (reload !== false)
        transport_globals.reload_after_disconnect = true;
    ensure_transport(function(transport) {
        if (!transport.send_control({ command: "logout", disconnect: true })) {
            // @ts-expect-error: Firefox has a force-reload parameter.
            window.location.reload(reload);
        }
    });
    window.sessionStorage.setItem("logout-intent", "explicit");
    if (reason)
        window.sessionStorage.setItem("logout-reason", reason);
}

/* SessionController for handling idle timeouts
 */

interface SessionControllerEvents {
    changed: () => void;
}

export class SessionController extends EventEmitter<SessionControllerEvents> {
    active: boolean;
    countdown: number = 0;
    problem: string | null = null;

    #channel: Channel | null = null;
    #timeout: number = -1;

    constructor() {
        super();
        this.active = (window.parent === window || window.name.indexOf("cockpit1:") !== 0);
        if (this.active) {
            console.debug("session controller active for", window.name);
            this.add_window(window);
            this.#open_channel();
        }
    }

    add_window(win: Window) {
        if (!this.active)
            return;

        // NOTE: This function will be called many many times for a
        // given window, not just once. Calling addEventListener
        // multiple times is ok here, however, since we always pass
        // the exact same listener.
        win.addEventListener("mousemove", this.#record_activity, false);
        win.addEventListener("mousedown", this.#record_activity, false);
        win.addEventListener("keypress", this.#record_activity, false);
        win.addEventListener("touchmove", this.#record_activity, false);
        win.addEventListener("scroll", this.#record_activity, false);
    }

    #open_channel() {
        const channel = new Channel({ payload: "session-control" });

        channel.on("ready", (data) => {
            if ("timeout" in data && typeof data.timeout == "number")
                this.#timeout = data.timeout;
        });

        channel.on("data", (event_str) => {
            try {
                const event = JSON.parse(event_str);
                if ("countdown" in event && typeof event.countdown == "number") {
                    if (this.countdown == 0 || event.countdown < this.countdown) {
                        this.countdown = event.countdown;
                        this.emit("changed");
                    }
                }
                if ("logout" in event) {
                    logout(true, _("You have been logged out due to inactivity."));
                }
            } catch (ex) {
                console.warn("Failed to parse session control event", String(ex));
            }
        });

        channel.on("close", (options) => {
            const problem = ("problem" in options && typeof options.problem == "string" ? options.problem : "") || "disconnected";
            this.#channel = null;
            console.warn("transport closed: " + problem);
            this.problem = problem;
            this.emit("changed");
        });

        this.#channel = channel;
    }

    inhibit_activity_reporting(flag: boolean) {
        this.#inhibit_activity_reporting = flag;
    }

    continue_session() {
        if (this.countdown != 0) {
            this.#send_activity_notification();
            this.countdown = 0;
            this.emit("changed");
        }
    }

    #last_user_was_active: number = 0;
    #inhibit_activity_reporting: boolean = false;

    #record_activity = () => {
        const now = Date.now();
        if (!this.#inhibit_activity_reporting && now > this.#last_user_was_active + 10 * 1000) {
            this.#last_user_was_active = now;
            this.#send_activity_notification();
            if (this.countdown != 0) {
                this.countdown = 0;
                this.emit("changed");
            }
        }
    };

    #send_activity_notification() {
        if (this.#channel && this.#timeout != 0)
            this.#channel.send_data("active");
    }
}

export function get_session_controller(): SessionController {
    if (!transport_globals.session_controller)
        transport_globals.session_controller = new SessionController();
    return transport_globals.session_controller;
}
