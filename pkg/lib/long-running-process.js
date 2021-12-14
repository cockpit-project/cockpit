/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

/* Manage a long-running precious process that runs independently from a Cockpit
 * session in a transient systemd service unit. See
 * examples/long-running-process/README.md for details.
 *
 * The unit will run as root, on the system systemd manager, so that every privileged
 * Cockpit session shares the same unit. The same approach works in principle on
 * the user's systemd instance, but the current code  does not support that as it
 * is not a common use case for Cockpit.
 */

/* global cockpit */

// systemd D-Bus API names
const O_SD_OBJ = "/org/freedesktop/systemd1";
const I_SD_MGR = "org.freedesktop.systemd1.Manager";
const I_SD_UNIT = "org.freedesktop.systemd1.Unit";
const I_DBUS_PROP = "org.freedesktop.DBus.Properties";

/* Possible LongRunningProcess.state values */
export const ProcessState = {
    INIT: 'init',
    STOPPED: 'stopped',
    RUNNING: 'running',
    FAILED: 'failed',
};

export class LongRunningProcess {
    /* serviceName: systemd unit name to start or reattach to
     * updateCallback: function that gets called whenever the state changed; first and only
     *                 argument is `this` LongRunningProcess instance.
     */
    constructor(serviceName, updateCallback) {
        this.systemdClient = cockpit.dbus("org.freedesktop.systemd1", { superuser: "require" });
        this.serviceName = serviceName;
        this.updateCallback = updateCallback;
        this._setState(ProcessState.INIT);
        this.startTimestamp = null; // µs since epoch
        this.terminated = false;

        // Watch for start event of the service
        this.systemdClient.subscribe({ interface: I_SD_MGR, member: "JobNew" }, (path, iface, signal, args) => {
            if (args[2] == this.serviceName)
                this._checkState();
        });

        // Check if it is already running
        this._checkState();
    }

    /* Start long-running process. Only call this in states STOPPED or FAILED.
     * This runs as root, thus will be shared with all privileged Cockpit sessions.
     * Return cockpit.spawn promise. You need to handle exceptions, but not success.
     */
    run(argv, options) {
        if (this.state !== ProcessState.STOPPED && this.state !== ProcessState.FAILED)
            throw new Error(`cannot start LongRunningProcess in state ${this.state}`);

        // no need to directly react to this -- JobNew and _checkState() will pick up when the unit runs
        return cockpit.spawn(["systemd-run", "--unit", this.serviceName, "--service-type=oneshot", "--no-block", "--"].concat(argv),
                             { superuser: "require", err: "message", ...options });
    }

    /*  Stop long-running process while it is RUNNING, or reset a FAILED one */
    terminate() {
        if (this.state !== ProcessState.RUNNING && this.state !== ProcessState.FAILED)
            throw new Error(`cannot terminate LongRunningProcess in state ${this.state}`);

        /* This sends a SIGTERM to the unit, causing it to go into "failed" state. This would not
         * happen with `systemd-run -p SuccessExitStatus=0`, but that does not yet work on older
         * OSes with systemd ≤ 241 So let checkState() know that a failure is due to termination. */
        this.terminated = true;
        return this.systemdClient.call(O_SD_OBJ, I_SD_MGR, "StopUnit", [this.serviceName, "replace"], { type: "ss" });
    }

    /*
     * below are internal private methods
     */

    _setState(state) {
        /* PropertiesChanged often gets fired multiple times with the same values, avoid UI flicker */
        if (state === this.state)
            return;
        this.state = state;
        this.terminated = false;
        if (this.updateCallback)
            this.updateCallback(this);
    }

    _setStateFromProperties(activeState, stateChangeTimestamp) {
        switch (activeState) {
        case 'activating':
            this.startTimestamp = stateChangeTimestamp;
            this._setState(ProcessState.RUNNING);
            break;
        case 'failed':
            this.startTimestamp = null; // TODO: can we derive this from InvocationID?
            if (this.terminated) {
                /* terminating causes failure; reset that and do not announce it as failed */
                this.systemdClient.call(O_SD_OBJ, I_SD_MGR, "ResetFailedUnit", [this.serviceName], { type: "s" });
            } else {
                this._setState(ProcessState.FAILED);
            }
            break;
        case 'inactive':
            this._setState(ProcessState.STOPPED);
            break;
        case 'deactivating':
            /* ignore these transitions */
            break;
        default:
            throw new Error(`unexpected state of unit ${this.serviceName}: ${activeState}`);
        }
    }

    // check if the transient unit for our command is running
    _checkState() {
        this.systemdClient.call(O_SD_OBJ, I_SD_MGR, "GetUnit", [this.serviceName], { type: "s" })
                .then(([unitObj]) => {
                    /* Some time may pass between getting JobNew and the unit actually getting activated;
                     * we may get an inactive unit here; watch for state changes. This will also update
                     * the UI if the unit stops. */
                    this.subscription = this.systemdClient.subscribe(
                        { interface: I_DBUS_PROP, member: "PropertiesChanged" },
                        (path, iface, signal, args) => {
                            if (path === unitObj && args[1].ActiveState && args[1].StateChangeTimestamp)
                                this._setStateFromProperties(args[1].ActiveState.v, args[1].StateChangeTimestamp.v);
                        });

                    this.systemdClient.call(unitObj, I_DBUS_PROP, "GetAll", [I_SD_UNIT], { type: "s" })
                            .then(([props]) => this._setStateFromProperties(props.ActiveState.v, props.StateChangeTimestamp.v))
                            .catch(ex => {
                                throw new Error(`unexpected failure of GetAll(${unitObj}): ${ex.toString()}`);
                            });
                })
                .catch(ex => {
                    if (ex.name === "org.freedesktop.systemd1.NoSuchUnit") {
                        if (this.subscription) {
                            this.subscription.remove();
                            this.subscription = null;
                        }
                        this._setState(ProcessState.STOPPED);
                    } else {
                        throw new Error(`unexpected failure of GetUnit(${this.serviceName}): ${ex.toString()}`);
                    }
                });
    }
}
