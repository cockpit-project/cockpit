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

/* Session timing out after inactivity */

import cockpit from "cockpit";

import React from 'react';
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

import { EventEmitter } from "cockpit/event";

const _ = cockpit.gettext;

interface IdleTimeoutStateEvents {
    update: () => void;
}

export class IdleTimeoutState extends EventEmitter<IdleTimeoutStateEvents> {
    #final_countdown_secs = 30;
    #standard_login = window.localStorage['standard-login'];

    #final_countdown_timer: number = -1;
    #session_timeout: number = 0;
    #current_idle_time: number = 0;

    final_countdown: null | number = null;

    constructor() {
        super();

        cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetUInt",
                                                     ["Session", "IdleTimeout", 0, 240, 0], {})
                .then(result => {
                    this.#session_timeout = (result[0] as number) * 60000;
                    if (this.#session_timeout > 0 && this.#standard_login) {
                        this.setupIdleResetEventListeners(window);
                        window.setInterval(this.#idleTick, 5000);
                    }
                })
                .catch(e => {
                    if (e.message.indexOf("GetUInt not available") === -1)
                        console.warn(e.message);
                });
    }

    #update() {
        this.emit("update");
    }

    #idleTick = () => {
        this.#current_idle_time += 5000;
        if (this.final_countdown === null &&
            this.#current_idle_time >= this.#session_timeout - this.#final_countdown_secs * 1000) {
            // It's the final countdown...
            this.final_countdown = this.#final_countdown_secs;
            this.#final_countdown_timer = window.setInterval(this.#finalCountdownTick, 1000);
            this.#update();
        }
    };

    #finalCountdownTick = () => {
        cockpit.assert(this.final_countdown !== null);
        this.final_countdown -= 1;
        if (this.final_countdown <= 0)
            cockpit.logout(true, _("You have been logged out due to inactivity."));
        this.#update();
    };

    #resetTimer = () => {
        if (this.final_countdown === null)
            this.#current_idle_time = 0;
    };

    setupIdleResetEventListeners(win: Window) {
        // NOTE: This function will be called many many times for a
        // given window, not just once. Calling addEventListener
        // multiple times is ok here, however, since we always pass
        // the exact same listener.
        if (this.#session_timeout > 0 && this.#standard_login) {
            win.addEventListener("mousemove", this.#resetTimer, false);
            win.addEventListener("mousedown", this.#resetTimer, false);
            win.addEventListener("keypress", this.#resetTimer, false);
            win.addEventListener("touchmove", this.#resetTimer, false);
            win.addEventListener("scroll", this.#resetTimer, false);
        }
    }

    cancel_final_countdown() {
        this.#current_idle_time = 0;
        this.final_countdown = null;
        window.clearInterval(this.#final_countdown_timer);
        this.#update();
    }
}

export const FinalCountdownModal = ({ state } : { state: IdleTimeoutState }) => {
    if (state.final_countdown === null)
        return null;

    return (
        <Modal isOpen position="top" variant="medium"
               showClose={false}
               title={_("Session is about to expire")}
               id="session-timeout-modal"
               footer={<Button variant='primary'
                               onClick={() => state.cancel_final_countdown()}>
                   {_("Continue session")}
               </Button>}>
            { cockpit.format(_("You will be logged out in $0 seconds."), state.final_countdown) }
        </Modal>
    );
};
