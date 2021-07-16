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
    Alert, Button, Checkbox,
    Flex, FlexItem,
    Modal, Radio,
    Split, SplitItem,
    Stack,
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
            error: "",
            updating: false,
            showModal: false,
            applyCheckbox: false,
            justCurrent: null,
            kernelName: "",
            patchName: null,
            patchInstalled: null,
            patchUnavailable: null,
        };

        this.kpatchService = serviceProxy("kpatch");

        this.checkSetup = this.checkSetup.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.onClose = this.onClose.bind(this);
        this.handleInstall = this.handleInstall.bind(this);
    }

    componentDidMount() {
        check_missing_packages(["kpatch", "kpatch-dnf"])
                .then(d => {
                    this.setState({
                        loaded: true,
                        unavailable: d.unavailable_names || [],
                        missing: d.missing_names || [],
                    });

                    this.checkSetup();
                })
                .catch(e => {
                    console.log("Could not determine kpatch availability.");
                });

        this.kpatchService.addEventListener('changed', () => {
            this.setState((state, _) => {
                const current = this.kpatchService.enabled && (state.patchInstalled || state.patchUnavailable);
                return ({
                    enabled: this.kpatchService.enabled,
                    justCurrent: current && !state.auto,
                    applyCheckbox: current,
                });
            });
        });
    }

    checkSetup() {
        cockpit.file("/etc/dnf/plugins/kpatch.conf").read()
                .then(data => {
                    if (data) {
                        const auto = /autoupdate\s*=\s*True/.test(data);
                        this.setState((state, _) => {
                            const current = state.enabled && (state.patchInstalled || state.patchUnavailable);
                            return ({
                                auto: !!auto,
                                justCurrent: current && !auto,
                                applyCheckbox: current,
                            });
                        });
                    }
                })
                .catch(() => true); // Ignore errors, most likely just does not exist

        cockpit.spawn(["uname", "-r"])
                .then(data => {
                    const fields = data.split(".");
                    const sanitized_kernel_ver = fields.slice(0, fields.length - 2)
                            .join("_");
                    const patch_name = "kpatch-patch-" + sanitized_kernel_ver;
                    check_missing_packages([patch_name])
                            .then(d => {
                                this.setState((state, _) => {
                                    const installed = (d.unavailable_names || []).length === 0 && (d.missing_names || []).length === 0;
                                    const unavailable = (d.unavailable_names || []).length > 0;
                                    const current = state.enabled && (installed || unavailable);
                                    return ({
                                        patchName: patch_name,
                                        patchInstalled: installed,
                                        patchUnavailable: unavailable,
                                        justCurrent: current && !state.auto,
                                        applyCheckbox: current,
                                        kernelName: data,
                                    });
                                });
                            })
                            .catch(() => true);
                })
                .catch(() => true);
    }

    handleInstall() {
        this.setState({ updating: true });
        install_dialog(this.state.missing)
                .then(() => {
                    this.setState({ missing: [], updating: false });
                })
                .catch(() => this.setState({ updating: false }));
    }

    onClose() {
        this.setState((state, _) => {
            const current = state.enabled && (state.patchInstalled || state.patchUnavailable);
            return ({
                justCurrent: current && !state.auto,
                applyCheckbox: current,
                showModal: false,
                error: "",
            });
        });
    }

    handleChange() {
        this.setState({ updating: true });

        if (this.state.applyCheckbox) {
            let install = Promise.resolve(true);
            if (this.state.justCurrent) {
                install = new Promise((resolve, reject) => {
                    cockpit.spawn(["dnf", "-y", "kpatch", "manual"], { superuser: "require", err: "message" })
                            .then(() => {
                                if (!this.state.patchUnavailable && !this.state.patchInstalled)
                                    cockpit.spawn(["dnf", "-y", "install", this.state.patchName], { superuser: "require", err: "message" }).then(resolve)
                                            .catch(reject);
                                else
                                    resolve();
                            })
                            .catch(reject);
                });
            } else {
                install = cockpit.spawn(["dnf", "-y", "kpatch", "auto"], { superuser: "require", err: "message" });
            }
            install.then(() => {
                this.kpatchService.enable().then(() => {
                    this.kpatchService.start().then(() => {
                        this.setState({ showModal: false, error: "" });
                    });
                });
            })
                    .catch(e => this.setState({ error: e.toString() }))
                    .finally(() => {
                        this.checkSetup();
                        this.setState({ updating: false });
                    });
        } else {
            cockpit.spawn(["dnf", "-y", "kpatch", "manual"], { superuser: "require", err: "message" }).then(() => {
                this.kpatchService.disable().then(() => {
                    this.kpatchService.stop().then(() => {
                        this.setState({ showModal: false, error: "" });
                    });
                });
            })
                    .catch(e => this.setState({ error: e.toString() }))
                    .finally(() => {
                        this.checkSetup();
                        this.setState({ updating: false });
                    });
        }
    }

    render() {
        // Not yet recognized
        if (this.state.loaded === false || this.state.patchName === null)
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
        } else if (!this.state.enabled) {
            state = _("Disabled");
            actionText = _("Enable");
        }

        let kernel_name = "";
        if (this.state.kernelName)
            kernel_name = " (" + this.state.kernelName + ")";

        let error = null;
        if (this.state.error)
            error = <Alert variant='danger' isInline title={this.state.error} />;

        const body = <Checkbox id="apply-kpatch"
                               isChecked={this.state.applyCheckbox}
                               label={_("Apply kernel patches")}
                               onChange={checked => this.setState({ applyCheckbox: checked })}
                               body={<>
                                   <Radio id="current-future" label={_("for current and future kernels")} onChange={() => this.setState({ justCurrent: false })} isDisabled={!this.state.applyCheckbox} isChecked={!this.state.justCurrent} />
                                   <Radio id="current-only" label={_("for current kernel only") + kernel_name} onChange={() => this.setState({ justCurrent: true })} isDisabled={!this.state.applyCheckbox} isChecked={this.state.justCurrent} />
                               </>}
        />;

        return (<>
            <div id="kpatch-settings">
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <Flex grow={{ default: 'grow' }} alignItems={{ default: 'alignItemsBaseline' }}>
                        <FlexItem>
                            <b>{_("Kernel patching")}</b>
                        </FlexItem>
                        <FlexItem>
                            {state}
                        </FlexItem>
                    </Flex>
                    <Flex>
                        <Button variant="secondary"
                                isSmall
                                disabled={!this.props.privileged}
                                onClick={action}>
                            {actionText}
                        </Button>
                    </Flex>
                </Flex>
            </div>
            <Modal position="top" variant="small" id="kpatch-setup" isOpen={this.state.showModal}
                title={_("Kernel patch settings")}
                onClose={ this.onClose }
                footer={
                    <>
                        <Button variant="primary"
                                isLoading={ this.state.updating }
                                isDisabled={ this.state.updating }
                                onClick={ this.handleChange }>
                            {_("Apply")}
                        </Button>
                        <Button variant="link"
                                isDisabled={ this.state.updating }
                                onClick={ this.onClose }>
                            {_("Cancel")}
                        </Button>
                    </>
                }>
                <>
                    {error}
                    {body}
                </>
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
                        !parts[0].startsWith("Loaded patch modules:") ||
                        !parts[1].startsWith("Installed patch modules:")) {
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
