/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import PropTypes from 'prop-types';
import {
    Button,
    List, ListItem,
    Modal,
    Split, SplitItem,
    Stack, StackItem,
    Switch,
    Text, TextVariants
} from '@patternfly/react-core';
import { InfoIcon } from "@patternfly/react-icons";

import cockpit from "cockpit";
import { proxy as serviceProxy } from 'service';
import { check_missing_packages } from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";

const _ = cockpit.gettext;

export class KpatchSettings extends React.Component {
    constructor() {
        super();

        this.state = {
            auto: null,
            loaded: false,
            enabled: null,
            missing: [],
            unavailable: [],
            updating: false,
            showModal: false,
            futureEnabled: null,
            futureAuto: null,
        };

        this.kpatchService = serviceProxy("kpatch");

        this.checkSetup = this.checkSetup.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleService = this.handleService.bind(this);
        this.handleInstall = this.handleInstall.bind(this);
        this.installPatches = this.installPatches.bind(this);
    }

    componentDidMount() {
        check_missing_packages(["kpatch", "kpatch-dnf"])
                .then(d => {
                    this.setState({
                        loaded: true,
                        unavailable: d.unavailable_names || [],
                        missing: d.missing_names || [],
                    });

                    if ((d.unavailable_names || []).length === 0 && (d.missing_names || []).length === 0)
                        this.checkSetup();
                })
                .catch(e => {
                    console.log("Failed to query info about availablity of kpatch");
                });

        this.kpatchService.addEventListener('changed', () => {
            this.setState({ enabled: this.kpatchService.enabled, futureEnabled: this.kpatchService.enabled });
        });
    }

    handleService(enable) {
        if (enable)
            return this.kpatchService.enable();
        else
            return this.kpatchService.disable();
    }

    installPatches(auto) {
        return cockpit.spawn(["dnf", "-y", "kpatch", auto ? "auto" : "manual"], { superuser: "require", err: "message" });
    }

    checkSetup() {
        return new Promise((resolve, reject) => {
            cockpit.file("/etc/dnf/plugins/kpatch.conf").read()
                    .then(data => {
                        if (!data) {
                            resolve();
                        } else {
                            const autoupdate = data.split("\n").find(l => l.indexOf("autoupdate") >= 0);
                            const auto = autoupdate.endsWith("True");
                            this.setState({ auto: auto, futureAuto: auto }, resolve);
                        }
                    })
                    .catch(reject);
        });
    }

    handleInstall() {
        this.setState({ updating: true });
        install_dialog(this.state.missing)
                .then(() => {
                    this.setState({ missing: [], updating: false });
                })
                .catch(() => this.setState({ updating: false }));
    }

    handleChange() {
        this.setState({ updating: true });

        const promises = [];

        if (this.state.auto !== this.state.futureAuto)
            promises.push(this.installPatches(this.state.futureAuto));

        if (this.state.enabled !== this.state.futureEnabled)
            promises.push(this.handleService(this.state.futureEnabled));

        Promise.all(promises)
                .then(() => this.setState({ showModal: false }))
                .catch(console.log)
                .finally(() => {
                    this.checkSetup();
                    this.setState({ updating: false });
                });
    }

    render() {
        // Not yet recognized
        if (this.state.loaded === false)
            return null;

        // Not supported on this system
        if (this.state.unavailable.length > 0)
            return null;

        let state = _("Enabled");
        let actionText = _("Edit");
        let action = () => this.setState({ showModal: true });

        if (this.state.missing.length > 0 && this.state.unavailable.length === 0) {
            state = _("Not installed");
            actionText = _("Install");
            action = this.handleInstall;
        } else if (this.state.auto === false) {
            state = _("Disabled");
            actionText = _("Enable");
        }

        const details = [];
        if (this.state.enabled !== this.state.futureEnabled) {
            if (this.state.futureEnabled)
                details.push(_("kpatch.service will be enabled. After each reboot patches will be applied."));
            else
                details.push(_("kpatch.service will be disabled. After reboot no patches will be applied."));
        }
        // FIXME - should we uninstall current patches as well?
        if (this.state.auto !== this.state.futureAuto) {
            if (this.state.futureAuto)
                details.push(_("Current kernel patches will be installed. Also when a new kernel is available, patches will be automatically installed as well."));
            else
                details.push(_("For future kernel versions patches won't be installed."));
        }

        const body = <Stack hasGutter>
            <StackItem>
                <Switch isChecked={this.state.futureEnabled}
                            label={_("Kernel live patching service is enabled")}
                            labelOff={_("Kernel live patching service is disabled")}
                            onChange={c => this.setState({ futureEnabled: c })} />
            </StackItem>
            <StackItem>
                <Switch isChecked={this.state.futureAuto}
                            label={_("Subscribed to available kernel patches")}
                            labelOff={_("Not subscribed to kernel patches")}
                            onChange={c => this.setState({ futureAuto: c })} />
            </StackItem>
            <StackItem>
                <List>{details.map(d => <ListItem key={d}>{d}</ListItem>)}</List>
            </StackItem>
        </Stack>;

        return (<>
            <Split hasGutter>
                <SplitItem>
                    <Text component={TextVariants.h4}>{_("Kernel live patching")}</Text>
                </SplitItem>
                <SplitItem isFilled>
                    <Text component={TextVariants.small}>{state}</Text>
                </SplitItem>
                <SplitItem>
                    <Button variant="secondary"
                            isSmall
                            disabled={!this.props.privileged}
                            onClick={action}>
                        {actionText}
                    </Button>
                </SplitItem>
            </Split>
            <Modal position="top" variant="small" id="kpatch-setup" isOpen={this.state.showModal}
                title={_("Kernel live patching settings")}
                onClose={() => this.setState({ showModal: false })}
                footer={
                    <>
                        <Button variant="primary"
                                isLoading={ this.state.updating }
                                isDisabled={ this.state.updating || details.length === 0 }
                                onClick={ this.handleChange }>
                            {_("Apply")}
                        </Button>
                        <Button variant="link"
                                isDisabled={ this.state.updating }
                                onClick={() => this.setState({ showModal: false })}>
                            {_("Cancel")}
                        </Button>
                    </>
                }>
                {body}
            </Modal>
        </>);
    }
}

KpatchSettings.propTypes = {
    privileged: PropTypes.bool.isRequired,
};

export class KpatchStatus extends React.Component {
    constructor() {
        super();

        this.state = {
            loaded: [],
            installed: [],
            changelog: null, // FIXME - load changelog
            opened: false,
        };

        this.checkSetup = this.checkSetup.bind(this);
    }

    checkSetup() {
        cockpit.spawn(["kpatch", "list"], { superuser: "try", err: "ignore" })
                .then(m => {
                    const parts = m.trim().split("\n\n");
                    if (parts.length !== 2 ||
                        !parts[0].startsWith("Loaded patch modules:\n") ||
                        !parts[1].startsWith("Installed patch modules:\n")) {
                        console.warn("Unexpected output from `kpatch list`");
                        return;
                    }

                    const loaded = parts[0].split("\n")
                            .slice(1)
                            .map(i => i.split(" ")[0]);
                    const installed = parts[1].split("\n")
                            .slice(1)
                            .map(i => i.split(" ")[0]);
                    this.setState({ loaded, installed });
                })
                .catch(() => true); // Ignore errors
    }

    componentDidMount() {
        this.checkSetup();
    }

    componentWillUnmount() {
        if (this.watch)
            this.watch.close();
    }

    render() {
        let text = [];
        text = this.state.loaded.map(i =>
            <Text key={i} component={TextVariants.p}>
                { cockpit.format(_("Kernel patch $0 is active"), i) }
            </Text>
        );

        // FIXME - when only installed offer to load
        if (text.length === 0)
            text = this.state.installed.map(i =>
                <Text key={i} component={TextVariants.p}>
                    { cockpit.format(_("Kernel patch $0 is installed"), i) }
                </Text>
            );

        if (text.length > 0)
            return (
                <Split hasGutter>
                    <SplitItem>
                        <InfoIcon />
                    </SplitItem>
                    <SplitItem isFilled>
                        <Stack>
                            {text}
                        </Stack>
                    </SplitItem>
                </Split>
            );

        return null;
    }
}
