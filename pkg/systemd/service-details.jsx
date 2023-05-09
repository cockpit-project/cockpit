/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React, { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Dropdown, DropdownItem, DropdownSeparator, KebabToggle } from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Card, CardHeader, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import {
    AsleepIcon,
    BanIcon, ErrorCircleOIcon, OnRunningIcon, OffIcon,
    ExclamationCircleIcon,
    OkIcon, UserIcon, ThumbtackIcon,
} from "@patternfly/react-icons";

import cockpit from "cockpit";
import s_bus from "./busnames.js";
import { systemd_client, MAX_UINT64 } from "./services.jsx";
import * as timeformat from "timeformat";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { useDialogs, DialogsContext } from "dialogs.jsx";
import { ModalError } from 'cockpit-components-inline-notification.jsx';

import './service-details.scss';

const _ = cockpit.gettext;
const METRICS_POLL_DELAY = 30000; // 30s

/*
 * React template for showing basic dialog for confirming action
 * Required props:
 *  - title
 *     Title of the dialog
 *  - message
 *     Message in the dialog
 *  - close
 *     Action to be executed when Cancel button is selected.
 * Optional props:
 *  - confirmText
 *     Text of the button for confirming the action
 *  - confirmAction
 *     Action to be executed when the action is confirmed
 */
const ServiceConfirmDialog = ({ id, title, message, confirmText, confirmAction }) => {
    const Dialogs = useDialogs();
    return (
        <Modal id={id} isOpen
               position="top" variant="medium"
               onClose={Dialogs.close}
               title={title}
               footer={
                   <>
                       { confirmText && confirmAction &&
                       <Button variant='danger' onClick={confirmAction}>
                           {confirmText}
                       </Button>
                       }
                       <Button variant='link' className='btn-cancel' onClick={Dialogs.close}>
                           { _("Cancel") }
                       </Button>
                   </>
               }>
            {message}
        </Modal>
    );
};

/*
 * React template for showing possible service action (in a kebab menu)
 * Required props:
 *  - masked
 *      Unit is masked
 *  - active
 *      Unit is active (running)
 *  - failed
 *      Unit has failed
 *  - isPinned
 *      Unit is pinned
 *  - canReload
 *      Unit can be reloaded
 *  - actionCallback
 *      Method for calling unit methods like `UnitStart`
 *  - fileActionCallback
 *      Method for calling unit file methods like `EnableUnitFiles`
 *  - deleteActionCallback
 *      Method for calling deleting the systemd unit
 *  - pinUnitCallback
 *      Method to pin unit
 *  - disabled
 *      Button is disabled
 */
const ServiceActions = ({ masked, active, failed, canReload, actionCallback, deleteActionCallback, fileActionCallback, disabled, isPinned, pinUnitCallback }) => {
    const Dialogs = useDialogs();
    const [isActionOpen, setIsActionOpen] = useState(false);

    const actions = [];

    // If masked, only show unmasking and nothing else
    if (masked) {
        actions.push(
            <DropdownItem key="unmask" onClick={() => fileActionCallback("UnmaskUnitFiles", undefined)}>{ _("Allow running (unmask)") }</DropdownItem>
        );
    } else { // All cases when not masked
        if (active) {
            if (canReload) {
                actions.push(
                    <DropdownItem key="reload" onClick={() => actionCallback("ReloadUnit")}>{ _("Reload") }</DropdownItem>
                );
            }
            actions.push(
                <DropdownItem key="restart" onClick={() => actionCallback("RestartUnit")}>{ _("Restart") }</DropdownItem>
            );
            actions.push(
                <DropdownItem key="stop" onClick={() => actionCallback("StopUnit")}>{ _("Stop") }</DropdownItem>,
            );
        } else {
            actions.push(
                <DropdownItem key="start" onClick={() => actionCallback("StartUnit")}>{ _("Start") }</DropdownItem>
            );
        }

        if (deleteActionCallback) {
            actions.push(<DropdownSeparator key="delete-divider" />);
            actions.push(
                <DropdownItem key="delete" className="pf-m-danger" onClick={() => deleteActionCallback()}>{ _("Delete") }</DropdownItem>
            );
        }

        if (actions.length > 0) {
            actions.push(
                <DropdownSeparator key="divider" />
            );
        }

        if (failed)
            actions.push(
                <DropdownItem key="reset" onClick={() => actionCallback("ResetFailedUnit", []) }>{ _("Clear 'Failed to start'") }</DropdownItem>
            );

        const confirm = () => {
            Dialogs.show(<ServiceConfirmDialog id="mask-service"
                                               title={ _("Mask service") }
                                               message={ _("Masking service prevents all dependent units from running. This can have bigger impact than anticipated. Please confirm that you want to mask this unit.")}
                                               confirmText={ _("Mask service") }
                                               confirmAction={() => {
                                                   fileActionCallback("MaskUnitFiles", false);
                                                   if (failed)
                                                       actionCallback("ResetFailedUnit", []);
                                                   Dialogs.close();
                                               }} />);
        };

        actions.push(
            <DropdownItem key="mask" onClick={confirm}>{ _("Disallow running (mask)") }</DropdownItem>
        );

        actions.push(<DropdownSeparator key="pin-divider" />);
        actions.push(
            <DropdownItem key="pin" onClick={() => pinUnitCallback() }>{isPinned ? _("Unpin unit") : _("Pin unit")}</DropdownItem>
        );
    }

    return (
        <Dropdown id="service-actions" title={ _("Additional actions") }
                  toggle={<KebabToggle isDisabled={disabled}
                                       onToggle={(_, isOpen) => setIsActionOpen(isOpen)} />}
                  isOpen={isActionOpen}
                  isPlain
                  onSelect={() => setIsActionOpen(!isActionOpen)}
                  position='right'
                  dropdownItems={actions} />
    );
};

/*
 * React template for a service details
 * Shows current status and information about the service.
 * Enables user to control this unit like starting, enabling, etc. the service.
 * Required props:
 *  -  unit
 *      as returned from systemd org.freedesktop.systemd1.{Unit,Socket}
 *      D-Bus interface, but with unwrapped variants, and with additional "path"
 *      property and addTimerProperties()
 *  -  permitted
 *      True if user can control this unit
 *  -  systemdManager
 *      Callback for displaying errors
 *  -  isValid
 *      Method for finding if unit is valid
 */
export class ServiceDetails extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);

        this.state = {
            waitsAction: false,
            waitsFileAction: false,
            unit_properties: {},
            showDeleteDialog: false,
            unitPaths: [],
            isPinned: this.props.pinnedUnits.includes(this.props.unit.Id),
        };

        this.onOnOffSwitch = this.onOnOffSwitch.bind(this);
        this.unitAction = this.unitAction.bind(this);
        this.unitFileAction = this.unitFileAction.bind(this);
        this.deleteAction = this.deleteAction.bind(this);
        this.deleteTimer = this.deleteTimer.bind(this);
        this.pinUnit = this.pinUnit.bind(this);

        this.unitType = props.unit.Id.split('.').slice(-1)[0];
        this.unitTypeCapitalized = this.unitType.charAt(0).toUpperCase() + this.unitType.slice(1);
        this.doMemoryCurrentPolling = this.doMemoryCurrentPolling.bind(this);

        // MemoryCurrent property does not emit a changed signal - do polling for this property
        if (props.unit.ActiveState == "active") {
            this.doMemoryCurrentPolling();
            this.interval = setInterval(this.doMemoryCurrentPolling, METRICS_POLL_DELAY);
        }
    }

    componentDidUpdate(prevProps) {
        // If unit became active start property polling and if got inactive stop
        if (this.props.unit.ActiveState === 'active' && !this.interval) {
            this.doMemoryCurrentPolling();
            this.interval = setInterval(this.doMemoryCurrentPolling, METRICS_POLL_DELAY);
        }
        if (this.props.unit.ActiveState === 'inactive' && this.interval) {
            this.doMemoryCurrentPolling();
            clearInterval(this.interval);
        }
    }

    componentWillUnmount() {
        if (this.interval)
            clearInterval(this.interval);
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        return {
            waitsAction: nextProps.loadingUnits,
            waitsFileAction: nextProps.loadingUnits,
        };
    }

    show_note(note) {
        const Dialogs = this.context;
        Dialogs.show(<ServiceConfirmDialog title={_("Note")} message={note} />);
    }

    show_error(error) {
        const Dialogs = this.context;
        Dialogs.show(<ServiceConfirmDialog title={_("Error")} message={error} />);
    }

    doMemoryCurrentPolling() {
        systemd_client[this.props.owner].call(this.props.unit.path,
                                              "org.freedesktop.DBus.Properties", "Get",
                                              ["org.freedesktop.systemd1." + this.unitTypeCapitalized, 'MemoryCurrent'])
                .then(result => {
                    this.addUnitProperties(
                        "MemoryCurrent",
                        result[0] && result[0].v > 0 && result[0].v < MAX_UINT64 ? result[0].v : null,
                    );
                }, ex => console.log(ex.message));
    }

    addUnitProperties(prop, value) {
        if (prop == "MemoryCurrent" && this.state.unit_properties.MemoryCurrent !== value)
            this.setState({ unit_properties: Object.assign(this.state.unit_properties, { [prop]: value }) });
    }

    onOnOffSwitch() {
        if (this.props.unit.UnitFileState === "enabled") {
            let promise;
            if (this.props.unit.ActiveState === "active" || this.props.unit.ActiveState === "activating")
                promise = this.unitAction("StopUnit");
            else if (this.props.unit.ActiveState === "failed")
                promise = this.unitAction("ResetFailedUnit", []);
            else
                promise = Promise.resolve();

            promise.then(() => this.unitFileAction("DisableUnitFiles", undefined));
        } else {
            this.unitFileAction("EnableUnitFiles", false)
                    .then(() => {
                        if (this.props.unit.ActiveState !== "active" && this.props.unit.ActiveState !== "activating")
                            this.unitAction("StartUnit");
                    });
        }
    }

    unitAction(method, extra_args, catchExc = true) {
        if (extra_args === undefined)
            extra_args = ["fail"];
        this.setState({ waitsAction: true });
        const promise = systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, method, [this.props.unit.Names[0]].concat(extra_args));
        if (catchExc) {
            return promise.catch(error => {
                this.show_error(error.toString());
                this.setState({ waitsAction: false });
            });
        } else {
            return promise;
        }
    }

    pinUnit() {
        const newPinned = this.state.isPinned
            ? this.props.pinnedUnits.filter(unitId => unitId != this.props.unit.Id)
            : [...this.props.pinnedUnits, this.props.unit.Id];

        localStorage.setItem('systemd:pinnedUnits', JSON.stringify(newPinned));
        this.setState(prevState => ({ isPinned: !prevState.isPinned }));
        dispatchEvent(new Event('storage'));
    }

    unitFileAction(method, force, catchExc = true) {
        this.setState({ waitsFileAction: true });
        const args = [[this.props.unit.Names[0]], false];
        if (force !== undefined)
            args.push(force == "true");
        const promise = systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, method, args)
                .then(([results]) => {
                    if (results.length == 2 && !results[0])
                        this.show_note(_("This unit is not designed to be enabled explicitly."));
                    /* Executing daemon reload after file operations is necessary -
                     * see https://github.com/systemd/systemd/blob/main/src/systemctl/systemctl.c [enable_unit function]
                     */
                    return systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "Reload", null);
                });
        if (catchExc) {
            return promise.catch(error => {
                this.show_error(error.toString());
                this.setState({ waitsFileAction: false });
            });
        } else {
            return promise;
        }
    }

    deleteAction() {
        this.getUnitPaths().then(unitPaths => {
            this.setState({ showDeleteDialog: true, unitPaths });
        });
    }

    async getUnitPaths() {
        const paths = [this.props.unit.FragmentPath];

        await Promise.all(this.props.unit.Triggers.map(async trigger => {
            // Getting dbus properties from a non-loaded unit is not possible so resort to systemctl show
            const unitPath = await cockpit.spawn(["systemctl", "show", "--value",
                "--property", "FragmentPath", trigger]);
            paths.push(unitPath.trim());
        })).catch(err => console.error("failed to look up unit details:", err.toString()));

        return paths;
    }

    deleteTimer() {
        // Stop timer so we don't get race conditions when the unit is gone.
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        const promises = [];
        if (this.props.unit.ActiveState === "active" || this.props.unit.ActiveState === "activating")
            promises.push(this.unitAction("StopUnit", undefined, false));
        if (this.props.unit.ActiveState === "failed")
            promises.push(this.unitAction("ResetFailedUnit", undefined, false));
        if (this.props.unit.UnitFileState === "enabled")
            promises.push(this.unitFileAction("DisableUnitFiles", undefined, false));

        return Promise.all(promises).then(() => {
            const deletions = this.state.unitPaths.filter(path => path.startsWith("/etc/systemd/system"))
                    .map(path => cockpit.file(path, { superuser: "required" }).replace(null));

            // Reload after unit/timer removal
            return Promise.all(deletions).then(() =>
                systemd_client[this.props.owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "Reload", null)
                        .then(() => cockpit.jump("/system/services#/?type=timer"))
            );
        });
    }

    render() {
        const active = this.props.unit.ActiveState === "active" || this.props.unit.ActiveState === "activating";
        const enabled = this.props.unit.UnitFileState === "enabled";
        const isStatic = this.props.unit.UnitFileState !== "disabled" && !enabled;
        const failed = this.props.unit.ActiveState === "failed";
        const masked = this.props.unit.LoadState === "masked";
        const unit = this.state.unit_properties;
        const showAction = this.props.permitted || this.props.owner == "user";
        const isCustom = this.props.unit.FragmentPath.startsWith("/etc/systemd/system") && !masked;
        const isTimer = (this.unitType === "timer");

        let status = [];

        if (masked) {
            status.push(
                <div key="masked" className="status-masked">
                    <BanIcon className="status-icon" />
                    <span className="status">{ _("Masked") }</span>
                    <span className="side-note font-xs">{ _("Forbidden from running") }</span>
                </div>
            );
        }

        if (!enabled && !active && !masked && !isStatic) {
            status.push(
                <div key="disabled" className="status-disabled">
                    <OffIcon className="status-icon" />
                    <span className="status">{ _("Disabled") }</span>
                </div>
            );
        }

        if (failed) {
            status.push(
                <div key="failed" className="status-failed">
                    <ErrorCircleOIcon className="status-icon" />
                    <span className="status">{ _("Failed to start") }</span>
                    { showAction &&
                    <Button variant="secondary" className="action-button" onClick={() => this.unitAction("StartUnit") }>{ _("Start service") }</Button>
                    }
                </div>
            );
        }

        if (!status.length) {
            if (active) {
                status.push(
                    <div key="running" className="status-running">
                        <OnRunningIcon className="status-icon" />
                        <span className="status">{ _("Running") }</span>
                        <span className="side-note font-xs">{ _("Active since ") + timeformat.dateTime(this.props.unit.ActiveEnterTimestamp / 1000) }</span>
                    </div>
                );
            } else {
                status.push(
                    <div key="stopped" className="status-stopped">
                        <OffIcon className="status-icon" />
                        <span className="status">{ _("Not running") }</span>
                    </div>
                );
            }
        }

        if (isStatic && !masked) {
            status.unshift(
                <div key="static" className="status-static">
                    <AsleepIcon className="status-icon" />
                    <span className="status">{ _("Static") }</span>
                    { this.props.unit.WantedBy && this.props.unit.WantedBy.length > 0 &&
                        <>
                            <span className="side-note font-xs">{ _("Required by ") }</span>
                            <ul className="comma-list">
                                {this.props.unit.WantedBy.map(unit => <li className="font-xs" key={unit}><a href={"#/" + unit}>{unit}</a></li>)}
                            </ul>
                        </>
                    }
                </div>
            );
        }

        if (!showAction && this.props.owner !== 'user') {
            status.unshift(
                <div key="readonly" className="status-readonly">
                    <UserIcon className="status-icon" />
                    <span className="status">{ _("Read-only") }</span>
                    <span className="side-note font-xs">{ _("Requires administration access to edit") }</span>
                </div>
            );
        }

        if (enabled) {
            status.push(
                <div key="enabled" className="status-enabled">
                    <OkIcon className="status-icon" />
                    <span className="status">{ _("Automatically starts") }</span>
                </div>
            );
        }

        if (this.props.unit.NextRunTime || this.props.unit.LastTriggerTime) {
            status.push(
                <div className="service-unit-triggers" key="triggers">
                    {this.props.unit.NextRunTime && <div className="service-unit-next-trigger">{cockpit.format("Next run: $0", this.props.unit.NextRunTime)}</div>}
                    {this.props.unit.LastTriggerTime && <div className="service-unit-last-trigger">{cockpit.format("Last trigger: $0", this.props.unit.LastTriggerTime)}</div>}
                </div>
            );
        }

        /* If there is some ongoing action just show spinner */
        if (this.state.waitsAction || this.state.waitsFileAction) {
            status = [
                <div key="updating" className="status-updating">
                    <Spinner size="md" className="status-icon" />
                    <span className="status">{ _("Updating status...") }</span>
                </div>
            ];
        }

        const tooltipMessage = enabled ? _("Stop and disable") : _("Start and enable");
        const hasLoadError = this.props.unit.LoadState !== "loaded" && this.props.unit.LoadState !== "masked";

        if (hasLoadError) {
            const path = "/system/services" + (this.props.owner === "user" ? "#/?owner=user" : ""); // not-covered: OS error
            const loadError = this.props.unit.LoadError ? this.props.unit.LoadError[1] : null; // not-covered: OS error
            const title = loadError || _("Failed to load unit"); // not-covered: OS error

            return <EmptyStatePanel
                icon={ExclamationCircleIcon}
                title={title}
                paragraph={this.props.unitId}
                action={
                    <Button variant="link"
                            component="a"
                            onClick={() => cockpit.jump(path, cockpit.transport.host)}>
                        {_("View all services")}
                    </Button>
                }
            />;
        }

        // These are relevant for socket and timer activated services
        const triggerRelationships = [
            { Name: _("Triggers"), Units: this.props.unit.Triggers },
            { Name: _("Triggered by"), Units: this.props.unit.TriggeredBy },
        ];

        const relationships = [
            { Name: _("Requires"), Units: this.props.unit.Requires },
            { Name: _("Requisite"), Units: this.props.unit.Requisite },
            { Name: _("Wants"), Units: this.props.unit.Wants },
            { Name: _("Binds to"), Units: this.props.unit.BindsTo },
            { Name: _("Part of"), Units: this.props.unit.PartOf },
            { Name: _("Required by"), Units: this.props.unit.RequiredBy },
            { Name: _("Requisite of"), Units: this.props.unit.RequisiteOf },
            { Name: _("Wanted by"), Units: this.props.unit.WantedBy },
            { Name: _("Bound by"), Units: this.props.unit.BoundBy },
            { Name: _("Consists of"), Units: this.props.unit.ConsistsOf },
            { Name: _("Conflicts"), Units: this.props.unit.Conflicts },
            { Name: _("Conflicted by"), Units: this.props.unit.ConflictedBy },
            { Name: _("Before"), Units: this.props.unit.Before },
            { Name: _("After"), Units: this.props.unit.After },
            { Name: _("On failure"), Units: this.props.unit.OnFailure },
            { Name: _("Propagates reload to"), Units: this.props.unit.PropagatesReloadTo },
            { Name: _("Reload propagated from"), Units: this.props.unit.ReloadPropagatedFrom },
            { Name: _("Joins namespace of"), Units: this.props.unit.JoinsNamespaceOf }
        ];

        const relationshipsToList = rels => {
            return rels.filter(rel => rel.Units && rel.Units.length > 0)
                    .map(rel =>
                        <DescriptionListGroup key={rel.Name}>
                            <DescriptionListTerm>{rel.Name}</DescriptionListTerm>
                            <DescriptionListDescription id={rel.Name.split(" ").join("")}>
                                <ul className="comma-list">
                                    {rel.Units.map(unit => <li key={unit}><Button isInline variant="link" component="a" href={"#/" + unit + (this.props.owner === "user" ? "?owner=user" : "")} isDisabled={!this.props.isValid(unit)}>{unit}</Button></li>)}
                                </ul>
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                    );
        };

        const triggerRelationshipsList = relationshipsToList(triggerRelationships);

        const extraRelationshipsList = relationshipsToList(relationships);

        const conditions = this.props.unit.Conditions;
        const notMetConditions = [];
        if (conditions)
            conditions.forEach(condition => {
                if (condition[4] < 0)
                    notMetConditions.push(cockpit.format(_("Condition $0=$1 was not met"), condition[0], condition[3]));
            });

        return (
            <Card id="service-details-unit" className="ct-card">
                { this.state.showDeleteDialog &&
                <DeleteModal
                    name={this.props.unit.Description}
                    handleCancel={() => this.setState({ showDeleteDialog: false })}
                    handleDelete={this.deleteTimer}
                    reason={<Flex flex={{ default: 'column' }}>
                        <p>{_("Deletion will remove the following files:")}</p>
                        <List>
                            {this.state.unitPaths.map(item => <ListItem key={item}>{item}</ListItem>)}
                        </List>
                    </Flex>
                    }
                />
                }
                <CardHeader>
                    <Flex className="service-top-panel" spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                        <CardTitle component="h2" className="service-name">{this.props.unit.Description}</CardTitle>
                        {this.state.isPinned &&
                        <Tooltip content={_("Pinned unit")}>
                            <ThumbtackIcon className='service-thumbtack-icon' />
                        </Tooltip>}
                        { showAction &&
                            <>
                                { !masked && !isStatic &&
                                    <Tooltip id="switch-unit-state" content={tooltipMessage} position={TooltipPosition.right}>
                                        <Switch isChecked={enabled}
                                                aria-label={tooltipMessage}
                                                isDisabled={this.state.waitsAction || this.state.waitsFileAction}
                                                onChange={this.onOnOffSwitch} />
                                    </Tooltip>
                                }
                                <ServiceActions { ...{ active, failed, enabled, masked } } canReload={this.props.unit.CanReload}
                                                actionCallback={this.unitAction} fileActionCallback={this.unitFileAction}
                                                deleteActionCallback={isCustom && isTimer ? this.deleteAction : null}
                                                disabled={this.state.waitsAction || this.state.waitsFileAction}
                                                isPinned={this.state.isPinned} pinUnitCallback={this.pinUnit} />
                            </>
                        }
                    </Flex>
                </CardHeader>
                <CardBody>
                    <Stack hasGutter>
                        <DescriptionList isHorizontal>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Status") }</DescriptionListTerm>
                                <DescriptionListDescription id="statuses">
                                    { status }
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Path") }</DescriptionListTerm>
                                <DescriptionListDescription id="path">{this.props.unit.FragmentPath}</DescriptionListDescription>
                            </DescriptionListGroup>
                            {unit.MemoryCurrent
                                ? <DescriptionListGroup>
                                    <DescriptionListTerm>{ _("Memory") }</DescriptionListTerm>
                                    <DescriptionListDescription id="memory">{cockpit.format_bytes(unit.MemoryCurrent)}</DescriptionListDescription>
                                </DescriptionListGroup>
                                : null}
                            {this.props.unit.Listen && this.props.unit.Listen.length && <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Listen") }</DescriptionListTerm>
                                <DescriptionListDescription id="listen">
                                    {cockpit.format("$0 ($1)", this.props.unit.Listen[0][1], this.props.unit.Listen[0][0])}
                                </DescriptionListDescription>
                            </DescriptionListGroup>}
                            { notMetConditions.length > 0 &&
                                <DescriptionListGroup>
                                    <DescriptionListTerm className="failed">{ _("Condition failed") }</DescriptionListTerm>
                                    <DescriptionListDescription id="condition">
                                        {notMetConditions.map(cond => <div key={cond}>{cond}</div>)}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                            }
                            {triggerRelationshipsList}
                        </DescriptionList>
                        {extraRelationshipsList.length
                            ? <ExpandableSection id="service-details-show-relationships" toggleText={triggerRelationshipsList.length ? _("Show more relationships") : _("Show relationships")}>
                                <DescriptionList isHorizontal>
                                    {extraRelationshipsList}
                                </DescriptionList>
                            </ExpandableSection>
                            : null}
                    </Stack>
                </CardBody>
            </Card>
        );
    }
}
ServiceDetails.propTypes = {
    unit: PropTypes.object.isRequired,
    // not required: can be null initially, we don't wait for the proxy
    permitted: PropTypes.bool,
    isValid: PropTypes.func.isRequired,
};

const DeleteModal = ({ reason, name, handleCancel, handleDelete }) => {
    const [inProgress, setInProgress] = useState(false);
    const [dialogError, setDialogError] = useState(undefined);
    return (
        <Modal isOpen
               showClose={false}
               position="top" variant="medium"
               onClose={handleCancel}
               title={cockpit.format(_("Confirm deletion of $0"), name)}
               titleIconVariant="warning"
               footer={<>
                   <Button id="delete-timer-modal-btn" variant="danger" isDisabled={inProgress} isLoading={inProgress}
                           onClick={() => { setInProgress(true); handleDelete().catch(exc => { setDialogError(exc.message); setInProgress(false) }) }}
                   >
                       {_("Delete")}
                   </Button>
                   <Button variant="link" isDisabled={inProgress} onClick={handleCancel}>{_("Cancel")}</Button>
               </>}
        >
            <Stack hasGutter>
                {dialogError && <ModalError dialogError={_("Timer deletion failed")} dialogErrorDetail={dialogError} />}
                {reason}
            </Stack>
        </Modal>
    );
};
