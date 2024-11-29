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

import cockpit from "cockpit";
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
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
        };
        this.onSubmit = this.onSubmit.bind(this);
        this.updateDate = this.updateDate.bind(this);
        this.updateTime = this.updateTime.bind(this);
        this.calculate = this.calculate.bind(this);
        this.dateRangeValidator = this.dateRangeValidator.bind(this);

        this.server_time = new ServerTime();
    }

    componentDidMount() {
        this.server_time.wait()
                .then(() => {
                    const dateObject = this.server_time.utc_fake_now;
                    const date = dateObject.toISOString().split("T")[0];
                    const hour = dateObject.getUTCHours();
                    const minute = dateObject.getUTCMinutes();
                    this.setState({
                        dateObject,
                        date,
                        startDate: new Date(dateObject.toDateString()),
                        time: hour.toString().padStart(2, "0") + ":" + minute.toString().padStart(2, "0"),
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
            }));
            return;
        }

        const time_error = this.state.hour === null || this.state.minute === null;
        const date_error = !this.state.dateObject;

        if (time_error && date_error) {
            this.setState({ dateError: _("Invalid date format and invalid time format") });
            return;
        } else if (time_error) {
            this.setState({ dateError: _("Invalid time format") });
            return;
        } else if (date_error) {
            this.setState({ dateError: _("Invalid date format") });
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
                this.setState({ dateError: _("Cannot schedule event in the past") });
                return;
            }

            this.setState({
                when: "+" + offset,
                error: "",
                dateError: "",
            });
        });
        this.date_spawn.catch(e => {
            if (e.problem == "cancelled")
                return;
            this.setState({ error: e.toString() });
        });
        this.date_spawn.finally(() => { this.date_spawn = null });
    }

    onSubmit(event) {
        const Dialogs = this.context;
        const arg = this.props.shutdown ? "--poweroff" : "--reboot";
        if (!this.props.shutdown)
            cockpit.hint("restart");

        cockpit.spawn(["shutdown", arg, this.state.when, this.state.message], { superuser: "require", err: "message" })
                .then(this.props.onClose || Dialogs.close)
                .catch(e => this.setState({ error: e.toString() }));

        event.preventDefault();
        return false;
    }

    dateRangeValidator(date) {
        if (this.state.startDate && date < this.state.startDate) {
            return _("Cannot schedule event in the past");
        }
        return '';
    }

    render() {
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
                   title={this.props.shutdown ? _("Shut down") : _("Reboot")}
                   footer={<>
                       <Button variant='danger' isDisabled={this.state.error || this.state.dateError} onClick={this.onSubmit}>{this.props.shutdown ? _("Shut down") : _("Reboot")}</Button>
                       <Button variant='link' onClick={this.props.onClose || Dialogs.close}>{_("Cancel")}</Button>
                   </>}
            >
                <>
                    <Form isHorizontal onSubmit={this.onSubmit}>
                        <FormGroup fieldId="message" label={_("Message to logged in users")}>
                            <TextArea id="message" resizeOrientation="vertical" value={this.state.message} onChange={(_, v) => this.setState({ message: v })} />
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
                    </Form>
                    {this.state.error && <Alert isInline variant='danger' title={this.state.error} />}
                </>
            </Modal>
        );
    }
}
