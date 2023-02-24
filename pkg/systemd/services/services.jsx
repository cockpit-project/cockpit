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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
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
export let clock_realtime_now;
export let clock_monotonic_now;

export const MAX_UINT64 = 2 ** 64 - 1;

export function updateTime() {
    cockpit.spawn(["cat", "/proc/uptime"])
            .then(function(contents) {
                // first number is time since boot in seconds with two fractional digits
                const uptime = parseFloat(contents.split(' ')[0]);
                clock_monotonic_now = parseInt(uptime * 1000000, 10);
            }, ex => console.log(ex.toString()));
    cockpit.spawn(["date", "+%s"])
            .then(time => {
                clock_realtime_now = parseInt(time, 10) * 1000;
            }, ex => console.log(ex.toString()));
}

/* Notes about the systemd D-Bus API
 *
 * - One can use an object path for a unit that isn't currently
 *   loaded.  Doing so will load the unit (and emit UnitNew).
 *
 * - Calling o.fd.DBus.GetAll might thus trigger a UnitNew signal,
 *   so calling GetAll as a reaction to UnitNew might lead to
 *   infinite loops.
 *
 * - To avoid this cycle, we only call GetAll when there is some
 *   job activity for a unit, or when the whole daemon is
 *   reloaded.  The idea is that without jobs or a full reload,
 *   the state of a unit will not change in an interesting way.
 *
 * - We hope that the cache machinery in cockpit-bridge does not
 *   trigger such a cycle when watching a unit.
 *
 * - JobNew and JobRemoved signals don't include the object path
 *   of the affected units, but we can get those by listening to
 *   UnitNew.
 *
 * - There might be UnitNew signals for units that are never
 *   returned by ListUnits or ListUnitFiles.  These are units that
 *   are mentioned in Requires, After, etc or that people try to
 *   load via LoadUnit but that don't actually exist.
 *
 * - ListUnitFiles will return unit files that are aliases for
 *   other unit files, but ListUnits will not return aliases.
 *
 * - The "Names" property of a unit only includes those aliases
 *   that are currently loaded, not all.  To get all possible
 *   aliases, one needs to call ListUnitFiles and match units via
 *   their object path.
 *
 * - The unit file state of a alias as returned by ListUnitFiles
 *   is always the same as the unit file state of the primary unit
 *   file.
 *
 * - However, the unit file state as returned by ListUnitFiles is
 *   not necessarily the same as the UnitFileState property of a
 *   loaded unit.  ListUnitFiles reflects the state of the files
 *   on disk, while a loaded unit is only updated to that state
 *   via an explicit Reload.
 *
 * - Thus, we are careful to only use the UnitFileState as
 *   returned by ListUnitFiles or GetUnitFileState.  The
 *   alternative would be to only use the UnitFileState property,
 *   but we need one method call per unit to get them all for the
 *   overview, which seems excessive.
 *
 * - Methods like EnableUnitFiles only change the state of files
 *   on disk.  A Reload is necessary to update the state
 *   of loaded units.
 *
 * - A Reload will emit UnitRemoved/UnitNew signals for all units,
 *   and no PropertiesChanges signal for the properties that have
 *   changed because of the reload, such as UnitFileState.
 *
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

            unit_by_path: {},
            isFullyLoaded: false,

            error: null,
            currentStatus: null,
        };

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

        this.seenActiveStates = new Set();
        this.seenUnitFileStates = new Set();

        /* Function for manipulating with the API results and store the units in the React state */
        this.processFailedUnits = this.processFailedUnits.bind(this);
        this.listUnits = this.listUnits.bind(this);
        this.loadPinnedUnits = this.loadPinnedUnits.bind(this);
        this.onOptionsChanged = this.onOptionsChanged.bind(this);
        this.compareUnits = this.compareUnits.bind(this);
        this.addTimerProperties = this.addTimerProperties.bind(this);

        this.seenPaths = new Set();
        this.path_by_id = {};
        this.operationInProgress = {};
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
                /* If the page had only been fetched in the background we need to properly initialize the state now
                 * else just trigger an re-render since we are receiving signals while running in the background and
                 * we update the state but don't re-render
                 */
                if (!this.state.isFullyLoaded)
                    this.listUnits();
                else
                    this.setState({});
            }
        });

        const onLocationChanged = () => {
            const options = cockpit.location.options;
            this.setState({
                filters: { activeState: JSON.parse(options.activestate || '[]'), fileState: JSON.parse(options.filestate || '[]') },
                currentTextFilter: decodeURIComponent(options.name || ''),
            });
        };

        cockpit.addEventListener("locationchanged", onLocationChanged);
        onLocationChanged(); // initialize

        /* Start listening to signals for updates - when in the middle of reload mute all signals
         * - We don't need to listen to 'UnitFilesChanged' signal since every time we
         *   perform some file operation we do call Reload which issues 'Reload' signal
         * - JobNew is also useless, JobRemoved is enough since it comes in pair with JobNew
         *   but we are interested to update the state when the operation finished
         */
        systemd_client[this.props.owner].subscribe({
            interface: "org.freedesktop.DBus.Properties",
            member: "PropertiesChanged"
        }, (path, iface, signal, args) => {
            if (this.props.isLoading)
                return;

            if (this.state.unit_by_path[path] &&
                this.state.unit_by_path[path].Transient &&
                args[1].ActiveState &&
                ((args[1].ActiveState.v == 'failed' && this.state.unit_by_path[path].CollectMode == 'inactive-or-failed') ||
                  args[1].ActiveState.v == 'inactive')) {
                this.seenPaths.delete(path);
                const copy_unit_by_path = { ...this.state.unit_by_path };
                delete copy_unit_by_path[path];
                this.setState({
                    unit_by_path: copy_unit_by_path,
                });
            } else {
                this.updateProperties(args[1], path);
            }
            this.processFailedUnits();
        });

        ["JobNew", "JobRemoved"].forEach(signalName => {
            systemd_client[this.props.owner].subscribe({ interface: s_bus.I_MANAGER, member: signalName }, (path, iface, signal, args) => {
                const unit_id = args[2];
                systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "LoadUnit", [unit_id])
                        .then(([path]) => {
                            if (!this.seenPaths.has(path))
                                this.seenPaths.add(path);

                            this.getUnitByPath(path).then(this.processFailedUnits);
                        });
            });
        });

        systemd_client[this.props.owner].subscribe({ interface: s_bus.I_MANAGER, member: "Reloading" }, (path, iface, signal, args) => {
            const reloading = args[0];
            if (!reloading && !this.props.isLoading)
                this.listUnits();
        });

        addEventListener('storage', this.loadPinnedUnits);
        this.loadPinnedUnits();

        this.timedated_subscription = timedate_client.subscribe({
            path_namespace: "/org/freedesktop/timedate1",
            interface: "org.freedesktop.DBus.Properties",
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

    /* When the page is running in the background fetch only information about failed units
     * in order to update the 'Page Status'. The whole listUnits is very expensive.
     * We still need to maintain the 'unit_by_path' state object so that if we receive
     * some signal we can normally parse it and update only the affected unit state
     * instead of calling ListUnitsFiltered API call for every received signal which
     * might have changed the failed units array
     */
    listFailedUnits() {
        return systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnitsFiltered", [["failed"]])
                .then(([failed]) => {
                    failed.forEach(result => {
                        const path = result[6];
                        const unit_id = result[0];

                        if (!this.isUnitHandled(unit_id))
                            return;

                        // Ignore units which 'not-found' LoadState
                        if (result[2] == 'not-found')
                            return;

                        if (!this.seenPaths.has(path))
                            this.seenPaths.add(path);

                        this.updateProperties(
                            {
                                Id: cockpit.variant("s", unit_id),
                                Description: cockpit.variant("s", result[1]),
                                LoadState: cockpit.variant("s", result[2]),
                                ActiveState: cockpit.variant("s", result[3]),
                                SubState: cockpit.variant("s", result[4]),
                            }, path
                        );
                    });
                    this.processFailedUnits();
                }, ex => console.warn('ListUnitsFiltered failed: ', ex.toString()));
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
        this.setState({ currentStatus: _("Listing units") });
        this.props.setIsLoading(true);

        this.seenPaths = new Set();

        const promisesLoad = [];

        // Run ListUnits before LIstUnitFiles so that we avoid the extra LoadUnit calls
        // Now we call LoadUnit only for those that ListUnits didn't tell us about

        systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnits", null)
                .then(([results]) => {
                    results.forEach(result => {
                        const path = result[6];
                        const unit_id = result[0];
                        const load_state = result[2];
                        const active_state = result[3];

                        if (!this.isUnitHandled(unit_id))
                            return;

                        if (!this.seenPaths.has(path))
                            this.seenPaths.add(path);

                        // We should ignore 'not-found' units when setting the seenActiveStates
                        if (load_state !== 'not-found')
                            this.seenActiveStates.add(active_state);

                        this.updateProperties(
                            {
                                Id: cockpit.variant("s", unit_id),
                                Description: cockpit.variant("s", result[1]),
                                LoadState: cockpit.variant("s", load_state),
                                ActiveState: cockpit.variant("s", active_state),
                                SubState: cockpit.variant("s", result[4]),
                            }, path
                        );
                    });

                    this.setState({ currentStatus: _("Listing unit files") });
                    systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "ListUnitFiles", null)
                            .then(([results]) => {
                                results.forEach(result => {
                                    const unit_path = result[0];
                                    const unit_id = unit_path.split('/').pop();
                                    const unitFileState = result[1];

                                    if (!this.isUnitHandled(unit_id))
                                        return;

                                    if (this.isTemplate(unit_id))
                                        return;

                                    this.seenUnitFileStates.add(unitFileState);

                                    if (this.seenPaths.has(this.path_by_id[unit_id])) {
                                        this.updateProperties(
                                            {
                                                Id: cockpit.variant("s", unit_id),
                                                UnitFileState: cockpit.variant("s", unitFileState)
                                            }, this.path_by_id[unit_id], true);
                                        return;
                                    }

                                    promisesLoad.push(systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "LoadUnit", [unit_id]).then(([unit_path]) => {
                                        this.updateProperties(
                                            {
                                                Id: cockpit.variant("s", unit_id),
                                                UnitFileState: cockpit.variant("s", unitFileState)
                                            }, unit_path, true);

                                        this.seenPaths.add(unit_path);

                                        return this.getUnitByPath(unit_path);
                                    }, ex => {
                                        this.props.setIsLoading(false);
                                        this.setState({ error: cockpit.format(_("Loading unit failed: $0"), ex.toString()) });
                                    }));
                                });

                                Promise.all(promisesLoad)
                                        .finally(() => {
                                            // Remove units from state that are not listed from the API in this iteration
                                            const unit_by_path = Object.assign({}, this.state.unit_by_path);
                                            let hasExtraEntries = false;
                                            const newState = {};

                                            for (const unitPath in this.state.unit_by_path) {
                                                if (!this.seenPaths.has(unitPath)) {
                                                    hasExtraEntries = true;
                                                    delete unit_by_path[unitPath];
                                                    Object.keys(this.path_by_id).forEach(id => {
                                                        if (this.path_by_id[id] == unitPath)
                                                            delete this.path_by_id[id];
                                                    });
                                                }
                                            }
                                            if (hasExtraEntries)
                                                newState.unit_by_path = unit_by_path;

                                            newState.isFullyLoaded = true;
                                            this.props.setIsLoading(false);

                                            this.setState(newState);
                                            this.processFailedUnits();
                                        });
                            }, ex => {
                                this.props.SetIsLoading(false);
                                this.setState({ error: cockpit.format(_("Listing unit files failed: $0"), ex.toString()) });
                            });
                }, ex => {
                    this.props.setIsLoading(false);
                    this.setState({ error: cockpit.format(_("Listing units failed: $0"), ex.toString()) });
                });
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

    addSocketProperties(socket_unit, path, unit) {
        let needsUpdate = false;

        if (JSON.stringify(socket_unit.Listen) !== JSON.stringify(unit.Listen)) {
            unit.Listen = socket_unit.Listen;
            needsUpdate = true;
        }

        if (needsUpdate) {
            this.setState(prevState => ({
                unit_by_path: {
                    ...prevState.unit_by_path,
                    [unit.path]: unit,
                }
            }));
        }
    }

    addTimerProperties(timer_unit, unit) {
        let needsUpdate = false;

        const lastTriggerTime = timeformat.dateTime(timer_unit.LastTriggerUSec / 1000);
        if (lastTriggerTime !== unit.LastTriggerTime) {
            unit.LastTriggerTime = lastTriggerTime;
            needsUpdate = true;
        }
        const system_boot_time = clock_realtime_now * 1000 - clock_monotonic_now;
        if (timer_unit.LastTriggerUSec === -1 || timer_unit.LastTriggerUSec === 0) {
            if (unit.LastTriggerTime !== _("unknown")) {
                unit.LastTriggerTime = _("unknown");
                needsUpdate = true;
            }
        }
        let next_run_time = 0;

        // systemd puts -1 into an unsigned int type for the various *USec* properties
        // JS rounds these to a float which is > MAX_UINT64, but the comparison works
        if (timer_unit.NextElapseUSecRealtime > 0 && timer_unit.NextElapseUSecRealtime < MAX_UINT64) {
            next_run_time = timer_unit.NextElapseUSecRealtime;
        } else if (timer_unit.NextElapseUSecMonotonic > 0 && timer_unit.NextElapseUSecMonotonic < MAX_UINT64) {
            next_run_time = timer_unit.NextElapseUSecMonotonic + system_boot_time;
        }

        const nextRunTime = timeformat.dateTime(next_run_time / 1000);
        if (nextRunTime !== unit.NextRunTime) {
            unit.NextRunTime = nextRunTime;
            needsUpdate = true;
        }

        if (next_run_time === 0 && unit.NextRunTime !== _("unknown")) {
            unit.NextRunTime = _("unknown");
            needsUpdate = true;
        }

        return needsUpdate;
    }

    /* Add some computed properties into a unit object - does not call setState */
    updateComputedProperties(unit) {
        unit.HasFailed = (unit.ActiveState == "failed" || (unit.LoadState !== "loaded" && unit.LoadState != "masked"));

        unit.CombinedState = this.activeState[unit.ActiveState] || unit.ActiveState;
        if (unit.LoadState !== "loaded" && unit.LoadState != "masked")
            unit.CombinedState = cockpit.format("$0 ($1)", unit.CombinedState, this.loadState[unit.LoadState]);

        unit.AutomaticStartup = this.unitFileState[unit.UnitFileState] || unit.UnitFileState;
    }

    updateProperties(props, path, updateFileState = false) {
        // We received a request to update properties on a unit we are not yet aware off
        if (!this.state.unit_by_path[path] && !props.Id)
            return;

        if (props.Id && props.Id.v)
            this.path_by_id[props.Id.v] = path;

        let shouldUpdate = false;
        const unitNew = Object.assign({}, this.state.unit_by_path[path]);
        const prop = p => {
            if (props[p]) {
                if (Array.isArray(props[p].v) && Array.isArray(unitNew[p]) && JSON.stringify(props[p].v.sort()) == JSON.stringify(unitNew[p].sort()))
                    return;
                else if (!Array.isArray(props[p].v) && props[p].v == unitNew[p])
                    return;
                else if (p == "UnitFileState" && !updateFileState)
                    return;
                shouldUpdate = true;
                unitNew[p] = props[p].v;
            }
        };

        prop("Id");
        prop("Description");
        prop("Names");
        prop("LoadState");
        prop("LoadError");
        prop("Transient");
        prop("CollectMode");
        prop("ActiveState");
        prop("SubState");
        if (updateFileState)
            prop("UnitFileState");
        prop("FragmentPath");
        unitNew.path = path;

        prop("Requires");
        prop("Requisite");
        prop("Wants");
        prop("BindsTo");
        prop("PartOf");
        prop("RequiredBy");
        prop("RequisiteOf");
        prop("WantedBy");
        prop("BoundBy");
        prop("ConsistsOf");
        prop("Conflicts");
        prop("ConflictedBy");
        prop("Before");
        prop("After");
        prop("OnFailure");
        prop("Triggers");
        prop("TriggeredBy");
        prop("PropagatesReloadTo");
        prop("PropagatesReloadFrom");
        prop("JoinsNamespaceOf");
        prop("Conditions");
        prop("CanReload");

        prop("ActiveEnterTimestamp");

        this.updateComputedProperties(unitNew);

        if (unitNew.Id.endsWith("socket")) {
            unitNew.is_socket = true;
            if (unitNew.ActiveState == "active") {
                const socket_unit = systemd_client[this.props.owner].proxy(s_bus.I_SOCKET, unitNew.path);
                socket_unit.wait(() => {
                    if (socket_unit.valid)
                        this.addSocketProperties(socket_unit, path, unitNew);
                });
            }
        }

        if (unitNew.Id.endsWith("timer")) {
            if (unitNew.ActiveState == "active") {
                const timer_unit = systemd_client[this.props.owner].proxy(s_bus.I_TIMER, unitNew.path);
                timer_unit.wait(() => {
                    if (timer_unit.valid)
                        if (this.addTimerProperties(timer_unit, unitNew)) {
                            this.setState(prevState => ({
                                unit_by_path: {
                                    ...prevState.unit_by_path,
                                    [path]: unitNew,
                                }
                            }));
                        }
                });
            }
        }

        if (!shouldUpdate)
            return;

        this.setState(prevState => ({
            unit_by_path: {
                ...prevState.unit_by_path,
                [path]: unitNew,
            }
        }));
    }

    /**
      * Fetches all Properties for the unit specified by path @param and add the unit to the state
      */
    getUnitByPath(path) {
        return systemd_client[this.props.owner].call(path,
                                                     "org.freedesktop.DBus.Properties", "GetAll",
                                                     ["org.freedesktop.systemd1.Unit"])
                .then(result => this.updateProperties(result[0], path))
                .catch(error => console.warn('GetAll failed for', path, error.toString()));
    }

    processFailedUnits() {
        const failed = new Set();
        const tabErrors = { };

        for (const p in this.state.unit_by_path) {
            const u = this.state.unit_by_path[p];
            if (u.ActiveState == "failed" && u.LoadState != "not-found") {
                const suffix = u.Id.substr(u.Id.lastIndexOf('.') + 1);
                if (service_tabs_suffixes.includes(suffix)) {
                    tabErrors[suffix] = true;
                    failed.add(u.Id);
                }
            }
        }
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

    render() {
        const { unit_by_path } = this.state;
        const path = this.props.path;

        if (this.state.error)
            return <EmptyStatePanel title={_("Loading of units failed")} icon={ExclamationCircleIcon} paragraph={this.state.error} />;
        if (!this.state.isFullyLoaded)
            return <EmptyStatePanel loading title={_("Loading...")} paragraph={this.state.currentStatus} />;

        /* Perform navigation */
        if (path.length == 1) {
            const unit_id = path[0];
            const get_unit_path = (unit_id) => this.path_by_id[unit_id];
            const unit_path = get_unit_path(unit_id);
            const unit = this.state.unit_by_path[unit_path];

            if (unit_path === undefined || unit === undefined || unit.LoadState === 'not-found') {
                const path = "/system/services" + (this.props.owner === "user" ? "#/?owner=user" : "");
                return <EmptyStatePanel
                            icon={ExclamationCircleIcon}
                            title={_("Unit not found")}
                            paragraph={
                                <Button variant="link"
                                        component="a"
                                        onClick={() => cockpit.jump(path, cockpit.transport.host)}>
                                    {_("View all services")}
                                </Button>
                            }
                />;
            }

            return <Service unitIsValid={unitId => { const path = get_unit_path(unitId); return path !== undefined && this.state.unit_by_path[path].LoadState != 'not-found' }}
                            owner={this.props.owner}
                            key={unit_id}
                            unitId={unit_id}
                            dbusClient={systemd_client[this.props.owner]}
                            addTimerProperties={this.addTimerProperties}
                            pinnedUnits={this.state.pinnedUnits}
            />;
        }

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
        const { currentTextFilter, filters } = this.state;
        const activeTab = this.props.activeTab;

        const units = Object.keys(this.path_by_id)
                .filter(unit_id => {
                    const unit = this.path_by_id[unit_id] ? unit_by_path[this.path_by_id[unit_id]] : undefined;

                    if (!unit)
                        return false;

                    if (!(unit.Id && activeTab && unit.Id.match(cockpit.format(".$0$", activeTab))))
                        return false;

                    if (unit.LoadState == "not-found")
                        return false;

                    if (currentTextFilter && !((unit.Description && unit.Description.toLowerCase().indexOf(currentTextFilter.toLowerCase()) != -1) ||
                        unit_id.toLowerCase().indexOf(currentTextFilter.toLowerCase()) != -1))
                        return false;

                    if (filters.fileState.length && this.unitFileState[unit.UnitFileState] &&
                        !filters.fileState.includes(this.unitFileState[unit.UnitFileState]))
                        return false;

                    if (filters.activeState.length && this.activeState[unit.ActiveState] &&
                        !filters.activeState.includes(this.activeState[unit.ActiveState]))
                        return false;

                    unit.IsPinned = this.state.pinnedUnits.includes(unit.Id);
                    return true;
                })
                .map(unit_id => [unit_id, unit_by_path[this.path_by_id[unit_id]]])
                .sort(this.compareUnits);

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
                                  units={units} />
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
