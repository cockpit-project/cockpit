/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* Session timing out after inactivity */

import cockpit from "cockpit";

import React from 'react';
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
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
    #idle_start_time: number;

    final_countdown: null | number = null;

    constructor() {
        super();

        this.#idle_start_time = Date.now();
        this.#disarm_ws_timeout();

        cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetUInt",
                                                     ["Session", "IdleTimeout", 0, 240, 0], {})
                .then(result => {
                    this.#session_timeout = (result[0] as number) * 60000;
                    if (this.#session_timeout > 0 && this.#standard_login) {
                        this.setupIdleResetEventListeners(window);
                        window.setInterval(this.#idleTick, 5000);
                        this.#arm_ws_timeout();
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
        const idle_time = Date.now() - this.#idle_start_time;
        if (this.final_countdown === null && idle_time >= this.#session_timeout - this.#final_countdown_secs * 1000) {
            // It's the final countdown...
            this.#final_countdown_timer = window.setInterval(this.#finalCountdownTick, 1000);
            this.#finalCountdownTick();
        }
    };

    #finalCountdownTick = () => {
        this.final_countdown = Math.floor((this.#idle_start_time + this.#session_timeout - Date.now()) / 1000);
        if (this.final_countdown <= 0)
            cockpit.logout(true, _("You have been logged out due to inactivity."));
        this.#update();
    };

    #resetTimer = () => {
        if (this.final_countdown === null) {
            const idle_time = Date.now() - this.#idle_start_time;
            if (idle_time > 10 * 1000) {
                this.#idle_start_time = Date.now();
                this.#arm_ws_timeout();
            }
        }
    };

    #arm_ws_timeout() {
        // Tell cockpit-ws to kill the session 10 seconds after we are
        // supposed to have logged out here. This is an emergency
        // fallback mechanism for the case that the browser stops
        // executing our JavaScript. Once JavaScript starts running
        // again and the websocket has been closed by cockpit-ws and
        // the Shell will show the "Disconnected" curtain. Then the
        // timer ticks here will happen and will perform the browser
        // side of the logout immediately and we end up on the login
        // page with the expected "Logged out due to inactivity"
        // message.

        cockpit.assert(this.#session_timeout > 0);
        cockpit.transport.control("set-session-timeout", { seconds: this.#session_timeout / 1000 + 10 });
    }

    #disarm_ws_timeout() {
        cockpit.transport.control("set-session-timeout", { seconds: 0 });
    }

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
        this.final_countdown = null;
        this.#resetTimer();
        window.clearInterval(this.#final_countdown_timer);
        this.#update();
    }
}

export const FinalCountdownModal = ({ state } : { state: IdleTimeoutState }) => {
    if (state.final_countdown === null)
        return null;

    return (
        <Modal isOpen position="top" variant="medium"
               id="session-timeout-modal">
            <ModalHeader title={_("Session is about to expire")} />
            <ModalBody>
                { cockpit.format(_("You will be logged out in $0 seconds."), state.final_countdown) }
            </ModalBody>
            <ModalFooter>
                <Button variant='primary'
                    onClick={() => state.cancel_final_countdown()}
                >
                    {_("Continue session")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
