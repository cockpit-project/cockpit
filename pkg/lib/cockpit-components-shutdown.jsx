/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { DatePicker } from "@patternfly/react-core/dist/esm/components/DatePicker/index.js";
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";

import { ServerTime } from 'serverTime.js';
import * as timeformat from "timeformat";
import { DialogsContext } from "dialogs.jsx";
import { FormHelper } from "cockpit-components-form-helper";

import { SimpleSelect } from "cockpit-components-simple-select";

import "cockpit-components-shutdown.scss";

const _ = cockpit.gettext;

export class ShutdownModal extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);
        this.date_spawn = null;
        this.wake_date_spawn = null;
        this.state = {
            error: "",
            dateError: "",
            message: "",
            isOpen: false,
            selected: "1",
            dateObject: undefined,
            startDate: undefined,
            date: "",
            time: "",
            when: "+1",
            formFilled: false,
            // Wake-up time fields (suspend mode only)
            wakeEnabled: false,
            wakeDateObject: undefined,
            wakeDate: "",
            wakeTime: "",
            wakeHour: null,
            wakeMinute: null,
            wakeError: "",
            wakeEpoch: null,
        };
        this.onSubmit = this.onSubmit.bind(this);
        this.updateDate = this.updateDate.bind(this);
        this.updateTime = this.updateTime.bind(this);
        this.calculate = this.calculate.bind(this);
        this.dateRangeValidator = this.dateRangeValidator.bind(this);
        this.updateWakeDate = this.updateWakeDate.bind(this);
        this.updateWakeTime = this.updateWakeTime.bind(this);
        this.calculateWake = this.calculateWake.bind(this);

        this.server_time = new ServerTime();
    }

    componentDidMount() {
        this.server_time.wait()
                .then(() => {
                    const dateObject = this.server_time.utc_fake_now;
                    const date = dateObject.toISOString().split("T")[0];
                    const hour = dateObject.getUTCHours();
                    const minute = dateObject.getUTCMinutes();
                    const timeStr = hour.toString().padStart(2, "0") + ":" + minute.toString().padStart(2, "0");
                    this.setState({
                        dateObject,
                        date,
                        startDate: new Date(dateObject.toDateString()),
                        time: timeStr,
                        // Initialize wake-up time fields to current time
                        wakeDate: date,
                        wakeDateObject: new Date(dateObject.toDateString()),
                        wakeTime: timeStr,
                        wakeHour: hour,
                        wakeMinute: minute,
                    });
                })
                .always(() => this.setState({ formFilled: true }));
    }

    updateDate(value, dateObject) {
        this.setState({ date: value, dateObject }, this.calculate);
    }

    updateTime(value, hour, minute) {
        this.setState({ time: value, hour, minute }, this.calculate);
    }

    calculate() {
        if (this.date_spawn)
            this.date_spawn.close("cancelled");

        if (this.state.selected != "x") {
            this.setState(prevState => ({
                when: "+" + prevState.selected,
                error: "",
                dateError: "",
            }), this.calculateWake);
            return;
        }

        const time_error = this.state.hour === null || this.state.minute === null;
        const date_error = !this.state.dateObject;

        if (time_error && date_error) {
            this.setState({ dateError: _("Invalid date format and invalid time format") }, this.calculateWake);
            return;
        } else if (time_error) {
            this.setState({ dateError: _("Invalid time format") }, this.calculateWake);
            return;
        } else if (date_error) {
            this.setState({ dateError: _("Invalid date format") }, this.calculateWake);
            return;
        }

        const cmd = ["date", "--date=" + (new Intl.DateTimeFormat('en-us').format(this.state.dateObject)) + " " + this.state.time, "+%s"];
        this.date_spawn = cockpit.spawn(cmd, { err: "message" });
        this.date_spawn.then(data => {
            const input_timestamp = parseInt(data, 10);
            const server_timestamp = parseInt(this.server_time.now.getTime() / 1000, 10);
            let offset = Math.ceil((input_timestamp - server_timestamp) / 60);

            /* If the time in minutes just changed, make it happen now */
            if (offset === -1) {
                offset = 0;
            } else if (offset < 0) { // Otherwise it is a failure
                this.setState({ dateError: _("Cannot schedule event in the past") }, this.calculateWake);
                return;
            }

            this.setState({
                when: "+" + offset,
                error: "",
                dateError: "",
            }, this.calculateWake);
        });
        this.date_spawn.catch(e => {
            if (e.problem == "cancelled")
                return;
            this.setState({ error: e.toString() }, this.calculateWake);
        });
        this.date_spawn.finally(() => { this.date_spawn = null });
    }

    updateWakeDate(value, dateObject) {
        this.setState({ wakeDate: value, wakeDateObject: dateObject }, this.calculateWake);
    }

    updateWakeTime(value, hour, minute) {
        this.setState({ wakeTime: value, wakeHour: hour, wakeMinute: minute }, this.calculateWake);
    }

    calculateWake() {
        if (!this.state.wakeEnabled)
            return;

        if (this.wake_date_spawn)
            this.wake_date_spawn.close("cancelled");

        const time_error = this.state.wakeHour === null || this.state.wakeMinute === null;
        const date_error = !this.state.wakeDateObject;

        if (time_error && date_error) {
            this.setState({ wakeError: _("Invalid date format and invalid time format") });
            return;
        } else if (time_error) {
            this.setState({ wakeError: _("Invalid time format") });
            return;
        } else if (date_error) {
            this.setState({ wakeError: _("Invalid date format") });
            return;
        }

        const cmd = ["date", "--date=" + (new Intl.DateTimeFormat('en-us').format(this.state.wakeDateObject)) + " " + this.state.wakeTime, "+%s"];
        this.wake_date_spawn = cockpit.spawn(cmd, { err: "message" });
        this.wake_date_spawn.then(data => {
            const wake_timestamp = parseInt(data, 10);
            const server_timestamp = parseInt(this.server_time.now.getTime() / 1000, 10);
            const delay_minutes = parseInt(this.state.when.substring(1), 10) || 0;
            const suspend_timestamp = server_timestamp + delay_minutes * 60;

            if (wake_timestamp <= suspend_timestamp) {
                this.setState({ wakeError: _("Wake-up time must be after the suspend time"), wakeEpoch: null });
                return;
            }

            this.setState({
                wakeEpoch: wake_timestamp,
                wakeError: "",
            });
        });
        this.wake_date_spawn.catch(e => {
            if (e.problem == "cancelled")
                return;
            this.setState({ wakeError: e.toString() });
        });
        this.wake_date_spawn.finally(() => { this.wake_date_spawn = null });
    }

    onSubmit(event) {
        const Dialogs = this.context;

        if (this.props.suspend) {
            const delay = this.state.when; // "+N" where N is minutes
            const minutes = parseInt(delay.substring(1), 10);
            let cmd;

            if (this.state.wakeEnabled && this.state.wakeEpoch) {
                // With wake-up time: use rtcwake
                if (minutes === 0) {
                    // Immediate suspend with RTC wake alarm
                    cmd = ["rtcwake", "-m", "mem", "-t", this.state.wakeEpoch.toString()];
                } else {
                    // Delayed suspend with RTC wake alarm: schedule via systemd-run
                    cmd = ["systemd-run", "--unit=cockpit-suspend", "--on-active=" + minutes + "m",
                           "bash", "-c", "rtcwake -m no -t " + this.state.wakeEpoch + " && systemctl suspend"];
                }
            } else {
                // Without wake-up time
                if (minutes === 0) {
                    cmd = ["systemctl", "suspend"];
                } else {
                    cmd = ["systemd-run", "--unit=cockpit-suspend", "--on-active=" + minutes + "m", "systemctl", "suspend"];
                }
            }
            cockpit.spawn(cmd, { superuser: "require", err: "message" })
                    .then(this.props.onClose || Dialogs.close)
                    .catch(e => this.setState({ error: e.toString() }));
        } else {
            const arg = this.props.shutdown ? "--poweroff" : "--reboot";
            if (!this.props.shutdown)
                cockpit.hint("restart");

            cockpit.spawn(["shutdown", arg, this.state.when, this.state.message], { superuser: "require", err: "message" })
                    .then(this.props.onClose || Dialogs.close)
                    .catch(e => this.setState({ error: e.toString() }));
        }

        event.preventDefault();
        return false;
    }

    dateRangeValidator(date) {
        if (this.state.startDate && date < this.state.startDate) {
            return _("Cannot schedule event in the past");
        }
        return '';
    }

    _getMode() {
        if (this.props.suspend) return "suspend";
        if (this.props.shutdown) return "shutdown";
        return "reboot";
    }

    render() {
        const mode = this._getMode();
        const Dialogs = this.context;
        const options = [
            { value: "0", content: _("No delay") },
            { decorator: "divider", key: "divider" },
            { value: "1", content: _("1 minute") },
            { value: "5", content: _("5 minutes") },
            { value: "20", content: _("20 minutes") },
            { value: "40", content: _("40 minutes") },
            { value: "60", content: _("60 minutes") },
            { decorator: "divider", key: "divider-2" },
            { value: "x", content: _("Specific time") },
        ];

        return (
            <Modal isOpen position="top" variant="medium"
                   onClose={this.props.onClose || Dialogs.close}
                   id="shutdown-dialog"
            >
                <ModalHeader title={mode === "suspend" ? _("Suspend to RAM") : (mode === "shutdown" ? _("Shut down") : _("Reboot"))} />
                <ModalBody>
                    <Form isHorizontal onSubmit={this.onSubmit}>
                        <FormGroup fieldId="message" label={_("Message to logged in users")}>
                            <TextArea id="message" resizeOrientation="vertical" value={this.state.message} onChange={(_, v) => this.setState({ message: v })} />
                            {mode === "suspend" && <HelperText><HelperTextItem variant="indeterminate">{_("Note: This message will not be sent for suspend operations.")}</HelperTextItem></HelperText>}
                        </FormGroup>
                        <FormGroup fieldId="delay" label={_("Delay")}>
                            <Flex className="shutdown-delay-group" alignItems={{ default: 'alignItemsCenter' }}>
                                <SimpleSelect
                                    toggleProps={{ id: "delay", className: 'shutdown-select-delay' }}
                                    options={options}
                                    selected={this.state.selected}
                                    isDisabled={!this.state.formFilled}
                                    onSelect={s => this.setState({ selected: s }, this.calculate)} />
                                {this.state.selected === "x" && <>
                                    <DatePicker aria-label={_("Pick date")}
                                                buttonAriaLabel={_("Toggle date picker")}
                                                className='shutdown-date-picker'
                                                invalidFormatText=""
                                                isDisabled={!this.state.formFilled}
                                                locale={timeformat.dateFormatLang()}
                                                weekStart={timeformat.firstDayOfWeek()}
                                                onBlur={this.calculate}
                                                onChange={(_, d, ds) => this.updateDate(d, ds)}
                                                validators={[this.dateRangeValidator]}
                                                value={this.state.date}
                                                appendTo={() => document.body} />
                                    <TimePicker time={this.state.time} is24Hour
                                                className='shutdown-time-picker'
                                                id="shutdown-time"
                                                isDisabled={!this.state.formFilled}
                                                invalidFormatErrorMessage=""
                                                menuAppendTo={() => document.body}
                                                onBlur={this.calculate}
                                                onChange={(_, time, h, m) => this.updateTime(time, h, m) } />
                                </>}
                            </Flex>
                            <FormHelper fieldId="delay" helperTextInvalid={this.state.dateError} />
                        </FormGroup>
                        {mode === "suspend" && <FormGroup fieldId="wake-up-time" label={_("Wake-up time")}>
                            <Switch id="wake-up-toggle"
                                    label={_("Set wake-up time")}
                                    isChecked={this.state.wakeEnabled}
                                    onChange={(_, checked) => this.setState({ wakeEnabled: checked, wakeError: "", wakeEpoch: null }, () => { if (checked) this.calculateWake() })} />
                            {this.state.wakeEnabled && <>
                                <Flex className="shutdown-delay-group" alignItems={{ default: 'alignItemsCenter' }}>
                                    <DatePicker aria-label={_("Pick wake date")}
                                                buttonAriaLabel={_("Toggle wake date picker")}
                                                className='shutdown-date-picker'
                                                invalidFormatText=""
                                                isDisabled={!this.state.formFilled}
                                                locale={timeformat.dateFormatLang()}
                                                weekStart={timeformat.firstDayOfWeek()}
                                                onBlur={this.calculateWake}
                                                onChange={(_, d, ds) => this.updateWakeDate(d, ds)}
                                                validators={[this.dateRangeValidator]}
                                                value={this.state.wakeDate}
                                                appendTo={() => document.body} />
                                    <TimePicker time={this.state.wakeTime} is24Hour
                                                className='shutdown-time-picker'
                                                id="wake-time"
                                                isDisabled={!this.state.formFilled}
                                                invalidFormatErrorMessage=""
                                                menuAppendTo={() => document.body}
                                                onBlur={this.calculateWake}
                                                onChange={(_, time, h, m) => this.updateWakeTime(time, h, m)} />
                                </Flex>
                                <FormHelper fieldId="wake-up-time" helperTextInvalid={this.state.wakeError} />
                            </>}
                        </FormGroup>}
                    </Form>
                    {this.state.error && <Alert isInline variant='danger' title={this.state.error} />}
                </ModalBody>
                <ModalFooter>
                    <Button variant='danger' isDisabled={this.state.error || this.state.dateError || (this.state.wakeEnabled && (this.state.wakeError || !this.state.wakeEpoch))} onClick={this.onSubmit}>{mode === "suspend" ? _("Suspend") : (mode === "shutdown" ? _("Shut down") : _("Reboot"))}</Button>
                    <Button variant='link' onClick={this.props.onClose || Dialogs.close}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        );
    }
}
