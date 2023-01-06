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
    Flex, FlexItem,
    Form, FormGroup,
    FormSelect, FormSelectOption,
    InputGroup,
    Modal,
    Radio,
    TextInput,
    TimePicker,
} from '@patternfly/react-core';
import { MinusIcon, PlusIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { useDialogs } from "dialogs.jsx";

import { updateTime } from './services.jsx';
import { create_timer } from './timer-dialog-helpers.js';
import * as timeformat from "timeformat.js";

import "./timers.scss";

const _ = cockpit.gettext;

export const CreateTimerDialog = ({ owner, isLoading }) => {
    const Dialogs = useDialogs();
    return (
        <Button key='create-timer-action'
                variant="secondary"
                id="create-timer"
                isDisabled={isLoading}
                onClick={() => {
                    updateTime();
                    Dialogs.show(<CreateTimerDialogBody owner={owner} />);
                }}>
            {_("Create timer")}
        </Button>
    );
};

const CreateTimerDialogBody = ({ owner }) => {
    const Dialogs = useDialogs();
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
    const [isSpecificTimeOpen, setSpecificTimeOpen] = useState(false);
    const [commandNotFound, setCommandNotFound] = useState(false);
    const [validationFailed, setValidationFailed] = useState({});
    const [validForm, setValidForm] = useState(false);

    const validate = async (event) => {
        if (!event)
            return;

        const { id, value } = event.target;
        let notValid = true;
        setDialogError("");

        switch (id) {
        case 'servicename': {
            if (value.trim().length && /^[a-zA-Z0-9:_.@-]+$/.test(value))
                notValid = false;
            break;
        }
        case 'description': {
            if (value.trim().length)
                notValid = false;
            break;
        }
        case 'command': {
            if (!command.trim().length)
                break;
            const command_parts = command.split(" ");
            setInProgress(true);
            try {
                await cockpit.spawn(["test", "-f", command_parts[0]], { err: "ignore" });
                notValid = false;
            } catch {
                setCommandNotFound(true);
            }
            setInProgress(false);
            break;
        }
        case 'delay-number': {
            if (/^[0-9]+$/.test(value))
                notValid = false;
            break;
        }
        case 'custom': {
            if (!value.trim().length)
                break;
            setInProgress(true);
            try {
                await cockpit.spawn(["systemd-analyze", "calendar", value.trim()]);
                notValid = false;
            } catch {}
            setInProgress(false);
            break;
        }
        // invalidate base form items.
        default: {
            setValidationFailed(validationFailed => ({
                servicename: true,
                description: true,
                command: true
            }));
            return;
        }
        }
        setValidationFailed(validationFailed => ({
            ...validationFailed,
            [id]: notValid
        }));
        if (notValid)
            setValidForm(false);
    };

    const timePicker = (idx) => (
        <TimePicker className="create-timer-time-picker"
                    time={repeatPatterns[idx].time || "00:00"}
                    is24Hour
                    isOpen={repeatPatterns[idx].isOpen || false}
                    setIsOpen={isOpen => {
                        const arr = JSON.parse(JSON.stringify(repeatPatterns));
                        arr[idx].isOpen = isOpen;
                        setRepeatPatterns(arr);
                    }}
                    menuAppendTo={() => document.body}
                    onChange={time => {
                        const arr = JSON.parse(JSON.stringify(repeatPatterns));
                        arr[idx].time = time;
                        setRepeatPatterns(arr);
                    }}
        />
    );

    const onSubmit = (event) => {
        if (!event)
            return false;

        let failed = false;
        let failMessage = _("Please complete the form");

        event.preventDefault();

        while (!failed) {
            // Check if the form has ever been validated if not immediate form failure.
            if (!Object.keys(validationFailed).length) {
                validate(event);
                failed = true;
            }
            // If the form base checkValidity isnt valid then check the inputs again.  this wont fail the submission unless there is an issue.  Failure will happen in the next check.
            if (!event.target.checkValidity()) {
                // Loop the form data keys and do some checks.  Note this ignores the repeating values.  those are captured with validation
                const formData = new FormData(event.target);
                for (const key of formData.keys()) {
                    if (key == "boot-or-specific-time")
                        continue;
                    const input = document.querySelector('#' + key);
                    if (input === 'undefined') {
                        validate(event);
                        failMessage = _("Unknown form input issue");
                        failed = true;
                    }
                    if (validationFailed[key] !== 0) {
                        input.dispatchEvent(new Event('blur'));
                    }
                }
            }
            // Confirm if any inputs are invalid
            if (Object.values(validationFailed).includes(true))
                failed = true;
            // Check trigger specific validation
            switch (delay) {
            case 'specific-time': {
                // Need yearly check as it doesnt have a default
                switch (repeat) {
                case 'yearly': {
                    const check = repeatPatterns.find(pattern => {
                        return !pattern.date;
                    });
                    if (check)
                        failed = true;
                    break;
                }
                }
                break;
            }
            // Nothing to validate at this time.
            case 'system-boot': {
                break;
            }
            }
        }
        if (failed) {
            setDialogError(failMessage);
            setValidForm(false);
            return false;
        }

        setInProgress(true);

        create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, specificTime, repeatPatterns, owner })
                .then(Dialogs.close, exc => {
                    setDialogError(exc.message);
                    setInProgress(false);
                });

        return false;
    };

    const formCheck = (event) => {
        const F = document.getElementById('timerForm');
        setValidForm(F.checkValidity());
    };

    return (
        <Modal id="timer-dialog"
           className="timer-dialog" position="top" variant="medium" isOpen onClose={Dialogs.close}
           aria-label={_("Create timer dialog")}
           title={cockpit.format(_("Create timer"), name)}
           footer={
               <>
                   <Button variant='primary'
                           id="timer-save-button"
                           isLoading={inProgress}
                           isDisabled={inProgress || commandNotFound || !validForm}
                           form="timerForm"
                           onClick={onSubmit}>
                       {_("Save")}
                   </Button>
                   <Button variant='link' onClick={Dialogs.close}>
                       {_("Cancel")}
                   </Button>
               </>
           }>
            {dialogError && <ModalError dialogError={_("Timer creation failed")} dialogErrorDetail={dialogError} />}
            <Form isHorizontal id='timerForm' onSubmit={onSubmit} onChange={formCheck}>
                <FormGroup label={_("Name")}
                           isRequired
                           fieldId="servicename"
                           validated={validationFailed.servicename ? "error" : "default"}
                           helperTextInvalid={!name.trim().length ? _("This field cannot be empty") : _("Only alphabets, numbers, : , _ , . , @ , - are allowed")}>
                    <TextInput id='servicename'
                               isRequired
                               value={name}
                               validated={validationFailed.servicename ? "error" : "default"}
                               onBlur={validate}
                               onChange={setName} />
                </FormGroup>
                <FormGroup label={_("Description")}
                           isRequired
                           fieldId="description"
                           validated={validationFailed.description ? "error" : "default"}
                           helperTextInvalid={_("This field cannot be empty")}>
                    <TextInput id='description'
                               isRequired
                               value={description}
                               validated={validationFailed.description ? "error" : "default"}
                               onBlur={validate}
                               onChange={setDescription} />
                </FormGroup>
                <FormGroup label={_("Command")}
                           isRequired
                           fieldId="command"
                           validated={validationFailed.command ? "error" : "default"}
                           helperTextInvalid={commandNotFound ? _("Command not found") : _("This field cannot be empty")}>
                    <TextInput id='command'
                               isRequired
                               value={command}
                               validated={validationFailed.command ? "error" : "default"}
                               onBlur={validate}
                               onChange={str => { setCommandNotFound(false); setCommand(str) }} />
                </FormGroup>
                <FormGroup label={_("Trigger")} hasNoPaddingTop>
                    <Flex>
                        <Radio value="specific-time"
                               id="specific-time"
                               name="boot-or-specific-time"
                               onChange={() => {
                                   setDelay("specific-time");
                                   formCheck();
                               }}
                               isChecked={delay == "specific-time"}
                               label={_("At specific time")} />
                        <Radio value="system-boot"
                               id="system-boot"
                               name="boot-or-specific-time"
                               onChange={() => {
                                   setDelay("system-boot");
                                   formCheck();
                               }}
                               isChecked={delay == "system-boot"}
                               label={_("After system boot")} />
                    </Flex>
                    { delay == "system-boot" &&
                    <FormGroup className="delay-group"
                               isRequired
                               label={_("Delay")}
                               validated={validationFailed['delay-number'] ? "error" : "default"}
                               helperTextInvalid={_("Delay must be a number")}>
                        <Flex>
                            <TextInput className="delay-number"
                                       aria-label={_("Delay in seconds")}
                                       isRequired
                                       value={delayNumber}
                                       validated={validationFailed['delay-number'] ? "error" : "default"}
                                       onBlur={validate}
                                       onChange={setDelayNumber} />
                            <FormSelect className="delay-unit"
                                        value={delayUnit}
                                        onChange={setDelayUnit}
                                        aria-label={_("Delay")}>
                                <FormSelectOption value="sec" label={_("Seconds")} />
                                <FormSelectOption value="min" label={_("Minutes")} />
                                <FormSelectOption value="hr" label={_("Hours")} />
                                <FormSelectOption value="weeks" label={_("Weeks")} />
                            </FormSelect>
                        </Flex>
                    </FormGroup> }
                    { delay == "specific-time" &&
                    <>
                        <FormGroup label={_("Repeat")}>
                            <FormSelect value={repeat}
                                        id="drop-repeat"
                                        onChange={value => {
                                            if (value == repeat)
                                                return;

                                            setRepeat(value);
                                            if (value == "minutely")
                                                setRepeatPatterns([{ key: 0, second: "0" }]);
                                            else if (value == "hourly")
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
                                <FormSelectOption value="minutely" label={_("Minutely")} />
                                <FormSelectOption value="hourly" label={_("Hourly")} />
                                <FormSelectOption value="daily" label={_("Daily")} />
                                <FormSelectOption value="weekly" label={_("Weekly")} />
                                <FormSelectOption value="monthly" label={_("Monthly")} />
                                <FormSelectOption value="yearly" label={_("Yearly")} />
                            </FormSelect>
                        </FormGroup>
                        {repeat == "no" &&
                        <FormGroup label={_("Run at")}>
                            <TimePicker className="create-timer-time-picker specific-no-repeat"
                                        isOpen={isSpecificTimeOpen} setIsOpen={setSpecificTimeOpen}
                                        menuAppendTo={() => document.body} time={specificTime} is24Hour onChange={setSpecificTime} />
                        </FormGroup>}
                        {repeatPatterns.map((item, idx) => {
                            let label;
                            if (repeat == "minutely")
                                label = _("At second");
                            else if (repeat == "hourly")
                                label = _("At minute");
                            else if (repeat == "daily")
                                label = _("Run at");
                            else if (repeat == "weekly" || repeat == "monthly" || repeat == "yearly")
                                label = _("Run on");

                            const repeatValidate = (event) => {
                                if (!event) return;
                                let helperTextInvalid;
                                switch (event.target.id) {
                                case 'hourly': {
                                    helperTextInvalid = _("Minute needs to be a number between 0-59");
                                    break;
                                }
                                case 'minutely': {
                                    helperTextInvalid = _("Second needs to be a number between 0-59");
                                    break;
                                }
                                case 'yearly': {
                                    helperTextInvalid = _("Please enter valid date.  Example YYYY-MM-DD");
                                    break;
                                }
                                }
                                const validated = !event.target.checkValidity() ? "error" : "default";
                                const arr = [...repeatPatterns];
                                arr[idx].helperTextInvalid = helperTextInvalid;
                                arr[idx].validated = validated;
                                setRepeatPatterns(arr);
                                if (validated == 'default') {
                                    setDialogError();
                                    formCheck();
                                }
                            };

                            return (
                                <FormGroup label={label} key={item.key}
                                           validated={repeatPatterns[idx].validated}
                                           helperTextInvalid={repeatPatterns[idx].helperTextInvalid}>
                                    <Flex className="specific-repeat-group" data-index={idx}>
                                        {repeat == "minutely" &&
                                            <TextInput className='delay-number'
                                                       id={repeat}
                                                       isRequired
                                                       value={repeatPatterns[idx].second}
                                                       onBlur={repeatValidate}
                                                       onChange={second => {
                                                           const arr = [...repeatPatterns];
                                                           arr[idx].second = second;
                                                           setRepeatPatterns(arr);
                                                       }}
                                                       pattern='^[0-9]+$'
                                                       type='number'
                                                       min='0'
                                                       max='59'
                                                       validated={repeatPatterns[idx].validated} />
                                        }
                                        {repeat == "hourly" && <>
                                            <TextInput className='delay-number'
                                                       id={repeat}
                                                       isRequired
                                                       value={repeatPatterns[idx].minute}
                                                       onBlur={repeatValidate}
                                                       onChange={minute => {
                                                           const arr = [...repeatPatterns];
                                                           arr[idx].minute = minute;
                                                           setRepeatPatterns(arr);
                                                       }}
                                                       pattern='^[0-9]+$'
                                                       type='number'
                                                       min='0'
                                                       max='59'
                                                       validated={repeatPatterns[idx].validated} />
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
                                                        aria-label={_("Repeat monthly")}>
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
                                            <DatePicker aria-label={_("Pick date")}
                                                inputProps={{
                                                    id: repeat,
                                                    pattern: '^[0-9]{4}[-](0[1-9]|1[0-2])[-](0[1-9]|[12][0-9]|3[0-1])',
                                                    isRequired: true,
                                                    validated: repeatPatterns[idx].validated,
                                                    onBlur: event => {
                                                        repeatValidate(event);
                                                    },
                                                    onChange: str => {
                                                        const arr = [...repeatPatterns];
                                                        arr[idx].date = str;
                                                        setRepeatPatterns(arr);
                                                    }
                                                }}
                                                appendTo={() => document.body}
                                                buttonAriaLabel={_("Toggle date picker")}
                                                locale={timeformat.dateFormatLang()}
                                                weekStart={timeformat.firstDayOfWeek()}
                                                // isRequired // No Required flag for DatePicker
                                            />
                                            {timePicker(idx)}
                                        </>}
                                        {repeat !== "no" && <FlexItem align={{ default: 'alignRight' }}>
                                            <InputGroup>
                                                <Button aria-label={_("Remove")}
                                                        variant="secondary"
                                                        isDisabled={repeatPatterns.length == 1}
                                                        onClick={() => setRepeatPatterns(repeatPatterns.filter((item, item_idx) => idx != item_idx))}>
                                                    <MinusIcon />
                                                </Button>
                                                <Button aria-label={_("Add")}
                                                        variant="secondary"
                                                        onClick={() => {
                                                            if (repeat == "minutely")
                                                                setRepeatPatterns([...repeatPatterns, { key: repeatPatterns.length, second: "0" }]);
                                                            else if (repeat == "hourly")
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
                                            </InputGroup>
                                        </FlexItem>}
                                    </Flex>
                                </FormGroup>
                            );
                        })}
                    </>}
                </FormGroup>
            </Form>
        </Modal>
    );
};
