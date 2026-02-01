/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import cockpit from "cockpit";
import React from "react";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

const _ = cockpit.gettext;

export class FirewallSwitch extends React.Component {
    constructor() {
        super();
        this.state = {
            pendingTarget: null /* `null` for not pending */
        };
        this.onSwitchChanged = this.onSwitchChanged.bind(this);
    }

    static getDerivedStateFromProps(props, state) {
        if (props.firewall.enabled == state.pendingTarget) {
            return {
                pendingTarget: null
            };
        }
        return null;
    }

    onSwitchChanged(_event, value) {
        this.setState({ pendingTarget: value });

        if (value)
            this.props.firewall.enable();
        else
            this.props.firewall.disable();
    }

    render() {
        const enabled = this.state.pendingTarget !== null ? this.state.pendingTarget : this.props.firewall.enabled;
        let firewallOnOff;

        if (this.props.firewall.readonly) {
            firewallOnOff = <Tooltip id="tip-auth"
                                     content={ _("You are not authorized to modify the firewall.") }>
                <Switch isChecked={enabled}
                        id='networking-firewall-switch'
                        className='networking-firewall-switch'
                        onChange={this.onSwitchChanged}
                        label={enabled ? _("Enabled") : _("Disabled")}
                        aria-label={enabled ? _("Not authorized to disable the firewall") : _("Not authorized to enable the firewall")}
                        isDisabled />
            </Tooltip>;
        } else {
            firewallOnOff = <Switch isChecked={enabled}
                                    id='networking-firewall-switch'
                                    className='networking-firewall-switch'
                                    isDisabled={!!this.state.pendingTarget}
                                    onChange={this.onSwitchChanged}
                                    label={enabled ? _("Enabled") : _("Disabled")}
                                    aria-label={enabled ? _("Disable the firewall") : _("Enable the firewall")} />;
        }
        return firewallOnOff;
    }
}
