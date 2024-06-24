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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DatePicker } from "@patternfly/react-core/dist/esm/components/DatePicker/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { InputGroup } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";
import { MinusIcon, PlusIcon } from '@patternfly/react-icons';

import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { useDialogs } from "dialogs.jsx";

import { updateTime } from './services.jsx';
import { create_timer } from './timer-dialog-helpers.js';
import * as timeformat from "timeformat";

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
    const [submitted, setSubmitted] = useState(false);
    const [commandNotFound, setCommandNotFound] = useState(false);
    const validationFailed = {};

    if (!name.trim().length || !/^[a-zA-Z0-9:_.@-]+$/.test(name))
        validationFailed.name = true;
    if (!description.trim().length)
        validationFailed.description = true;
    if (!command.trim().length || commandNotFound)
        validationFailed.command = true;
    if (!/^[0-9]+$/.test(delayNumber))
        validationFailed.delayNumber = true;

    const timePicker = (idx) => (
        <TimePicker className="create-timer-time-picker"
                    time={repeatPatterns[idx].time || "00:00"}
                    is24Hour
                    isOpen={repeatPatterns[idx].isOpen || false}
                    setIsOpen={isOpen => setRepeatPatterns(old => {
                        const arr = [...old];
                        arr[idx].isOpen = isOpen;
                        return arr;
                    })}
                    menuAppendTo={() => document.body}
                    onChange={(_, time) => setRepeatPatterns(old => {
                        const arr = [...old];
                        arr[idx].time = time;
                        return arr;
                    })}
        />
    );

    function onSubmit(event) {
        setSubmitted(true);

        if (event)
            event.preventDefault();

        if (Object.keys(validationFailed).length)
            return false;

        setInProgress(true);

        // Verify if the command exists
        const command_parts = command.split(" ");
        cockpit.spawn(["test", "-f", command_parts[0]], { err: "ignore" })
                .then(() => {
                    create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, specificTime, repeatPatterns, owner })
                            .then(Dialogs.close, exc => {
                                setDialogError(exc.message);
                                setInProgress(false);
                            });
                })
                .catch(() => {
                    setCommandNotFound(true);
                    setInProgress(false);
                });

        return false;
    }

    return (
        <Modal id="timer-dialog"
           className="timer-dialog" position="top" variant="medium" isOpen onClose={Dialogs.close}
           title={cockpit.format(_("Create timer"), name)}
           footer={
               <>
                   <Button variant='primary'
                           id="timer-save-button"
                           isLoading={inProgress}
                           isDisabled={inProgress || commandNotFound}
                           onClick={onSubmit}>
                       {_("Save")}
                   </Button>
                   <Button variant='link' onClick={Dialogs.close}>
                       {_("Cancel")}
                   </Button>
               </>
           }>
            {dialogError && <ModalError dialogError={_("Timer creation failed")} dialogErrorDetail={dialogError} />}
            <Form isHorizontal onSubmit={onSubmit}>
                <FormGroup label={_("Name")}
                           fieldId="servicename">
                    <TextInput id='servicename'
                               value={name}
                               validated={submitted && validationFailed.name ? "error" : "default"}
                               onChange={(_event, value) => setName(value)} />
                    <FormHelper fieldId="servicename"
                                helperTextInvalid={submitted && validationFailed.name && (!name.trim().length ? _("This field cannot be empty") : _("Only alphabets, numbers, : , _ , . , @ , - are allowed"))} />
                </FormGroup>
                <FormGroup label={_("Description")}
                           fieldId="description">
                    <TextInput id='description'
                               value={description}
                               validated={submitted && validationFailed.description ? "error" : "default"}
                               onChange={(_event, value) => setDescription(value)} />
                    <FormHelper fieldId="description" helperTextInvalid={submitted && validationFailed.description && _("This field cannot be empty")} />
                </FormGroup>
                <FormGroup label={_("Command")}
                           fieldId="command">
                    <TextInput id='command'
                               value={command}
                               validated={submitted && validationFailed.command ? "error" : "default"}
                               onChange={(_event, str) => { setCommandNotFound(false); setCommand(str) }} />
                    <FormHelper fieldId="command"
                                helperTextInvalid={submitted && validationFailed.command && (commandNotFound ? _("Command not found") : _("This field cannot be empty"))} />
                </FormGroup>
                <FormGroup label={_("Trigger")} hasNoPaddingTop>
                    <Flex>
                        <Radio value="specific-time"
                               id="specific-time"
                               name="boot-or-specific-time"
                               onChange={() => setDelay("specific-time")}
                               isChecked={delay == "specific-time"}
                               label={_("At specific time")} />
                        <Radio value="system-boot"
                               id="system-boot"
                               name="boot-or-specific-time"
                               onChange={() => setDelay("system-boot")}
                               isChecked={delay == "system-boot"}
                               label={_("After system boot")} />
                    </Flex>
                    { delay == "system-boot" &&
                    <FormGroup className="delay-group"
                               label={_("Delay")}>
                        <Flex>
                            <TextInput className="delay-number"
                                       value={delayNumber}
                                       validated={submitted && validationFailed.delayNumber ? "error" : "default"}
                                       onChange={(_event, value) => setDelayNumber(value)} />
                            <FormSelect className="delay-unit"
                                        value={delayUnit}
                                        onChange={(_, val) => setDelayUnit(val)}
                                        aria-label={_("Delay")}>
                                <FormSelectOption value="sec" label={_("Seconds")} />
                                <FormSelectOption value="min" label={_("Minutes")} />
                                <FormSelectOption value="hr" label={_("Hours")} />
                                <FormSelectOption value="weeks" label={_("Weeks")} />
                            </FormSelect>
                        </Flex>
                        <FormHelper helperTextInvalid={submitted && validationFailed.delayNumber && _("Delay must be a number")} />
                    </FormGroup> }
                    { delay == "specific-time" &&
                    <>
                        <FormGroup label={_("Repeat")}>
                            <FormSelect value={repeat}
                                        id="drop-repeat"
                                        onChange={(_, value) => {
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
                                        menuAppendTo={() => document.body} time={specificTime} is24Hour onChange={(_, val) => setSpecificTime(val)} />
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

                            let helperTextInvalid;
                            const min = repeatPatterns[idx].minute;
                            const validationFailedMinute = !(/^[0-9]+$/.test(min) && min <= 59 && min >= 0);

                            if (submitted && repeat == 'hourly' && validationFailedMinute) {
                                helperTextInvalid = _("Minute needs to be a number between 0-59");
                            }

                            const sec = repeatPatterns[idx].second;
                            const validationFailedSecond = !(/^[0-9]+$/.test(sec) && sec <= 59 && sec >= 0);

                            if (submitted && repeat == 'minutely' && validationFailedSecond) {
                                helperTextInvalid = _("Second needs to be a number between 0-59");
                            }

                            return (
                                <FormGroup label={label} key={item.key}>
                                    <Flex className="specific-repeat-group" data-index={idx}>
                                        {repeat == "minutely" &&
                                            <TextInput className='delay-number'
                                                       id={repeat}
                                                       value={repeatPatterns[idx].second}
                                                       onChange={(_event, second) => setRepeatPatterns(old => {
                                                           const arr = [...old];
                                                           arr[idx].second = second;
                                                           return arr;
                                                       })}
                                                       validated={submitted && validationFailedSecond ? "error" : "default"} />
                                        }
                                        {repeat == "hourly" &&
                                            <TextInput className='delay-number'
                                                       value={repeatPatterns[idx].minute}
                                                       onChange={(_event, minute) => setRepeatPatterns(old => {
                                                           const arr = [...old];
                                                           arr[idx].minute = minute;
                                                           return arr;
                                                       })}
                                                       validated={submitted && validationFailedMinute ? "error" : "default"} />
                                        }
                                        {repeat == "daily" && timePicker(idx)}
                                        {repeat == "weekly" && <>
                                            <FormSelect value={repeatPatterns[idx].day}
                                                        className="week-days"
                                                        onChange={(_, day) => setRepeatPatterns(old => {
                                                            const arr = [...old];
                                                            arr[idx].day = day;
                                                            return arr;
                                                        })}
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
                                                        onChange={(_, day) => setRepeatPatterns(old => {
                                                            const arr = [...old];
                                                            arr[idx].day = day;
                                                            return arr;
                                                        })}
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
                                                        buttonAriaLabel={_("Toggle date picker")}
                                                        locale={timeformat.dateFormatLang()}
                                                        weekStart={timeformat.firstDayOfWeek()}
                                                        onChange={(_, str, data) => setRepeatPatterns(old => {
                                                            const arr = [...old];
                                                            arr[idx].date = str;
                                                            return arr;
                                                        })}
                                                        appendTo={() => document.body} />
                                            {timePicker(idx)}
                                        </>}
                                        {repeat !== "no" && <FlexItem align={{ default: 'alignRight' }}>
                                            <InputGroup>
                                                <Button aria-label={_("Remove")}
                                                        variant="secondary"
                                                        isDisabled={repeatPatterns.length == 1}
                                                        onClick={() => setRepeatPatterns(old => old.filter((item, item_idx) => idx != item_idx))}>
                                                    <MinusIcon />
                                                </Button>
                                                <Button aria-label={_("Add")}
                                                        variant="secondary"
                                                        onClick={() => {
                                                            if (repeat == "minutely")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, second: "0" }]);
                                                            else if (repeat == "hourly")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, minute: "0" }]);
                                                            else if (repeat == "daily")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, time: "00:00" }]);
                                                            else if (repeat == "weekly")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, day: "mon", time: "00:00" }]);
                                                            else if (repeat == "monthly")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, day: 1, time: "00:00" }]);
                                                            else if (repeat == "yearly")
                                                                setRepeatPatterns(old => [...old, { key: repeatPatterns.length, date: undefined, time: "00:00" }]);
                                                        }}>
                                                    <PlusIcon />
                                                </Button>
                                            </InputGroup>
                                        </FlexItem>}
                                    </Flex>
                                    <FormHelper helperTextInvalid={helperTextInvalid} />
                                </FormGroup>
                            );
                        })}
                    </>}
                </FormGroup>
            </Form>
        </Modal>
    );
};
