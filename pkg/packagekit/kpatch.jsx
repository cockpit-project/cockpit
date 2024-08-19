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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";
import PropTypes from "prop-types";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Form } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { InfoIcon, InfoCircleIcon } from "@patternfly/react-icons";

import cockpit from "cockpit";
import { proxy as serviceProxy } from "service";
import { check_missing_packages } from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { read_os_release } from "os-release.js";

const _ = cockpit.gettext;

export class KpatchSettings extends React.Component {
    constructor() {
        super();

        this.state = {
            loaded: false,
            showLoading: null, // true: show spinner during initialization; false: hide
            auto: null, // `dnf kpatch` is set to `auto`
            enabled: null, // kpatch.service is enabled
            missing: [], // missing packages from `kpatch`, `kpatch-dnf`
            unavailable: [], // unavailable packages from `kpatch`, `kpatch-dnf`

            // Modal states
            error: "",
            updating: false,
            showModal: false,
            applyCheckbox: false, // state of the checkbox
            justCurrent: null, // radio state

            kernelName: "", // uname -r
            patchName: null, // kpatch-patch name
            patchInstalled: null, // kpatch-patch installed
            patchUnavailable: null, // kpatch-patch available
        };

        this.kpatchService = serviceProxy("kpatch");

        this.checkSetup = this.checkSetup.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.onClose = this.onClose.bind(this);
        this.handleInstall = this.handleInstall.bind(this);

        // only show a spinner during loading on RHEL (the only place where we expect this to work)
        read_os_release().then(os_release => this.setState({ showLoading: os_release && os_release.ID == 'rhel' }));
    }

    // Only current patches or also future ones
    current(enabled, installed, unavailable) {
        return enabled && (installed || unavailable);
    }

    componentDidMount() {
        check_missing_packages(["kpatch", "kpatch-dnf"])
                .then(d =>
                    this.checkSetup().then(() =>
                        this.setState({
                            loaded: true,
                            unavailable: d.unavailable_names || [],
                            missing: d.missing_names || [],
                        })
                    )
                )
                .catch(e => console.log("Could not determine kpatch availability:", JSON.stringify(e)));

        this.kpatchService.addEventListener('changed', () => {
            this.setState(state => {
                const current = this.current(this.kpatchService.enabled, state.patchInstalled, state.patchUnavailable);
                return ({
                    enabled: this.kpatchService.enabled,
                    justCurrent: current && !state.auto,
                    applyCheckbox: current,
                });
            });
        });
    }

    checkSetup() {
        // TODO - replace both with `dnf kpatch status` once https://github.com/dynup/kpatch-dnf/pull/8 lands
        const kpatch_promise = cockpit.file("/etc/dnf/plugins/kpatch.conf").read()
                .then(data => {
                    if (data) {
                        const auto = /autoupdate\s*=\s*True/i.test(data);
                        this.setState((state, _) => {
                            const current = this.current(state.enabled, state.patchInstalled, state.patchUnavailable);
                            return ({
                                auto: !!auto,
                                justCurrent: current && !auto,
                                applyCheckbox: current,
                            });
                        });
                    }
                })
                .catch(() => true); // Ignore errors, most likely just does not exist

        const uname_promise = cockpit.spawn(["uname", "-r"])
                .then(data => {
                    const fields = data.split("-");
                    // if there's no release field, we don't have an official kernel
                    if (!fields[1])
                        return;
                    const kpp_kernel_version = fields[0].replaceAll(".", "_");
                    let release = fields[1].split(".");
                    release = release.slice(0, release.length - 2); // remove el8.x86_64
                    const kpp_kernel_release = release.join("_");
                    const patch_name = ["kpatch-patch", kpp_kernel_version, kpp_kernel_release].join("-");
                    return check_missing_packages([patch_name])
                            .then(d =>
                                this.setState((state, _) => {
                                    const installed = (d.unavailable_names || []).length === 0 && (d.missing_names || []).length === 0;
                                    const unavailable = (d.unavailable_names || []).length > 0;
                                    const current = this.current(state.enabled, installed, unavailable);
                                    return ({
                                        kernelName: data,
                                        patchName: patch_name,
                                        patchInstalled: installed,
                                        patchUnavailable: unavailable,
                                        justCurrent: current && !state.auto,
                                        applyCheckbox: current,
                                    });
                                })
                            );
                })
                .catch(err => console.error("Could not determine kpatch packages:", JSON.stringify(err))); // not-covered: OS error

        return Promise.allSettled([kpatch_promise, uname_promise]);
    }

    handleInstall() {
        this.setState({ updating: true });
        install_dialog(this.state.missing)
                .then(() => this.setState({ missing: [], updating: false }))
                .catch(() => this.setState({ updating: false }));
    }

    onClose() {
        this.setState((state, _) => {
            const current = this.current(state.enabled, state.patchInstalled, state.patchUnavailable);
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
            let install;
            if (this.state.justCurrent) {
                install = new Promise((resolve, reject) => {
                    cockpit.spawn(["dnf", "-y", "kpatch", "manual"], { superuser: "require", err: "message" })
                            .then(() => {
                                if (!this.state.patchUnavailable && !this.state.patchInstalled)
                                    // TODO - replace with `dnf kpatch install` once https://github.com/dynup/kpatch-dnf/pull/8 lands
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
            install
                    .then(() =>
                        this.kpatchService.enable().then(() =>
                            this.kpatchService.start().then(() =>
                                this.setState({ showModal: false, error: "" })
                            )
                        )
                    )
                    .catch(e => this.setState({ error: e.toString() }))
                    .finally(() => this.checkSetup().then(() => this.setState({ updating: false })));
        } else {
            cockpit.spawn(["dnf", "-y", "kpatch", "manual"], { superuser: "require", err: "message" })
                    .then(() =>
                        this.kpatchService.disable().then(() =>
                            this.kpatchService.stop().then(() =>
                                this.setState({ showModal: false, error: "" })
                            )
                        )
                    )
                    .catch(e => this.setState({ error: e.toString() }))
                    .finally(() => this.checkSetup().then(() => this.setState({ updating: false })));
        }
    }

    render() {
        // don't show anything during initial detection
        if ((this.state.loaded === false || this.state.patchName === null) && !this.state.showLoading)
            return null;

        // Not supported on this system
        if (this.state.unavailable.length > 0 && !this.state.showLoading)
            return null;
        let state;
        let actionText = _("Edit");
        let action = () => this.setState({ showModal: true });

        if (this.state.loaded === false || this.state.patchName === null) {
            // Not yet recognized
            state = <Spinner size="md" />;
        } else if (this.state.unavailable.length > 0) {
            state = <Popover headerContent={ _("Unavailable packages") } bodyContent={ this.state.unavailable.join(", ") }>
                <span>
                    { _("Not available") }
                    &nbsp;
                    <InfoCircleIcon className="ct-info-circle" />
                </span>
            </Popover>;
        } else if (this.state.missing.length > 0) {
            state = _("Not installed");
            actionText = _("Install");
            action = this.handleInstall;
        } else if (!this.state.enabled) {
            state = _("Disabled");
            actionText = _("Enable");
        } else {
            state = _("Enabled");
        }

        const kernel_name = this.state.kernelName ? " (" + this.state.kernelName + ")" : "";
        const error = this.state.error ? <Alert variant='danger' isInline title={this.state.error} /> : null;

        const body = <Form><Checkbox id="apply-kpatch"
                               isChecked={this.state.applyCheckbox}
                               label={_("Apply kernel live patches")}
                               onChange={(_event, checked) => this.setState({ applyCheckbox: checked })}
                               body={<>
                                   <Radio id="current-future"
                                          label={_("for current and future kernels")}
                                          onChange={() => this.setState({ justCurrent: false })}
                                          isDisabled={!this.state.applyCheckbox}
                                          isChecked={!this.state.justCurrent} />
                                   <Radio id="current-only"
                                          label={_("for current kernel only") + kernel_name}
                                          onChange={() => this.setState({ justCurrent: true })}
                                          isDisabled={!this.state.applyCheckbox}
                                          isChecked={this.state.justCurrent} />
                               </>}
        /></Form>;

        return (<>
            <div id="kpatch-settings">
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <Flex grow={{ default: 'grow' }} alignItems={{ default: 'alignItemsBaseline' }}>
                        <FlexItem>
                            <b>{_("Kernel live patching")}</b>
                        </FlexItem>
                        <FlexItem>
                            {state}
                        </FlexItem>
                    </Flex>
                    <Flex>
                        <Button variant="secondary"
                                size="sm"
                                isDisabled={!this.props.privileged || this.state.updating || !this.state.loaded || this.state.unavailable.length > 0}
                                onClick={action}>
                            {actionText}
                        </Button>
                    </Flex>
                </Flex>
            </div>
            <Modal position="top" variant="small" id="kpatch-setup" isOpen={this.state.showModal}
                title={_("Kernel live patch settings")}
                onClose={ this.onClose }
                footer={
                    <>
                        <Button variant="primary"
                                isLoading={ this.state.updating }
                                isDisabled={ this.state.updating }
                                onClick={ this.handleChange }>
                            {_("Save")}
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
    privileged: PropTypes.bool,
};

export class KpatchStatus extends React.Component {
    constructor() {
        super();

        this.state = {
            loaded: [],
            installed: [],
            changelog: null, // FIXME - load changelog
        };
    }

    componentDidMount() {
        cockpit.spawn(["kpatch", "list"], { superuser: "try", err: "ignore", environ: ["LC_MESSAGES=C"] })
                .then(m => {
                    const parts = m.trim().split("\n\n");
                    if (parts.length !== 2 ||
                        !parts[0].startsWith("Loaded patch modules:") ||
                        !parts[1].startsWith("Installed patch modules:")) {
                        console.warn("Unexpected output from `kpatch list`", m);
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

    render() {
        let text = [];
        text = this.state.loaded.map(i =>
            <Text key={i} component={TextVariants.p}>
                { cockpit.format(_("Kernel live patch $0 is active"), i) }
            </Text>
        );

        if (text.length === 0)
            text = this.state.installed.map(i =>
                <Text key={i} component={TextVariants.p}>
                    { cockpit.format(_("Kernel live patch $0 is installed"), i) }
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
