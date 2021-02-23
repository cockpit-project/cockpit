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

import cockpit from 'cockpit';
import React, { useState } from 'react';
import {
    Button,
    DatePicker,
    Form, FormGroup, FormHelperText,
    FormSelect, FormSelectOption,
    Modal,
    TextInput,
    TimePicker,
} from '@patternfly/react-core';
import { MinusIcon, PlusIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';

import { updateTime } from './services.jsx';
import { create_timer } from './timer-dialog-helpers.js';

import "./timers.scss";

const _ = cockpit.gettext;

export const CreateTimerDialog = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button key='create-timer-action'
                    variant="secondary"
                    id="create-timer"
                    onClick={() => {
                        updateTime();
                        setIsOpen(true);
                    }}>
                {_("Create timer")}
            </Button>
            {isOpen && <CreateTimerDialogBody setIsOpen={setIsOpen} />}
        </>
    );
};

const CreateTimerDialogBody = ({ setIsOpen }) => {
    const [command, setCommand] = useState('');
    const [delay, setDelay] = useState('specific-time');
    const [delayNumber, setDelayNumber] = useState(0);
    const [delayUnit, setDelayUnit] = useState('sec');
    const [description, setDescription] = useState('');
    const [dialogError, setDialogError] = useState(undefined);
    const [inProgress, setInProgress] = useState(false);
    const [name, setName] = useState('');
    const [repeat, setRepeat] = useState('no');
    const [repeatPatterns, setRepeatPatterns] = useState([]);
    const [specificTime, setSpecificTime] = useState("00:00");
    const [submitted, setSubmitted] = useState(false);
    const validationFailed = {};

    if (!name.trim().length || !/^[a-zA-Z0-9:_.@-]+$/.test(name))
        validationFailed.name = true;
    if (!description.trim().length)
        validationFailed.description = true;
    if (!command.trim().length)
        validationFailed.command = true;

    const timePicker = (idx) => (
        <TimePicker className="create-timer-time-picker"
                    defaultTime="00:00"
                    is24Hour
                    menuAppendTo={() => document.body}
                    onChange={time => {
                        const arr = [...repeatPatterns];
                        arr[idx].time = time;
                        setRepeatPatterns(arr);
                    }}
        />
    );

    return (
        <Modal id="timer-dialog"
           className="timer-dialog" position="top" variant="medium" isOpen onClose={() => setIsOpen(false)}
           title={cockpit.format(_("Create timers"), name)}
           footer={
               <>
                   {dialogError && <ModalError dialogError={_("Timer creation failed")} dialogErrorDetail={dialogError} />}
                   <Button variant='primary'
                           id="timer-save-button"
                           isLoading={inProgress}
                           isDisabled={inProgress}
                           onClick={() => {
                               setSubmitted(true);

                               if (Object.keys(validationFailed).length)
                                   return;

                               setInProgress(true);
                               create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, specificTime, repeatPatterns })
                                       .then(() => setIsOpen(false), exc => {
                                           setDialogError(exc.message);
                                           setInProgress(false);
                                       });
                           }}>
                       {_("Save")}
                   </Button>
                   <Button variant='link' onClick={() => setIsOpen(false)}>
                       {_("Cancel")}
                   </Button>
               </>
           }>
            <Form isHorizontal>
                <FormGroup label={_("Service name")}
                           fieldId="servicename"
                           validated={submitted && validationFailed.name ? "error" : "default"}
                           helperTextInvalid={!name.trim().length ? _("This field cannot be empty") : _("Only alphabets, numbers, : , _ , . , @ , - are allowed")}>
                    <TextInput id='servicename'
                               value={name}
                               validated={submitted && validationFailed.name ? "error" : "default"}
                               onChange={setName} />
                </FormGroup>
                <FormGroup label={_("Description")}
                           fieldId="description"
                           validated={submitted && validationFailed.description ? "error" : "default"}
                           helperTextInvalid={_("This field cannot be empty")}>
                    <TextInput id='description'
                               value={description}
                               validated={submitted && validationFailed.description ? "error" : "default"}
                               onChange={setDescription} />
                </FormGroup>
                <FormGroup label={_("Command")}
                           fieldId="command"
                           validated={submitted && validationFailed.command ? "error" : "default"}
                           helperTextInvalid={_("This field cannot be empty")}>
                    <TextInput id='command'
                               value={command}
                               validated={submitted && validationFailed.command ? "error" : "default"}
                               onChange={setCommand} />
                </FormGroup>
                <FormGroup label={_("Run")}>
                    <FormSelect id="boot-or-specific-time"
                                value={delay}
                                onChange={setDelay}
                                aria-label={_("Run")}>
                        <FormSelectOption value="system-boot"
                                          label={_("After system boot")} />
                        <FormSelectOption value="specific-time"
                                          label={_("At specific time")} />
                    </FormSelect>
                    { delay == "system-boot" && <FormGroup className="service-run delay-group" label={_("After")}>
                        <TextInput value={delayNumber}
                                   validated={submitted && validationFailed.delayNumber ? "error" : "default"}
                                   onChange={setDelayNumber} />
                        <FormSelect className="delay-unit"
                                    value={delayUnit}
                                    onChange={setDelayUnit}
                                    aria-label={_("After")}>
                            <FormSelectOption value="sec" label={_("Seconds")} />
                            <FormSelectOption value="min" label={_("Minutes")} />
                            <FormSelectOption value="hr" label={_("Hours")} />
                            <FormSelectOption value="weeks" label={_("Weeks")} />
                        </FormSelect>
                    </FormGroup> }
                    { delay == "specific-time" && <FormGroup className="service-run" label={_("Repeat")}>
                        <FormSelect value={repeat}
                                    id="drop-repeat"
                                    onChange={value => {
                                        if (value == repeat)
                                            return;

                                        setRepeat(value);
                                        if (value == "hourly")
                                            setRepeatPatterns([{ key: 0, minute: "0" }]);
                                        else if (value == "daily")
                                            setRepeatPatterns([{ key: 0, time: "00:00" }]);
                                        else if (value == "weekly")
                                            setRepeatPatterns([{ key: 0, day: "mon", time: "00:00" }]);
                                        else if (value == "monthly")
                                            setRepeatPatterns([{ key: 0, day: 1, time: "00:00" }]);
                                        else if (value == "yearly")
                                            setRepeatPatterns([{ key: 0, date: undefined, time: "00:00" }]);
                                    }}
                                    aria-label={_("Repeat")}>
                            <FormSelectOption value="no" label={_("Don't repeat")} />
                            <FormSelectOption value="hourly" label={_("Hourly")} />
                            <FormSelectOption value="daily" label={_("Daily")} />
                            <FormSelectOption value="weekly" label={_("Weekly")} />
                            <FormSelectOption value="monthly" label={_("Monthly")} />
                            <FormSelectOption value="yearly" label={_("Yearly")} />
                        </FormSelect>
                        {repeat == "no" && <TimePicker className="create-timer-time-picker specific-no-repeat"
                                                       menuAppendTo={() => document.body} defaultTime="00:00" is24Hour onChange={setSpecificTime} />}
                        {repeatPatterns.map((item, idx) => {
                            const min = repeatPatterns[idx].minute;
                            const validationFailedMinute = !(/^[0-9]+$/.test(min) && min <= 59 && min >= 0);

                            return (
                                <div className="specific-repeat-group" data-index={idx} key={item.key}>
                                    {repeat == "hourly" && <>
                                        <TextInput className='delay-number'
                                                   value={repeatPatterns[idx].minute}
                                                   onChange={minute => {
                                                       const arr = [...repeatPatterns];
                                                       arr[idx].minute = minute;
                                                       setRepeatPatterns(arr);
                                                   }}
                                                   validated={submitted && validationFailedMinute ? "error" : "default"} />
                                        {submitted && validationFailedMinute && <FormHelperText isError isHidden={false}>{_("Minute needs to be a number between 0-59")}</FormHelperText>}
                                    </>}
                                    {repeat == "daily" && timePicker(idx)}
                                    {repeat == "weekly" && <>
                                        <FormSelect value={repeatPatterns[idx].day}
                                                    className="week-days"
                                                    onChange={day => {
                                                        const arr = [...repeatPatterns];
                                                        arr[idx].day = day;
                                                        setRepeatPatterns(arr);
                                                    }}
                                                    aria-label={_("Repeat weekly")}>
                                            <FormSelectOption value="mon" label={_("Mondays")} />
                                            <FormSelectOption value="tue" label={_("Tuesdays")} />
                                            <FormSelectOption value="wed" label={_("Wednesdays")} />
                                            <FormSelectOption value="thu" label={_("Thursdays")} />
                                            <FormSelectOption value="fri" label={_("Fridays")} />
                                            <FormSelectOption value="sat" label={_("Saturdays")} />
                                            <FormSelectOption value="sun" label={_("Sundays")} />
                                        </FormSelect>
                                        {timePicker(idx)}
                                    </>}
                                    {repeat == "monthly" && <>
                                        <FormSelect value={repeatPatterns[idx].day}
                                                    className="month-days"
                                                    onChange={day => {
                                                        const arr = [...repeatPatterns];
                                                        arr[idx].day = day;
                                                        setRepeatPatterns(arr);
                                                    }}
                                                    aria-label={_("Repeat monthtly")}>
                                            {[_("1st"), _("2nd"), _("3rd"), _("4th"), _("5th"),
                                                _("6th"), _("7th"), _("8th"), _("9th"), _("10th"),
                                                _("11th"), _("12th"), _("13th"), _("14th"), _("15th"),
                                                _("16th"), _("17th"), _("18th"), _("19th"), _("20th"),
                                                _("21th"), _("22th"), _("23th"), _("24th"), _("25th"),
                                                _("26th"), _("27th"), _("28th"), _("29th"), _("30th"), _("31st")
                                            ].map((day, index) => <FormSelectOption key={day} value={index + 1} label={day} />)}
                                        </FormSelect>
                                        {timePicker(idx)}
                                    </>}
                                    {repeat == "yearly" && <>
                                        <DatePicker onChange={(str, data) => {
                                            const arr = [...repeatPatterns];
                                            arr[idx].date = str;
                                            setRepeatPatterns(arr);
                                        }} />
                                        {timePicker(idx)}
                                    </>}
                                    {repeat !== "no" && <span className="action-group">
                                        <Button aria-label={_("Remove")}
                                                variant="secondary"
                                                isDisabled={repeatPatterns.length == 1}
                                                isSmall
                                                onClick={() => setRepeatPatterns(repeatPatterns.filter((item, item_idx) => idx != item_idx))}>
                                            <MinusIcon />
                                        </Button>
                                        <Button aria-label={_("Add")}
                                                variant="secondary"
                                                isSmall
                                                onClick={() => {
                                                    if (repeat == "hourly")
                                                        setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, minute: "0" }]);
                                                    else if (repeat == "daily")
                                                        setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, time: "00:00" }]);
                                                    else if (repeat == "weekly")
                                                        setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, day: "mon", time: "00:00" }]);
                                                    else if (repeat == "monthly")
                                                        setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, day: 1, time: "00:00" }]);
                                                    else if (repeat == "yearly")
                                                        setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, date: undefined, time: "00:00" }]);
                                                }}>
                                            <PlusIcon />
                                        </Button>
                                    </span>}
                                </div>
                            );
                        })}
                    </FormGroup> }
                </FormGroup>
            </Form>
        </Modal>
    );
};
