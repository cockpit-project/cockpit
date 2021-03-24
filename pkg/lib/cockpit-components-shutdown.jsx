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

import moment from "moment";
import cockpit from "cockpit";
import React from 'react';
import {
    Button, Select, SelectOption, Modal, Alert, Flex, Form,
    Divider, FormGroup, TextArea, DatePicker,
    TimePicker,
} from '@patternfly/react-core';

import { ServerTime } from 'serverTime.js';
import { validateTime } from 'timepicker-helpers.js';

import "cockpit-components-shutdown.scss";

const _ = cockpit.gettext;

export class ShutdownModal extends React.Component {
    constructor(props) {
        super(props);
        this.date_spawn = null;
        this.state = {
            error: "",
            dateError: "",
            message: "",
            isOpen: false,
            selected: "1",
            date: "",
            today: "",
            time: "",
            when: "+1",
        };
        this.onSubmit = this.onSubmit.bind(this);
        this.updateDatetime = this.updateDatetime.bind(this);
        this.calculate = this.calculate.bind(this);

        this.server_time = new ServerTime();
    }

    componentDidMount() {
        this.server_time.wait().then(() => {
            const date = new Date(this.server_time.utc_fake_now);
            const hour = this.server_time.utc_fake_now.getUTCHours();
            const minute = this.server_time.utc_fake_now.getUTCMinutes();
            this.setState({
                date: date,
                today: date,
                time: hour.toString().padStart(2, "0") + ":" + minute.toString().padStart(2, "0"),
            });
        });
    }

    updateDatetime(key, value) {
        this.setState({ [key] : value }, this.calculate);
    }

    calculate() {
        if (this.date_spawn)
            this.date_spawn.close("cancelled");

        if (this.state.selected != "x") {
            this.setState({
                when: "+" + this.state.selected,
                error: "",
                dateError: "",
            });
            return;
        }

        const time_error = !validateTime(this.state.time);
        const date = this.state.date;

        let date_error = false;

        if (!date || isNaN(date.getTime()) || date.getTime() < 0)
            date_error = true;

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

        const cmd = ["date", "--date=" + moment(date).format('YYYY-MM-DD') + " " + this.state.time, "+%s"];
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
            this.setState({ error: e });
        });
        this.date_spawn.finally(() => { this.date_spawn = null });
    }

    onSubmit() {
        const arg = this.props.shutdown ? "--poweroff" : "--reboot";
        if (!this.props.shutdown)
            cockpit.hint("restart");

        cockpit.spawn(["shutdown", arg, this.state.when, this.state.message], { superuser: true, err: "message" })
                .then(this.props.onClose)
                .catch(e => this.setState({ error: e }));
    }

    render() {
        const options = [
            <SelectOption value="0" key="0">{_("No delay")}</SelectOption>,
            <Divider key="divider" component="li" />,
            <SelectOption value="1" key="1">{_("1 minute")}</SelectOption>,
            <SelectOption value="5" key="5">{_("5 minutes")}</SelectOption>,
            <SelectOption value="20" key="20">{_("20 minutes")}</SelectOption>,
            <SelectOption value="40" key="40">{_("40 minutes")}</SelectOption>,
            <SelectOption value="60" key="60">{_("60 minutes")}</SelectOption>,
            <Divider key="divider-2" component="li" />,
            <SelectOption value="x" key="x">{_("Specific time")}</SelectOption>
        ];

        return (
            <Modal isOpen position="top" variant="medium"
                   onClose={this.props.onClose}
                   id="shutdown-dialog"
                   title={this.props.shutdown ? _("Shut down") : _("Reboot")}
                   footer={<>
                       <Button variant='danger' isDisabled={this.state.error || this.state.dateError} onClick={this.onSubmit}>{this.props.shutdown ? _("Shut down") : _("Reboot")}</Button>
                       <Button variant='link' onClick={this.props.onClose}>{_("Cancel")}</Button>
                   </>}
            >
                <>
                    <Form isHorizontal>
                        <FormGroup fieldId="message" label={_("Message to logged in users")}>
                            <TextArea id="message" resizeOrientation="vertical" value={this.state.message} onChange={v => this.setState({ message: v })} />
                        </FormGroup>
                        <FormGroup fieldId="delay" label={_("Delay")}
                                   helperTextInvalid={this.state.dateError}
                                   validated={this.state.dateError ? "error" : "default"}>
                            <Flex alignItems={{ default: 'alignItemsCenter' }}>
                                <Select toggleId="delay" isOpen={this.state.isOpen} selections={this.state.selected}
                                        className='shutdown-select-delay'
                                        onToggle={o => this.setState({ isOpen: o })} menuAppendTo="parent"
                                        onSelect={(e, s) => this.setState({ selected: s, isOpen: false }, this.calculate)}>
                                    {options}
                                </Select>
                                {this.state.selected === "x" && <>
                                    <DatePicker aria-label={_("Pick date")} locale={cockpit.language} dateFormat={d => moment(d).format('L')}
                                                className='shutdown-date-picker'
                                                invalidFormatText="" dateParse={d => moment(d, 'L').toDate()}
                                                value={moment(this.state.date).format('L')} onChange={(d, ds) => this.updateDatetime("date", ds)} />
                                    <TimePicker defaultTime={this.state.time} is24Hour
                                                className='shutdown-time-picker'
                                                id="shutdown-time"
                                                invalidFormatErrorMessage=""
                                                menuAppendTo={() => document.body}
                                                onChange={time => this.updateDatetime("time", time) } />
                                </>}
                            </Flex>
                        </FormGroup>
                    </Form>
                    {this.state.error && <Alert isInline variant='danger' title={this.state.error} />}
                </>
            </Modal>
        );
    }
}
