// SPDX-License-Identifier: LGPL-2.1-or-later

import type cockpit from "cockpit";
import { EventEmitter } from '../event';

type Cockpit = typeof cockpit;

interface SessionControllerEvents {
    changed: () => void;
    host_disconnected: (host: string, problem: string) => void;
}

export class SessionController extends EventEmitter<SessionControllerEvents> {
    active: boolean;
    countdown: number = 0;
    problem: string | null = null;

    #cockpit: Cockpit;

    constructor(cockpit: Cockpit) {
        super();
        this.#cockpit = cockpit;
        this.active = (window.parent === window || window.name.indexOf("cockpit1:") !== 0);
        this.add_window(window);
        this.add_host("localhost");
    }

    add_window(win: Window) {
        if (!this.active)
            return;

        // NOTE: This function will be called many many times for a
        // given window, not just once. Calling addEventListener
        // multiple times is ok here, however, since we always pass
        // the exact same listener.
        win.addEventListener("mousemove", this.#recordActivity, false);
        win.addEventListener("mousedown", this.#recordActivity, false);
        win.addEventListener("keypress", this.#recordActivity, false);
        win.addEventListener("touchmove", this.#recordActivity, false);
        win.addEventListener("scroll", this.#recordActivity, false);
    }

    #host_channels: Map<string, cockpit.Channel<string>> = new Map();

    add_host(host: string) {
        if (!this.active)
            return;

        const channel = this.#cockpit.channel({ host, payload: "session-control" });

        channel.addEventListener("message", (_unused, event_str) => {
            try {
                const event = JSON.parse(event_str);
                if ("countdown" in event && typeof event.countdown == "number") {
                    if (this.countdown == 0 || event.countdown < this.countdown) {
                        this.countdown = event.countdown;
                        this.emit("changed");
                    }
                }
                if ("logout" in event)
                    this.#cockpit.logout(true, this.#cockpit.gettext("You have been logged out due to inactivity."));
            } catch (ex) {
                console.warn("Failed to parse session control event", String(ex));
            }
        });

        channel.addEventListener("close", (_, options) => {
            const problem = ("problem" in options && typeof options.problem == "string" ? options.problem : "") || "disconnected";
            this.#host_channels.delete(host);
            this.emit("host_disconnected", host, problem);

            if (host == "localhost") {
                console.warn("transport closed: " + problem);
                this.problem = problem;
                this.emit("changed");
            }
        });

        this.#host_channels.set(host, channel);
    }

    inhibit_activity_reporting(flag: boolean) {
        this.#inhibit_activity_reporting = flag;
    }

    continue_session() {
        if (this.countdown != 0) {
            this.#notify_hosts();
            this.countdown = 0;
            this.emit("changed");
        }
    }

    #last_user_was_active: number = 0;
    #inhibit_activity_reporting: boolean = false;

    #recordActivity = () => {
        const now = Date.now();
        if (!this.#inhibit_activity_reporting && now > this.#last_user_was_active + 10 * 1000) {
            this.#last_user_was_active = now;
            this.#notify_hosts();
        }
    };

    #notify_hosts() {
        for (const ch of this.#host_channels.values())
            ch.send("active");
    }
}
