/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import React from "react";
import {
    Button,
    Card, CardBody,
    CodeBlockCode,
    Flex,
    Form, FormGroup,
    Page, PageSection, PageSectionVariants,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Spinner,
    Switch,
    TextInput,
    Title,
    Tooltip,
} from "@patternfly/react-core";

import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
const _ = cockpit.gettext;

class AlarmsModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            storeDest: this.props.settings.MODE.value, // dialog mode, depends on location
        };
    }

    render() {
        const cpu = this.props.settings.CPU.value;
        const mem = this.props.settings.MEM.value;
        const freq = this.props.settings.FREQ.value;
        const count = this.props.settings.COUNT.value;
        return (
            <Form isHorizontal>
                <FormGroup fieldId="Alarms-config-cpu" label={_("CPU (0-100)%: ")}>
                    <TextInput id="Alarms-config-cpu" key="CPU"
                               placeholder={cpu} value={cpu}
                               onChange={value => this.props.onChangeInput("CPU", value)} />
                </FormGroup>

                <FormGroup fieldId="Alarms-config-memory" label={_("Memory (GB): ")}>
                    <TextInput id="Alarms-config-memory" key="MEM"
                               placeholder={mem} value={mem}
                               onChange={value => this.props.onChangeInput("MEM", value)} />
                </FormGroup>

                <FormGroup fieldId="Alarms-config-freq" label={_("Pooling Freq (Sec): ")}>
                    <TextInput id="Alarms-config-freq" key="FREQ"
                               placeholder={freq} value={freq}
                               onChange={value => this.props.onChangeInput("FREQ", value)} />
                </FormGroup>

                <FormGroup fieldId="Alarms-config-count" label={_("Pool Failed Count: ")}>
                    <TextInput id="Alarms-config-freq" key="COUNT"
                               placeholder={count} value={count}
                               onChange={value => this.props.onChangeInput("COUNT", value)} />
                </FormGroup>

            </Form>
        );
    }
}

export class AlarmsPage extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogSettings: undefined,
            dialogObj: undefined, // this is used if there's an open dialog
        };
        this.changeSetting = this.changeSetting.bind(this);
        this.handleConfigClick = this.handleConfigClick.bind(this);
        this.dialogClosed = this.dialogClosed.bind(this);
    }

    changeSetting(key, value) {
        const settings = this.state.dialogSettings;
        Object.keys(this.props.configSettings.config._internal).forEach((configkey) => {
            // console.log("configkey=" + configkey + " key=" + key);
            if (configkey == key.toUpperCase()) {
                settings[configkey].value = value;
            }
        });
        console.log(settings);
        this.setState({ dialogSettings: settings });
        this.state.dialogObj.updateDialogBody(settings);
        this.state.dialogObj.render();
    }

    handleSaveClick() {
        return this.props.onSaveSettings(this.state.dialogSettings)
                .catch(error => {
                    if (error.details) {
                        error.message = _("Unable to save settings");
                        error.details = <CodeBlockCode>{ error.details }</CodeBlockCode>;
                    } else {
                        // without a journal, show the error as-is
                        error = new Error(cockpit.format(_("Unable to save settings: $0"), String(error)));
                    }
                    return Promise.reject(error);
                });
    }

    dialogClosed() {
        this.setState({ dialogSettings: undefined, dialogObj: undefined });
    }

    handleConfigClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        e.preventDefault();
        // const self = this;
        const settings = { };
        Object.keys(this.props.configSettings.config._internal).forEach((key) => {
            settings[key] = { ...this.props.configSettings.config._internal[key] };
        });
        const changefunc = this.changeSetting;

        // open the settings dialog
        const dialogProps = {
            title: _("Configure Alarms"),
            id: "alarms-configurations-dialog"
        };
        const updateDialogBody = function(newSettings) {
            // console.log(changefunc);
            dialogProps.body = React.createElement(AlarmsModalBody, {
                settings: newSettings || settings,
                onChangeInput: changefunc
            });
        };
        updateDialogBody();
        // also test modifying properties in subsequent render calls
        const footerProps = {
            actions: [
                {
                    clicked: this.handleSaveClick.bind(this),
                    caption: _("Save"),
                    style: 'primary',
                },
            ],
            dialog_done: this.dialogClosed.bind(this),
        };
        const dialogObj = show_modal_dialog(dialogProps, footerProps);
        dialogObj.updateDialogBody = updateDialogBody;
        this.setState({ dialogSettings: settings, dialogObj });
    }

    render() {
        const tooltip_info_button = _("Click to update the alarms configurations.");
        const tooltip_mode = _("Enabled or  Disabled Alarms");
        const tooltip_cpu = _("Cpu Alarm on crossing threshold continously for number of \"(count)\" time in intervals of \"(freq)\".");
        const tooltip_mem = _("Memory Alarm on crossing threshold continously for number of \"(count)\" time in intervals of \"(freq)\".");
        const tooltip_freq = _("Time interval for pooling the data in seconds.");
        const tooltip_count = _("No of continous pool crossing the thresholds.");
        const serviceEnabled = this.props.alarmsStatus;

        let serviceWaiting;
        if (this.props.stateChanging)
            serviceWaiting = <Spinner isSVG size="md" />;

        const alarmsSwitch = (<Switch isChecked={!!serviceEnabled}
                              onChange={this.props.onSetServiceState}
                              aria-label={_("Alarms Enabled")} />);

        let mode;
        let cpuval;
        let memval;
        let freqval;
        let countval;

        if (!this.props.configSettings) {
            mode = "undefined";
            cpuval = "";
            memval = "";
            freqval = "";
            countval = "";
        } else {
            mode = this.props.configSettings.config._internal.MODE.value;
            cpuval = this.props.configSettings.config._internal.CPU.value;
            memval = this.props.configSettings.config._internal.MEM.value;
            freqval = this.props.configSettings.config._internal.FREQ.value;
            countval = this.props.configSettings.config._internal.COUNT.value;
        }

        let configButton;
        if (serviceEnabled) {
            configButton = (
                <Button variant="primary" onClick={this.handleConfigClick}>
                    {_("Configure Alarms")}
                </Button>
            );
        } else {
            const tooltip = _("Test is only available while the kdump service is running.");
            configButton = (
                <Tooltip id="tip-test" content={tooltip}>
                    <Button variant="secondry" isDisabled>
                        {_("Configure Alarms")}
                    </Button>
                </Tooltip>
            );
        }

        return (
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <Title headingLevel="h2" size="3xl">
                            {_("System Alarms")}
                        </Title>
                        {alarmsSwitch}
                    </Flex>
                </PageSection>
                <PageSection>
                    <Card>
                        <CardBody>
                            <DescriptionList className="pf-m-horizontal-on-sm">
                                <DescriptionListGroup>
                                    {serviceWaiting}
                                    <DescriptionListTerm>{_("Mode  ")}
                                        <Tooltip id="tip-config-info" content={tooltip_mode}>
                                            <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                        </Tooltip>
                                        {_(" : ")}
                                    </DescriptionListTerm>
                                    <DescriptionListDescription>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                            {mode}
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("CPU Threshold (0-100)%  ")}
                                        <Tooltip id="tip-config-info" content={tooltip_cpu}>
                                            <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                        </Tooltip>
                                        {_(" : ")}
                                    </DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {cpuval}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Memory Threshold (GB)  ")}
                                        <Tooltip id="tip-config-info" content={tooltip_mem}>
                                            <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                        </Tooltip>
                                        {_(" : ")}
                                    </DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {memval}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Pooling Frequency (Seconds)  ")}
                                        <Tooltip id="tip-config-info" content={tooltip_freq}>
                                            <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                        </Tooltip>
                                        {_(" : ")}
                                    </DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {freqval}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Failed Count (number)  ")}
                                        <Tooltip id="tip-config-info" content={tooltip_count}>
                                            <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                        </Tooltip>
                                        {_(" : ")}
                                    </DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {countval}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm />
                                    <DescriptionListDescription>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                            {configButton}
                                            <Tooltip id="tip-config-info" content={tooltip_info_button}>
                                                <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                            </Tooltip>
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                            </DescriptionList>
                        </CardBody>
                    </Card>
                </PageSection>
            </Page>
        );
    }
}
