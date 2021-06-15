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

import React from "react";
import moment from "moment";
import PropTypes from "prop-types";
import {
    Alert, Button,
    DescriptionList, DescriptionListTerm, DescriptionListGroup, DescriptionListDescription,
    Dropdown, DropdownItem, DropdownSeparator, KebabToggle,
    ExpandableSection,
    Tooltip, TooltipPosition,
    Card, CardBody, CardTitle, Text, TextVariants,
    Modal, Switch
} from "@patternfly/react-core";

import cockpit from "cockpit";
import { systemd_client, SD_MANAGER, SD_OBJ } from "./services.jsx";

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
class ServiceConfirmDialog extends React.Component {
    render() {
        return (
            <Modal id={this.props.id} isOpen
                   position="top" variant="medium"
                   onClose={this.props.close}
                   title={this.props.title}
                   footer={
                       <>
                           { this.props.confirmText && this.props.confirmAction &&
                               <Button variant='danger' onClick={this.props.confirmAction}>
                                   {this.props.confirmText}
                               </Button>
                           }
                           <Button variant='link' className='btn-cancel' onClick={this.props.close}>
                               { _("Cancel") }
                           </Button>
                       </>
                   }>
                {this.props.message}
            </Modal>
        );
    }
}
ServiceConfirmDialog.propTypes = {
    title: PropTypes.string.isRequired,
    message: PropTypes.string.isRequired,
    close: PropTypes.func.isRequired,
    confirmText: PropTypes.string,
    confirmAction: PropTypes.func,
};

/*
 * React template for showing possible service action (in a kebab menu)
 * Required props:
 *  - masked
 *     Unit is masked
 *  - active
 *     Unit is active (running)
 *  - failed
 *     Unit has failed
 *  - canReload
 *      Unit can be reloaded
 *  - actionCallback
 *      Method for calling unit methods like `UnitStart`
 *  - fileActionCallback
 *      Method for calling unit file methods like `EnableUnitFiles`
 *  - disabled
 *      Button is disabled
 */
class ServiceActions extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogMaskedOpened: false,
        };
    }

    render() {
        const actions = [];

        // If masked, only show unmasking and nothing else
        if (this.props.masked) {
            actions.push(
                <DropdownItem key="unmask" onClick={() => this.props.fileActionCallback("UnmaskUnitFiles", undefined)}>{ _("Allow running (unmask)") }</DropdownItem>
            );
        } else { // All cases when not masked
            if (this.props.active) {
                if (this.props.canReload) {
                    actions.push(
                        <DropdownItem key="reload" onClick={() => this.props.actionCallback("ReloadUnit")}>{ _("Reload") }</DropdownItem>
                    );
                }
                actions.push(
                    <DropdownItem key="restart" onClick={() => this.props.actionCallback("RestartUnit")}>{ _("Restart") }</DropdownItem>
                );
                actions.push(
                    <DropdownItem key="stop" onClick={() => this.props.actionCallback("StopUnit")}>{ _("Stop") }</DropdownItem>,
                );
            } else {
                actions.push(
                    <DropdownItem key="start" onClick={() => this.props.actionCallback("StartUnit")}>{ _("Start") }</DropdownItem>
                );
            }

            if (actions.length > 0) {
                actions.push(
                    <DropdownSeparator key="divider" />
                );
            }

            if (this.props.failed)
                actions.push(
                    <DropdownItem key="reset" onClick={() => this.props.actionCallback("ResetFailedUnit", []) }>{ _("Clear 'Failed to start'") }</DropdownItem>
                );

            actions.push(
                <DropdownItem key="mask" onClick={() => this.setState({ dialogMaskedOpened: true }) }>{ _("Disallow running (mask)") }</DropdownItem>
            );
        }

        return (
            <>
                { this.state.dialogMaskedOpened &&
                    <ServiceConfirmDialog id="mask-service" title={ _("Mask service") }
                                          message={ _("Masking service prevents all dependent units from running. This can have bigger impact than anticipated. Please confirm that you want to mask this unit.")}
                                          close={() => this.setState({ dialogMaskedOpened: false }) }
                                          confirmText={ _("Mask service") }
                                          confirmAction={() => {
                                              this.props.fileActionCallback("MaskUnitFiles", false);
                                              this.props.actionCallback("ResetFailedUnit", []);
                                              this.setState({ dialogMaskedOpened: false });
                                          }} />
                }
                <Dropdown id="service-actions" title={ _("Additional actions") }
                          toggle={<KebabToggle isDisabled={this.props.disabled} onToggle={isActionOpen => this.setState({ isActionOpen })} />}
                          isOpen={this.state.isActionOpen}
                          isPlain
                          onSelect={() => this.setState({ isActionOpen: !this.state.isActionOpen })}
                          position='right'
                          dropdownItems={actions} />
            </>
        );
    }
}
ServiceActions.propTypes = {
    masked: PropTypes.bool.isRequired,
    active: PropTypes.bool.isRequired,
    failed: PropTypes.bool.isRequired,
    canReload: PropTypes.bool,
    actionCallback: PropTypes.func.isRequired,
    fileActionCallback: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
};

/*
 * React template for a service details
 * Shows current status and information about the service.
 * Enables user to control this unit like starting, enabling, etc. the service.
 * Required props:
 *  -  unit
 *      Unit as returned from systemd dbus API
 *  -  permitted
 *      True if user can control this unit
 *  -  systemdManager
 *      Callback for displaying errors
 *  -  isValid
 *      Method for finding if unit is valid
 */
export class ServiceDetails extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            waitsAction: false,
            waitsFileAction: false,
            note: "",
            error: "",
            unit_properties: {},
        };

        this.onOnOffSwitch = this.onOnOffSwitch.bind(this);
        this.unitAction = this.unitAction.bind(this);
        this.unitFileAction = this.unitFileAction.bind(this);

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

    doMemoryCurrentPolling() {
        systemd_client.call(this.props.unit.path,
                            "org.freedesktop.DBus.Properties", "Get",
                            ["org.freedesktop.systemd1." + this.unitTypeCapitalized, 'MemoryCurrent'])
                .then(result => {
                    this.addUnitProperties(
                        "MemoryCurrent",
                        result[0] && result[0].v > 0 ? result[0].v : null,
                    );
                }, ex => console.log(ex.message));
    }

    addUnitProperties(prop, value) {
        if (prop == "MemoryCurrent" && this.state.unit_properties.MemoryCurrent !== value)
            this.setState({ unit_properties: Object.assign(this.state.unit_properties, { [prop]: value }) });
    }

    onOnOffSwitch() {
        if (this.props.unit.UnitFileState === "enabled") {
            this.unitFileAction("DisableUnitFiles", undefined);
            if (this.props.unit.ActiveState === "active" || this.props.unit.ActiveState === "activating")
                this.unitAction("StopUnit");
            if (this.props.unit.ActiveState === "failed")
                this.unitAction("ResetFailedUnit", []);
        } else {
            this.unitFileAction("EnableUnitFiles", false);
            if (this.props.unit.ActiveState !== "active" && this.props.unit.ActiveState !== "activating")
                this.unitAction("StartUnit");
        }
    }

    unitAction(method, extra_args) {
        if (extra_args === undefined)
            extra_args = ["fail"];
        this.setState({ waitsAction: true });
        systemd_client.call(SD_OBJ, SD_MANAGER, method, [this.props.unit.Names[0]].concat(extra_args))
                .catch(error => this.setState({ error: error.toString(), waitsAction: false }));
    }

    unitFileAction(method, force) {
        this.setState({ waitsFileAction: true });
        const args = [[this.props.unit.Names[0]], false];
        if (force !== undefined)
            args.push(force == "true");
        systemd_client.call(SD_OBJ, SD_MANAGER, method, args)
                .then(([results]) => {
                    if (results.length == 2 && !results[0])
                        this.setState({ note:_("This unit is not designed to be enabled explicitly.") });
                    /* Executing daemon reload after file operations is necessary -
                     * see https://github.com/systemd/systemd/blob/main/src/systemctl/systemctl.c [enable_unit function]
                     */
                    systemd_client.call(SD_OBJ, SD_MANAGER, "Reload", null);
                })
                .catch(error => {
                    this.setState({
                        error: error.toString(),
                        waitsFileAction: false
                    });
                });
    }

    render() {
        const active = this.props.unit.ActiveState === "active" || this.props.unit.ActiveState === "activating";
        const enabled = this.props.unit.UnitFileState === "enabled";
        const isStatic = this.props.unit.UnitFileState !== "disabled" && !enabled;
        const failed = this.props.unit.ActiveState === "failed";
        const masked = this.props.unit.LoadState === "masked";
        const unit = this.state.unit_properties;

        let status = [];

        if (masked) {
            status.push(
                <div key="masked" className="status-masked">
                    <span className="fa fa-ban status-icon" />
                    <span className="status">{ _("Masked") }</span>
                    <span className="side-note font-xs">{ _("Forbidden from running") }</span>
                </div>
            );
        }

        if (!enabled && !active && !masked && !isStatic) {
            status.push(
                <div key="disabled" className="status-disabled">
                    <span className="pficon pficon-off status-icon" />
                    <span className="status">{ _("Disabled") }</span>
                </div>
            );
        }

        if (failed) {
            status.push(
                <div key="failed" className="status-failed">
                    <span className="pficon pficon-error-circle-o status-icon" />
                    <span className="status">{ _("Failed to start") }</span>
                    { this.props.permitted &&
                        <Button variant="secondary" className="action-button" onClick={() => this.unitAction("StartUnit") }>{ _("Start service") }</Button>
                    }
                </div>
            );
        }

        if (!status.length) {
            if (active) {
                status.push(
                    <div key="running" className="status-running">
                        <span className="pficon pficon-on-running status-icon" />
                        <span className="status">{ _("Running") }</span>
                        <span className="side-note font-xs">{ _("Active since ") + moment(this.props.unit.ActiveEnterTimestamp / 1000).format('LLL') }</span>
                    </div>
                );
            } else {
                status.push(
                    <div key="stopped" className="status-stopped">
                        <span className="pficon pficon-off status-icon" />
                        <span className="status">{ _("Not running") }</span>
                    </div>
                );
            }
        }

        if (isStatic && !masked) {
            status.unshift(
                <div key="static" className="status-static">
                    <span className="pficon pficon-asleep status-icon" />
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

        if (!this.props.permitted) {
            status.unshift(
                <div key="readonly" className="status-readonly">
                    <span className="fa fa-user status-icon" />
                    <span className="status">{ _("Read-only") }</span>
                    <span className="side-note font-xs">{ _("Requires administration access to edit") }</span>
                </div>
            );
        }

        if (enabled) {
            status.push(
                <div key="enabled" className="status-enabled">
                    <span className="pficon pficon-ok status-icon" />
                    <span className="status">{ _("Automatically starts") }</span>
                </div>
            );
        }

        if (this.props.unit.NextRunTime || this.props.unit.LastTriggerTime) {
            status.push(
                <div className="service-unit-triggers">
                    {this.props.unit.NextRunTime && <div className="service-unit-next-trigger">{cockpit.format("Next run: $0", this.props.unit.NextRunTime)}</div>}
                    {this.props.unit.LastTriggerTime && <div className="service-unit-last-trigger">{cockpit.format("Last trigger: $0", this.props.unit.LastTriggerTime)}</div>}
                </div>
            );
        }

        /* If there is some ongoing action just show spinner */
        if (this.state.waitsAction || this.state.waitsFileAction) {
            status = [
                <div key="updating" className="status-updating">
                    <span className="spinner spinner-inline spinner-xs status-icon" />
                    <span className="status">{ _("Updating status...") }</span>
                </div>
            ];
        }

        const tooltipMessage = enabled ? _("Stop and disable") : _("Start and enable");
        const hasLoadError = this.props.unit.LoadState !== "loaded" && this.props.unit.LoadState !== "masked";
        const loadError = this.props.unit.LoadError ? this.props.unit.LoadError[1] : null;

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
                                    {rel.Units.map(unit => <li key={unit}><Button isInline variant="link" component="a" href={"#/" + unit} isDisabled={!this.props.isValid(unit)}>{unit}</Button></li>)}
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
            conditions.map(condition => {
                if (condition[4] < 0)
                    notMetConditions.push(cockpit.format(_("Condition $0=$1 was not met"), condition[0], condition[3]));
            });

        return (
            <Card>
                { (this.state.note || this.state.error) &&
                    <ServiceConfirmDialog title={ this.state.error ? _("Error") : _("Note") }
                                          message={ this.state.error || this.state.note }
                                          close={ () => this.setState(this.state.error ? { error:"" } : { note:"" }) }
                    />
                }
                { (hasLoadError && this.props.unit.LoadState)
                    ? <Alert variant="danger" isInline title={this.props.unit.LoadState}>
                        {loadError}
                    </Alert>
                    : <>
                        <CardTitle className="service-top-panel">
                            <Text component={TextVariants.h2} className="service-name">{this.props.unit.Description}</Text>
                            { this.props.permitted &&
                                <>
                                    { !masked && !isStatic &&
                                        <Tooltip id="switch-unit-state" content={tooltipMessage} position={TooltipPosition.right}>
                                            <span>
                                                <Switch isChecked={enabled}
                                                        aria-label={tooltipMessage}
                                                        isDisabled={this.state.waitsAction || this.state.waitsFileAction}
                                                        onChange={this.onOnOffSwitch} />
                                            </span>
                                        </Tooltip>
                                    }
                                    <ServiceActions { ...{ active, failed, enabled, masked } } canReload={this.props.unit.CanReload} actionCallback={this.unitAction} fileActionCallback={this.unitFileAction} disabled={this.state.waitsAction || this.state.waitsFileAction} />
                                </>
                            }
                        </CardTitle>
                        <CardBody>
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
                                {unit.MemoryCurrent ? <DescriptionListGroup>
                                    <DescriptionListTerm>{ _("Memory") }</DescriptionListTerm>
                                    <DescriptionListDescription id="memory">{cockpit.format_bytes(unit.MemoryCurrent, 1024)}</DescriptionListDescription>
                                </DescriptionListGroup> : null}
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
                                </ExpandableSection> : null}
                        </CardBody>
                    </>
                }
            </Card>
        );
    }
}
ServiceDetails.propTypes = {
    unit: PropTypes.object.isRequired,
    permitted: PropTypes.bool.isRequired,
    isValid: PropTypes.func.isRequired,
};
