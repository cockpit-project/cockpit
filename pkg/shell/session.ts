// SPDX-License-Identifier: LGPL-2.1-or-later

import cockpit from "cockpit";
import { EventEmitter } from "cockpit/event";
import { Channel } from "cockpit/channel";

const _ = cockpit.gettext;

/* SessionController for handling idle timeouts
 */

interface SessionControllerEvents {
    changed: () => void;
}

export class SessionController extends EventEmitter<SessionControllerEvents> {
    active: boolean;
    countdown: number = -1;
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
            if (typeof data.timeout === "number")
                this.#timeout = data.timeout;
        });

        channel.on("control", (message) => {
            if (message.command === "countdown" && typeof message.counter === "number") {
                this.countdown = message.counter;
                this.emit("changed");
            } else if (message.command === "logout") {
                cockpit.logout(true, _("You have been logged out due to inactivity."));
            }
        });

        channel.on("close", (options) => {
            const problem = (typeof options.problem === "string" ? options.problem : "") || "disconnected";
            this.#channel = null;
            console.warn("session terminated: " + problem);
            this.problem = problem;
            this.emit("changed");
        });

        this.#channel = channel;
    }

    inhibit_activity_reporting(flag: boolean) {
        this.#inhibit_activity_reporting = flag;
    }

    continue_session() {
        if (this.countdown != -1) {
            this.#send_activity_notification();
            this.countdown = -1;
            this.emit("changed");
        }
    }

    #last_activity_report_time: number = 0;
    #inhibit_activity_reporting: boolean = false;

    #record_activity = () => {
        const now = Date.now();
        if (!this.#inhibit_activity_reporting && Math.abs(now - this.#last_activity_report_time) > 10 * 1000) {
            this.#last_activity_report_time = now;
            this.#send_activity_notification();
            if (this.countdown !== -1) {
                this.countdown = -1;
                this.emit("changed");
            }
        }
    };

    #send_activity_notification() {
        if (this.#channel && this.#timeout !== 0)
            this.#channel.send_control({ command: "active" });
    }
}

let controller : SessionController | undefined;

export function get_session_controller(): SessionController {
    if (!controller)
        controller = new SessionController();
    return controller;
}
