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

import '../../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page

import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from 'react-dom/client';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Select, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Card } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Toolbar, ToolbarContent, ToolbarFilter, ToolbarItem, ToolbarToggleGroup } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { ExclamationCircleIcon, FilterIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { Service } from "./service.jsx";
import { ServiceTabs, service_tabs_suffixes } from "./service-tabs.jsx";
import { ServicesList } from "./services-list.jsx";
import { CreateTimerDialog } from "./timer-dialog.jsx";
import { page_status } from "notifications";
import * as timeformat from "timeformat";
import cockpit from "cockpit";
import { superuser } from 'superuser';
import { useEvent, usePageLocation } from "hooks";
import { WithDialogs } from "dialogs.jsx";

import s_bus from "./busnames.js";
import "./services.scss";

const _ = cockpit.gettext;

// As long as we have long-running superuser channels, we need to
// reload the page when the access level changes.
//
superuser.reload_page_on_change();

export const systemd_client = {
    system: cockpit.dbus(s_bus.BUS_NAME, { bus: "system", superuser: "try" }),
    user: cockpit.dbus(s_bus.BUS_NAME, { bus: "session" }),
};
const timedate_client = cockpit.dbus('org.freedesktop.timedate1');
export let clock_realtime_now = 0; // ms since epoch; call updateTime() before using
let monotonic_timer_base = null; // µs

export const MAX_UINT64 = 2 ** 64 - 1;

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("services"))
        console.debug.apply(console, arguments);
}

export function updateTime() {
    Promise.all([
        cockpit.file("/proc/uptime").read(),
        cockpit.spawn(["date", "+%s"])
    ])
            .then(([uptime_contents, date_output]) => {
                clock_realtime_now = parseInt(date_output, 10) * 1000;

                // first number in /proc/uptime is time since boot (CLOCK_BOOTTIME) in seconds with two fractional digits
                const uptime = parseFloat(uptime_contents.split(' ')[0]);
                const clock_boottime_now = parseInt(uptime * 1000000, 10);

                monotonic_timer_base = clock_realtime_now * 1000 - clock_boottime_now;
            })
            .catch(ex => console.warn("Failed to read boot time:", ex.toString()));
}

/* Notes about the systemd D-Bus API
 *
 * - Loading all units, fetching their properties, and listening to JobNew/JobRemoved is
 *   expensive, so the services list does not do that. For 90% of what the list shows we
 *   only need two calls: ListUnits() for enough information about all units which are in
 *   systemd's brain; and ListUnitFiles() to add the inert ones (disabled, stopped, not a
 *   dependency of anything). The only exception are timers, where we have to get the
 *   properties of the Timers interface to show their last and next run. This information
 *   is collected in listUnits().
 *
 * - To keep up with changes, we listen to two signals: PropertiesChanged (which also gets
 *   fired when a unit gets loaded) for run state chanes, and Reloading for file state
 *   changes (like enabling/disabling).
 *
 * - When loading an unloaded unit, PropertiesChanged will be fired, but unfortunately in a
 *   rather useless way: it does not contain all properties (thus it needs a GetAll),
 *   and it usually happens for the Timer interface first (when we don't yet have an ID) and
 *   for the Unit interface later; due to that, we track them in two separate dicts.
 *
 * - The unit details view does its own independent API communication and state
 *   management. It needs to fetch/interpret a lot of unit properties which are not part
 *   of ListUnits(), but it only needs to do that for a single unit.
 *
 * - ListUnitFiles will return unit files that are aliases for other unit files, but
 *   ListUnits will not return aliases.
 *
 * - Methods like EnableUnitFiles only change the state of files on disk.  A Reload is
 *   necessary to update the state of loaded units.
 *
 * - The unit file state as returned by ListUnitFiles is not necessarily the same as the
 *   UnitFileState property of a loaded unit. ListUnitFiles reflects the state of the
 *   files on disk, while a loaded unit is only updated to that state via an explicit
 *   Reload. Thus, be careful to only use the UnitFileState as returned by ListUnitFiles
 *   for unloaded units. Loaded units should use the PropertiesChanged value to reflect
 *   runtime reality.
 *
 * A few historical notes which don't apply to the current code, but could be useful in
 * the future:
 *
 *
 * - A unit that isn't currently loaded has no object path. If you need one, do
 *   LoadUnit(); doing so will emit UnitNew.
 *
 * - One can use an object path for a unit that isn't currently loaded. Doing so will load
 *   the unit (and emit UnitNew).
 *
 * - JobNew and JobRemoved signals don't include the object path of the affected units,
 *   but we can get those by listening to UnitNew.
 *
 * - There might be UnitNew signals for units that are never returned by ListUnits or
 *   ListUnitFiles.  These are units that are mentioned in Requires, After, etc or that
 *   people try to load via LoadUnit but that don't actually exist.
 *
 * - The "Names" property of a unit only includes those aliases that are currently loaded,
 *   not all.  To get all possible aliases, one needs to call ListUnitFiles and match
 *   units via their object path.
 *
 * - The unit file state of a alias as returned by ListUnitFiles is always the same as the
 *   unit file state of the primary unit file.
 *
 * - A Reload will emit UnitRemoved/UnitNew signals for all units, and no
 *   PropertiesChanges signal for the properties that have changed because of the reload,
 *   such as UnitFileState.
 */

class ServicesPageBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            /* State related to the toolbar components */
            filters: {
                activeState: [],
                fileState: []
            },
            currentTextFilter: '',
            isFullyLoaded: false,
            error: null,
        };

        /* data storage
         *
         * do not keep as state, as that requires too much copying, and it's easy to miss updates due to setState()
         * coalescing; whenever these change, you need to force a state update to re-render
         */

        /* loaded units: ListUnits()/PropertiesChanged for Unit interface; object path → {
               Id,
               Description, LoadState, ActiveState,
               UnitFileState, // if unit has a file and got a PropertiesChanged
           } */
        this.units = {};
        // for <Service unitIsValid >
        this.knownIds = new Set();

        // active timers: object path → { LastTriggerTime, NextRunTime } (formatted strings)
        this.timers = {};

        /* ListUnitFiles() result; updated with daemon reload
           name/id (e.g. foo.service) → { Id, UnitFileState, ActiveState ("inactive" or empty for aliases) } */
        this.unit_files = {};

        // other state which should not cause re-renders
        this.seenActiveStates = new Set();
        this.seenUnitFileStates = new Set();
        this.reloading = false;

        this.filtersRef = React.createRef();

        // Possible LoadState values: stub, loaded, not-found, bad-setting, error, merged, masked
        // See: typedef enum UnitLoadStateState https://github.com/systemd/systemd/blob/main/src/basic/unit-def.h
        this.loadState = {
            stub: _("Stub"),
            loaded: "",
            "not-found": _("Not found"),
            "bad-setting": _("Bad setting"),
            error: _("Error"),
            merged: _("Merged"),
            masked: "", // We present the masked from the unitFileState
        };

        // Possible ActiveState values: active, reloading, inactive, failed, activating, deactivating, maintenance
        // See: typedef enum UnitActiveState https://github.com/systemd/systemd/blob/main/src/basic/unit-def.h
        this.activeState = {
            active: _("Running"),
            reloading: _("Reloading"),
            inactive: _("Not running"),
            failed: _("Failed to start"),
            activating: _("Running"),
            deactivating: _("Not running"),
            maintenance: _("Maintenance"),
        };

        // Possible UnitFileState values: enabled, enabled-runtime, linked, linked-runtime, alias, masked, masked-runtime, static, disabled, invalid, indirect, generated, transient, bad
        // See: typedef enum UnitFileState https://github.com/systemd/systemd/blob/main/src/basic/unit-file.h
        this.unitFileState = {
            enabled: _("Enabled"),
            "enabled-runtime": _("Enabled"),
            disabled: _("Disabled"),
            linked: _("Linked"),
            "linked-runtime": _("Linked"),
            alias: _("Alias"),
            masked: _("Masked"),
            "masked-runtime": _("Masked"),
            static: _("Static"),
            invalid: _("Invalid"),
            indirect: _("Indirect"),
            generated: _("Generated"),
            transient: _("Transient"),
            bad: _("Bad"),
        };

        this.listUnits = this.listUnits.bind(this);
        this.loadPinnedUnits = this.loadPinnedUnits.bind(this);
        this.onOptionsChanged = this.onOptionsChanged.bind(this);
        this.compareUnits = this.compareUnits.bind(this);
    }

    onOptionsChanged(options) {
        const currentOptions = { ...cockpit.location.options, ...options };

        if (!currentOptions.activestate || options.activestate == "[]")
            delete currentOptions.activestate;

        if (!currentOptions.filestate || options.filestate == "[]")
            delete currentOptions.filestate;

        if (!currentOptions.name)
            delete currentOptions.name;

        cockpit.location.go(cockpit.location.path, currentOptions);
    }

    componentDidMount() {
        systemd_client[this.props.owner].wait(() => {
            this.systemd_subscription = systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "Subscribe", null)
                    .finally(this.listUnits)
                    .catch(error => {
                        if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                        error.name != "org.freedesktop.DBus.Error.FileExists")
                            this.setState({ error: cockpit.format(_("Subscribing to systemd signals failed: $0"), error.toString()) });
                    });
        })
                .catch(ex => this.setState({ error: cockpit.format(_("Connecting to dbus failed: $0"), ex.toString()) }));

        cockpit.addEventListener("visibilitychange", () => {
            if (!cockpit.hidden) {
                debug("visibilitychange to visible; fully loaded", this.state.isFullyLoaded);
                /* If the page had only been fetched in the background we need to properly initialize the state now
                 * else just trigger an re-render since we are receiving signals while running in the background and
                 * we update the state but don't re-render
                 */
                if (!this.state.isFullyLoaded)
                    this.listUnits();
                else
                    this.setState({});
            } else {
                debug("visibilitychange to hidden");
            }
        });

        /* Start listening to signals for updates
         * - when in the middle of reload mute all signals
         * - We don't need to listen to 'UnitFilesChanged' signal since every time we
         *   perform some file operation we do call Reload which issues 'Reloading' signal
         */
        systemd_client[this.props.owner].subscribe({
            interface: s_bus.I_PROPS,
            member: "PropertiesChanged"
        }, async (path, _iface, _signal, [iface, props]) => {
            if (this.props.isLoading || this.reloading)
                return;

            // ignore uninteresting unit types
            if (!path.endsWith("service") && !path.endsWith("timer") && !path.endsWith("socket") &&
                !path.endsWith("target") && !path.endsWith("path"))
                return;

            if (iface === s_bus.I_TIMER) {
                if (!this.timers[path])
                    this.timers[path] = {};
                this.addTimerProperties(props, this.timers[path]);
                debug("timer PropertiesChanged on", path, JSON.stringify(this.timers[path]));
                return;
            }

            // ignore uninteresting interfaces
            if (iface !== s_bus.I_UNIT)
                return;

            let unit = this.units[path];

            if (!unit) {
                // this happens when starting an unloaded unit; unfortunately Units props is very incomplete, so we need a GetAll
                debug("unit PropertiesChanged on previously unloaded unit", path);
                try {
                    [props] = await systemd_client[this.props.owner].call(path, s_bus.I_PROPS, "GetAll", [s_bus.I_UNIT]);
                } catch (ex) { // not-covered: OS error
                    console.warn("GetAll Unit for unknown unit", path, "failed:", ex.toString()); // not-covered: OS error
                    return; // not-covered: OS error
                }
                unit = {};
                this.units[path] = unit;
            }

            // unwrap variants
            for (const prop of ["ActiveState", "LoadState", "Description", "Id", "UnitFileState"]) {
                if (props[prop])
                    unit[prop] = props[prop].v;
            }
            this.knownIds.add(unit.Id);
            debug("unit PropertiesChanged on", path, "complete:", JSON.stringify(unit));

            this.processFailedUnits();
            this.setState({ });
        });

        // handle transient units
        systemd_client[this.props.owner].subscribe({ interface: s_bus.I_MANAGER, member: "UnitRemoved" }, (_path, _iface, _signal, [_id, objpath]) => {
            // during daemon reload we get tons of these, ignore
            if (this.reloading)
                return;

            if (this.units[objpath]?.UnitFileState === 'transient') {
                debug("UnitRemoved of transient", objpath);
                delete this.knownIds.delete(this.units[objpath]?.Id);
                delete this.units[objpath];
                this.processFailedUnits();
                this.setState({ });
            }
        });

        systemd_client[this.props.owner].subscribe({ interface: s_bus.I_MANAGER, member: "Reloading" }, (_path, _iface, _signal, [reloading]) => {
            this.reloading = reloading;
            debug("Reloading", reloading);
            if (!reloading && !this.props.isLoading)
                this.listUnits();
        });

        addEventListener('storage', this.loadPinnedUnits);
        this.loadPinnedUnits();

        this.timedated_subscription = timedate_client.subscribe({
            path_namespace: "/org/freedesktop/timedate1",
            interface: s_bus.I_PROPS,
            member: "PropertiesChanged"
        }, updateTime);
        updateTime();
    }

    shouldComponentUpdate(nextProps, nextState) {
        if (cockpit.hidden)
            return false;

        return true;
    }

    loadPinnedUnits() {
        try {
            this.setState({ pinnedUnits: JSON.parse(localStorage.getItem('systemd:pinnedUnits')) || [] });
        } catch (err) {
            console.warn("exception while parsing systemd:pinnedUnits", err);
            this.setState({ pinnedUnits: [] });
        }
    }

    /**
      * Return a boolean value indicating if the unit specified by name @param is handled
      */
    isUnitHandled(name) {
        const suffix = name.substr(name.lastIndexOf('.') + 1);
        return service_tabs_suffixes.includes(suffix);
    }

    /* When the page is running in the background, fetch only information about failed units
     * in order to update the 'Page Status'. */
    listFailedUnits() {
        return systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnitsFiltered", [["failed"]])
                .then(([failed]) => {
                    const units = {};
                    failed.forEach(([
                        Id, Description, LoadState, ActiveState, _substate, _followUnit, ObjectPath,
                        _is_job_queued, _job_type, _job_path
                    ]) => {
                        if (!this.isUnitHandled(Id))
                            return;

                        units[ObjectPath] = { Id, Description, LoadState, ActiveState };
                    });

                    this.units = units;
                    this.processFailedUnits();
                })
                .catch(ex => console.warn('ListUnitsFiltered failed: ', ex.toString())); // not-covered: OS error
    }

    isTemplate(id) {
        const tp = id.indexOf("@");
        const sp = id.lastIndexOf(".");
        return (tp != -1 && (tp + 1 == sp || tp + 1 == id.length));
    }

    listUnits() {
        if (cockpit.hidden)
            return this.listFailedUnits();

        // Reinitialize the state variables for the units
        this.props.setIsLoading(true);

        const dbus = systemd_client[this.props.owner];
        const units = {};
        const timerPaths = [];
        const timerPromises = [];

        Promise.all([
            dbus.call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnits", null),
            dbus.call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnitFiles", null)
        ])
                .then(([[unitsResults], [unitFilesResults]]) => {
                    this.knownIds = new Set();

                    // ListUnits is the primary source of information
                    unitsResults.forEach(([
                        Id, Description, LoadState, ActiveState, _substate, _followUnit, ObjectPath,
                        _is_job_queued, _job_type, _job_path
                    ]) => {
                        if (!this.isUnitHandled(Id))
                            return;

                        // We should ignore 'not-found' units when setting the seenActiveStates
                        if (LoadState !== 'not-found')
                            this.seenActiveStates.add(ActiveState);

                        units[ObjectPath] = { Id, Description, LoadState, ActiveState };
                        this.knownIds.add(Id);
                        if (Id.endsWith(".timer")) {
                            timerPromises.push(dbus.call(ObjectPath, s_bus.I_PROPS, "GetAll",
                                                         [s_bus.I_TIMER]));
                            timerPaths.push(Id);
                        }
                    });

                    // unloaded, but available unit files
                    const unit_files = {};
                    unitFilesResults.forEach(([UnitFilePath, UnitFileState]) => {
                        const Id = UnitFilePath.split('/').pop();
                        if (!this.isUnitHandled(Id) | this.isTemplate(Id))
                            return;

                        this.seenUnitFileStates.add(UnitFileState);
                        // there is not enough information to link this to the primary unit which declared the alias
                        // name; that requires a LoadUnit() + Get("Names") + reverse lookup; the details page has the
                        // correct information, so skip the status for aliases
                        // for other units, we default to "inactive"; loaded units will override that
                        const ActiveState = (UnitFileState === "alias") ? undefined : "inactive";
                        unit_files[Id] = { Id, UnitFileState, ActiveState };
                    });

                    this.units = units;
                    this.unit_files = unit_files;
                    this.processFailedUnits();

                    return Promise.all(timerPromises);
                })
                .then((timerResults) => {
                    for (let i = 0; i < timerResults.length; i++) {
                        const [timer_props] = timerResults[i];
                        const unit = {};
                        this.addTimerProperties(timer_props, unit);
                        this.timers[timerPaths[i]] = unit;
                    }

                    this.setState({ isFullyLoaded: true });
                })
                .catch(ex => this.setState({ error: cockpit.format(_("Listing units failed: $0"), ex.toString()) })) // not-covered: OS error
                .finally(() => this.props.setIsLoading(false));
    }

    /**
      * Sort units by alphabetically - failed units go on the top of the list
      */
    compareUnits(unit_a_t, unit_b_t) {
        const unit_a = unit_a_t[1];
        const unit_b = unit_b_t[1];
        const failed_a = unit_a.HasFailed ? 1 : 0;
        const failed_b = unit_b.HasFailed ? 1 : 0;
        const pinned_a = this.state.pinnedUnits.includes(unit_a.Id) ? 1 : 0;
        const pinned_b = this.state.pinnedUnits.includes(unit_b.Id) ? 1 : 0;

        if (!unit_a || !unit_b)
            return false;

        if (failed_a != failed_b)
            return failed_b - failed_a;
        else if (pinned_a != pinned_b)
            return pinned_b - pinned_a;
        else
            return unit_a_t[0].localeCompare(unit_b_t[0]);
    }

    addTimerProperties(timer_props, unit) {
        const last_trigger_usec = timer_props.LastTriggerUSec.v;
        // systemd puts -1 into an unsigned int type for the various *USec* properties
        // JS rounds these to a float which is > MAX_UINT64, but the comparison works
        if (last_trigger_usec > 0 && last_trigger_usec < MAX_UINT64)
            unit.LastTriggerTime = timeformat.dateTime(last_trigger_usec / 1000);
        else
            unit.LastTriggerTime = _("unknown");

        const next_realtime = timer_props.NextElapseUSecRealtime?.v;
        const next_monotonic = timer_props.NextElapseUSecMonotonic?.v;
        let next_run_time = null;
        if (next_realtime > 0 && next_realtime < MAX_UINT64)
            next_run_time = next_realtime;
        else if (next_monotonic > 0 && next_monotonic < MAX_UINT64 && monotonic_timer_base !== null)
            next_run_time = next_monotonic + monotonic_timer_base;

        unit.NextRunTime = next_run_time ? timeformat.dateTime(next_run_time / 1000) : _("unknown");
    }

    /* Add some computed properties into a unit object - does not call setState */
    updateComputedProperties(unit) {
        unit.HasFailed = unit.ActiveState == "failed" || (
            unit.LoadState && unit.LoadState !== "loaded" && unit.LoadState !== "masked");

        unit.CombinedState = this.activeState[unit.ActiveState] || unit.ActiveState;
        if (unit.LoadState && unit.LoadState !== "loaded" && unit.LoadState !== "masked")
            unit.CombinedState = cockpit.format("$0 ($1)", unit.CombinedState, this.loadState[unit.LoadState]);

        unit.AutomaticStartup = this.unitFileState[unit.UnitFileState] || unit.UnitFileState;

        unit.IsPinned = this.state.pinnedUnits.includes(unit.Id);
    }

    processFailedUnits() {
        const failed = new Set();
        const tabErrors = { };

        Object.values(this.units).forEach(u => {
            if (u.ActiveState == "failed" && u.LoadState != "not-found") {
                const suffix = u.Id.substr(u.Id.lastIndexOf('.') + 1);
                if (service_tabs_suffixes.includes(suffix)) {
                    tabErrors[suffix] = true;
                    failed.add(u.Id);
                }
            }
        });
        this.props.setTabErrors(tabErrors);

        if (failed.size > 0) {
            page_status.set_own({
                type: "error",
                title: cockpit.format(cockpit.ngettext("$0 service has failed",
                                                       "$0 services have failed",
                                                       failed.size), failed.size),
                details: [...failed]
            });
        } else {
            page_status.set_own(null);
        }
    }

    // compute filtered and sorted list of [Id, unit]
    computeSelectedUnits() {
        const unitType = '.' + this.props.activeTab;
        const currentTextFilter = decodeURIComponent(this.props.options.name || '').toLowerCase();
        const filters = {
            activeState: JSON.parse(this.props.options.activestate || '[]'),
            fileState: JSON.parse(this.props.options.filestate || '[]')
        };
        const selectedUnits = [];
        const ids = new Set();

        [...Object.entries(this.units), ...Object.entries(this.unit_files)].forEach(([idx, unit]) => {
            if (!unit.Id?.endsWith(unitType))
                return;

            if (unit.LoadState === "not-found")
                return;

            // avoid showing unloaded units when there is a loaded one
            if (ids.has(unit.Id))
                return;
            ids.add(unit.Id);

            const UnitFileState = unit.UnitFileState ?? this.unit_files[unit.Id]?.UnitFileState;

            if (currentTextFilter && !((unit.Description && unit.Description.toLowerCase().includes(currentTextFilter)) ||
                unit.Id.toLowerCase().includes(currentTextFilter)))
                return;

            if (filters.fileState.length && this.unitFileState[UnitFileState] &&
                !filters.fileState.includes(this.unitFileState[UnitFileState]))
                return;

            if (filters.activeState.length && this.activeState[unit.ActiveState] &&
                !filters.activeState.includes(this.activeState[unit.ActiveState]))
                return;

            const augmentedUnit = { ...unit, UnitFileState, ...this.timers[idx] };
            this.updateComputedProperties(augmentedUnit);
            selectedUnits.push([unit.Id, augmentedUnit]);
        });

        selectedUnits.sort(this.compareUnits);
        return selectedUnits;
    }

    render() {
        if (this.state.error)
            return <EmptyStatePanel title={_("Loading of units failed")} icon={ExclamationCircleIcon} paragraph={this.state.error} />;

        /* Navigation: unit details page with a path, service list without;
         * the details page does its own loading, we don't need to wait for isFullyLoaded */
        const path = this.props.path;
        if (path.length == 1) {
            const unit_id = path[0];

            return <Service unitIsValid={unitId => this.unit_files[unitId] || this.knownIds.has(unitId) }
                            owner={this.props.owner}
                            key={unit_id}
                            unitId={unit_id}
                            dbusClient={systemd_client[this.props.owner]}
                            addTimerProperties={this.addTimerProperties}
                            pinnedUnits={this.state.pinnedUnits}
            />;
        }

        if (!this.state.isFullyLoaded)
            return <EmptyStatePanel loading title={_("Loading...")} paragraph={_("Listing units")} />;

        const fileStateDropdownOptions = [
            { value: 'enabled', label: _("Enabled") },
            { value: 'disabled', label: _("Disabled") },
            { value: 'static', label: _("Static") },
        ];
        this.seenUnitFileStates.forEach(unitFileState => {
            if (!['enabled', 'disabled', 'static'].includes(unitFileState.split('-runtime')[0])) {
                fileStateDropdownOptions.push({ value: unitFileState, label: this.unitFileState[unitFileState] });
            }
        });
        const activeStateDropdownOptions = [
            { value: 'active', label: _("Running") },
            { value: 'inactive', label: _("Not running") },
        ];
        this.seenActiveStates.forEach(activeState => {
            if (!['active', 'activating', 'inactive', 'deactivating'].includes(activeState)) {
                activeStateDropdownOptions.push({ value: activeState, label: this.activeState[activeState] });
            }
        });
        const activeTab = this.props.activeTab;

        return (
            <PageSection>
                <Card isCompact>
                    <ServicesPageFilters activeStateDropdownOptions={activeStateDropdownOptions}
                                         fileStateDropdownOptions={fileStateDropdownOptions}
                                         filtersRef={this.filtersRef}
                                         loadingUnits={this.props.isLoading}
                                         options={this.props.options}
                                         onOptionsChanged={this.onOptionsChanged}
                    />
                    <ServicesList key={cockpit.format("$0-list", activeTab)}
                                  isTimer={activeTab == 'timer'}
                                  filtersRef={this.filtersRef}
                                  units={this.computeSelectedUnits()} />
                </Card>
            </PageSection>
        );
    }
}

const ServicesPageFilters = ({
    activeStateDropdownOptions,
    fileStateDropdownOptions,
    filtersRef,
    loadingUnits,
    options,
    onOptionsChanged,
}) => {
    const { activestate, filestate, name } = options;
    const [activeStateFilterIsOpen, setActiveStateFilterIsOpen] = useState(false);
    const [currentTextFilter, setCurrentTextFilter] = useState(decodeURIComponent(name || ""));
    const [fileStateFilterIsOpen, setFileStateFilterIsOpen] = useState(false);
    const [filters, setFilters] = useState({
        activeState: JSON.parse(activestate || '[]'),
        fileState: JSON.parse(filestate || '[]'),
    });

    useEffect(() => {
        const _filters = { activeState: JSON.parse(options.activestate || '[]'), fileState: JSON.parse(options.filestate || '[]') };

        setCurrentTextFilter(decodeURIComponent(options.name || ""));
        setFilters(_filters);
    }, [options, setCurrentTextFilter, setFilters]);

    useEffect(() => {
        const _options = {};

        _options.activestate = JSON.stringify(filters.activeState);
        _options.filestate = JSON.stringify(filters.fileState);
        _options.name = encodeURIComponent(currentTextFilter);

        onOptionsChanged(_options);
    }, [filters, currentTextFilter, onOptionsChanged]);

    const onSelect = (type, event, selection) => {
        const checked = event.target.checked;

        setFilters({ ...filters, [type]: checked ? [...filters[type], selection] : filters[type].filter(value => value !== selection) });
    };

    const onActiveStateSelect = (event, selection) => {
        onSelect('activeState', event, selection);
    };

    const onFileStateSelect = (event, selection) => {
        onSelect('fileState', event, selection);
    };

    const getFilterLabelKey = (typeLabel) => {
        if (typeLabel == 'Active state')
            return 'activeState';
        else if (typeLabel == 'File state')
            return 'fileState';
    };

    const onDeleteChip = useCallback((typeLabel = '', id = '') => {
        const type = getFilterLabelKey(typeLabel);

        if (type) {
            setFilters({ ...filters, [type]: filters[type].filter(s => s !== id) });
        } else {
            setFilters({
                activeState: [],
                fileState: []
            });
        }
    }, [filters]);

    const onDeleteChipGroup = (typeLabel) => {
        const type = getFilterLabelKey(typeLabel);

        setFilters({ ...filters, [type]: [] });
    };

    const onClearAllFilters = useCallback(() => {
        setCurrentTextFilter('');
        onDeleteChip();
    }, [setCurrentTextFilter, onDeleteChip]);

    const onTextFilterChanged = textFilter => {
        setCurrentTextFilter(textFilter);
    };

    /* Make onClearAllFilters global so at to let it be used by the parent component */
    useEffect(() => {
        filtersRef.current = onClearAllFilters;
    }, [filtersRef, onClearAllFilters]);

    const toolbarItems = <>
        <ToolbarToggleGroup toggleIcon={<><span className="pf-c-button__icon pf-m-start"><FilterIcon /></span>{_("Toggle filters")}</>} breakpoint="sm"
                            variant="filter-group" alignment={{ default: 'alignLeft' }}>
            <ToolbarItem variant="search-filter">
                <SearchInput id="services-text-filter"
                             className="services-text-filter"
                             placeholder={_("Filter by name or description")}
                             value={currentTextFilter}
                             onChange={(_, val) => onTextFilterChanged(val)}
                             onClear={() => onTextFilterChanged('')} />
            </ToolbarItem>
            <ToolbarFilter chips={filters.activeState}
                           deleteChip={onDeleteChip}
                           deleteChipGroup={onDeleteChipGroup}
                           categoryName={_("Active state")}>
                <Select aria-label={_("Active state")}
                        toggleId="services-dropdown-active-state"
                        variant={SelectVariant.checkbox}
                        onToggle={setActiveStateFilterIsOpen}
                        onSelect={onActiveStateSelect}
                        selections={filters.activeState}
                        isOpen={activeStateFilterIsOpen}
                        placeholderText={_("Active state")}>
                    {activeStateDropdownOptions.map(option => <SelectOption key={option.value}
                                                                            value={option.label} />)}
                </Select>
            </ToolbarFilter>
            <ToolbarFilter chips={filters.fileState}
                           deleteChip={onDeleteChip}
                           deleteChipGroup={onDeleteChipGroup}
                           categoryName={_("File state")}>
                <Select aria-label={_("File state")}
                        toggleId="services-dropdown-file-state"
                        variant={SelectVariant.checkbox}
                        onToggle={setFileStateFilterIsOpen}
                        onSelect={onFileStateSelect}
                        selections={filters.fileState}
                        isOpen={fileStateFilterIsOpen}
                        placeholderText={_("File state")}>
                    {fileStateDropdownOptions.map(option => <SelectOption key={option.value}
                                                                          value={option.label} />)}
                </Select>
            </ToolbarFilter>
        </ToolbarToggleGroup>
    </>;

    return (
        <Toolbar data-loading={loadingUnits}
                 clearAllFilters={onClearAllFilters}
                 className="pf-m-sticky-top ct-compact services-toolbar"
                 id="services-toolbar"
                 numberOfFiltersText={n => cockpit.format("$0 filters applied")}>
            <ToolbarContent>{toolbarItems}</ToolbarContent>
        </Toolbar>
    );
};

const ServicesPage = () => {
    const [tabErrors, setTabErrors] = useState({});
    const [loggedUser, setLoggedUser] = useState();
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        cockpit.user()
                .then(user => setLoggedUser(user.name))
                .catch(ex => console.warn(ex.message));
    }, []);

    /* Listen for permission changes for "Create timer" button */
    useEvent(superuser, "changed");
    const { path, options } = usePageLocation();

    const activeTab = options.type || 'service';
    const owner = options.owner || 'system';
    const setOwner = (owner) => cockpit.location.go(cockpit.location.path, { ...cockpit.location.options, owner });

    if (owner !== 'system' && owner !== 'user') {
        console.warn("not a valid location: " + path);
        cockpit.location = '';
        return;
    }

    return (
        <WithDialogs>
            <Page>
                {path.length == 0 &&
                <PageSection variant={PageSectionVariants.light} type="nav" className="services-header">
                    <Flex>
                        <ServiceTabs activeTab={activeTab}
                                      tabErrors={tabErrors}
                                      onChange={activeTab => {
                                          cockpit.location.go(cockpit.location.path, { ...cockpit.location.options, type: activeTab });
                                      }} />
                        <FlexItem align={{ default: 'alignRight' }}>
                            {loggedUser && loggedUser !== 'root' && <ToggleGroup>
                                <ToggleGroupItem isSelected={owner == "system"}
                                                                                          buttonId="system"
                                                                                          text={_("System")}
                                                                                          onChange={() => setOwner("system")} />
                                <ToggleGroupItem isSelected={owner == "user"}
                                                                                          buttonId="user"
                                                                                          text={_("User")}
                                                                                          onChange={() => setOwner("user")} />
                            </ToggleGroup>}
                        </FlexItem>
                        {activeTab == "timer" && owner == "system" && superuser.allowed && <CreateTimerDialog isLoading={isLoading} owner={owner} />}
                    </Flex>
                </PageSection>}
                <ServicesPageBody
                    key={owner}
                    activeTab={activeTab}
                    owner={owner}
                    path={path}
                    options={options}
                    privileged={superuser.allowed}
                    setTabErrors={setTabErrors}
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                />
            </Page>
        </WithDialogs>
    );
};

function init() {
    const root = createRoot(document.getElementById('services'));
    root.render(<ServicesPage />);
}

document.addEventListener("DOMContentLoaded", init);
