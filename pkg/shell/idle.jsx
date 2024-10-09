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

const _ = cockpit.gettext;

export const IdleTimeoutState = () => {
    const final_countdown_secs = 30;
    const standard_login = window.localStorage['standard-login'];

    let final_countdown_timer = -1;
    let session_timeout = 0;
    let current_idle_time = 0;

    const self = {
        final_countdown: false,
    };

    function update() {
        self.dispatchEvent("update");
    }

    cockpit.event_target(self);

    function idleTick() {
        current_idle_time += 5000;
        if (self.final_countdown === false && current_idle_time >= session_timeout - final_countdown_secs * 1000) {
            // It's the final countdown...
            self.final_countdown = final_countdown_secs;
            final_countdown_timer = window.setInterval(finalCountdownTick, 1000);
            update();
        }
    }

    function finalCountdownTick() {
        self.final_countdown -= 1;
        if (self.final_countdown <= 0)
            cockpit.logout(true, _("You have been logged out due to inactivity."));
        update();
    }

    function resetTimer(ev) {
        if (self.final_countdown === false)
            current_idle_time = 0;
    }

    function setupIdleResetEventListeners(win) {
        // NOTE: This function will be called many many times for a
        // given window, not just once. Calling addEventListener
        // multiple times is ok here, however, since we always pass
        // the exact same listener.
        if (session_timeout > 0 && standard_login) {
            win.addEventListener("mousemove", resetTimer, false);
            win.addEventListener("mousedown", resetTimer, false);
            win.addEventListener("keypress", resetTimer, false);
            win.addEventListener("touchmove", resetTimer, false);
            win.addEventListener("scroll", resetTimer, false);
        }
    }

    self.setupIdleResetEventListeners = setupIdleResetEventListeners;

    cockpit.dbus(null, { bus: "internal" }).call("/config", "cockpit.Config", "GetUInt", ["Session", "IdleTimeout", 0, 240, 0], [])
            .then(result => {
                session_timeout = result[0] * 60000;
                if (session_timeout > 0 && standard_login) {
                    setupIdleResetEventListeners(window);
                    window.setInterval(idleTick, 5000);
                }
            })
            .catch(e => {
                if (e.message.indexOf("GetUInt not available") === -1)
                    console.warn(e.message);
            });

    self.cancel_final_countdown = function () {
        current_idle_time = 0;
        self.final_countdown = false;
        window.clearInterval(final_countdown_timer);
        update();
    };

    return self;
};

export const FinalCountdownModal = ({ state }) => {
    if (state.final_countdown === false)
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
