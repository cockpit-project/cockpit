/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DatePicker } from "@patternfly/react-core/dist/esm/components/DatePicker/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup, FormAlert } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { InputGroup } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";
import { MinusIcon, PlusIcon } from '@patternfly/react-icons';

import {
    useDialogState, DialogState, DialogField, DialogError,
    DialogActionButton, DialogCancelButton, DialogErrorMessage,
    DialogTextInput, DialogRadioSelect, DialogDropdownSelect,
} from "cockpit/dialog";
import { useDialogs } from "dialogs.jsx";

import { updateTime } from './services.jsx';
import { create_timer } from './timer-dialog-helpers.js';
import * as timeformat from "timeformat";

import "./timers.scss";

const _ = cockpit.gettext;

// TypeScript interfaces for timer dialog values
type RepeatPattern =
    | { key: number; second: string }
    | { key: number; minute: string }
    | { key: number; time: string }
    | { key: number; day: string; time: string }
    | { key: number; day: number; time: string }
    | { key: number; date: string | undefined; time: string };

interface TimerDialogValues {
    name: string;
    description: string;
    command: string;
    delay: "specific-time" | "system-boot";
    delayNumber: string;
    delayUnit: "sec" | "min" | "hr" | "weeks";
    repeat: "no" | "minutely" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    specificTime: string;
    repeatPatterns: RepeatPattern[];
}

interface TimerProp {
    name?: string;
    description?: string;
    command?: string;
    delay?: "specific-time" | "system-boot";
    delayNumber?: number;
    delayUnit?: "sec" | "min" | "hr" | "weeks";
    repeat?: "no" | "minutely" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    specificTime?: string;
    repeatPatterns?: RepeatPattern[];
}

// TimePicker helper component with local state
const TimerTimePicker = ({ field }: { field: DialogField<string> }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <TimePicker className="create-timer-time-picker"
            time={field.get()}
            is24Hour
            isOpen={isOpen}
            setIsOpen={(val) => setIsOpen(val ?? false)}
            menuAppendTo={() => document.body}
            onChange={(_, time) => field.set(time)} />
    );
};

export const TimerDialog = ({ owner, timer }: { owner: string; timer?: TimerProp }) => {
    const Dialogs = useDialogs();

    // Helper to create initial pattern based on repeat type
    function getInitialPattern(repeat: string, key: number): RepeatPattern {
        switch (repeat) {
        case "minutely": return { key, second: "0" };
        case "hourly": return { key, minute: "0" };
        case "daily": return { key, time: "00:00" };
        case "weekly": return { key, day: "mon", time: "00:00" };
        case "monthly": return { key, day: 1, time: "00:00" };
        case "yearly": return { key, date: undefined, time: "00:00" };
        default: return { key, time: "00:00" };
        }
    }

    function validate(dlg: DialogState<TimerDialogValues>) {
        // Always validate basic fields
        dlg.field("name").validate(v => {
            if (!v.trim().length)
                return _("This field cannot be empty");
            if (!/^[a-zA-Z0-9:_.@-]+$/.test(v))
                return _("Only alphabets, numbers, : , _ , . , @ , - are allowed");
        });

        dlg.field("description").validate(v => {
            if (!v.trim().length)
                return _("This field cannot be empty");
        });

        dlg.field("command").validate(v => {
            if (!v.trim().length)
                return _("This field cannot be empty");
        });

        // Conditional validation based on delay type
        if (dlg.values.delay === "system-boot") {
            dlg.field("delayNumber").validate(v => {
                if (!/^[0-9]+$/.test(v))
                    return _("Delay must be a number");
            });
        }

        // Validate repeat patterns
        if (dlg.values.delay === "specific-time" && dlg.values.repeat !== "no") {
            dlg.field("repeatPatterns").forEach(patternField => {
                const pattern = patternField.get();
                if (dlg.values.repeat === "minutely" && "second" in pattern) {
                    patternField.at(pattern).sub("second").validate(v => {
                        const n = Number(v);
                        if (!/^[0-9]+$/.test(v) || n > 59 || n < 0)
                            return _("Second needs to be a number between 0-59");
                    });
                } else if (dlg.values.repeat === "hourly" && "minute" in pattern) {
                    patternField.at(pattern).sub("minute").validate(v => {
                        const n = Number(v);
                        if (!/^[0-9]+$/.test(v) || n > 59 || n < 0)
                            return _("Minute needs to be a number between 0-59");
                    });
                }
            });
        }
    }

    const dlg = useDialogState<TimerDialogValues>(() => {
        if (timer) {
            return {
                name: timer.name || "",
                description: timer.description || "",
                command: timer.command || "",
                delay: timer.delay || "specific-time",
                delayNumber: String(timer.delayNumber || 0),
                delayUnit: timer.delayUnit || "sec",
                repeat: timer.repeat || "no",
                specificTime: timer.specificTime || "00:00",
                repeatPatterns: timer.repeatPatterns || [],
            };
        }
        return {
            name: "",
            description: "",
            command: "",
            delay: "specific-time",
            delayNumber: "0",
            delayUnit: "sec",
            repeat: "no",
            specificTime: "00:00",
            repeatPatterns: [],
        };
    }, validate);

    // Local state for TimePicker (not part of dialog values)
    const [isSpecificTimeOpen, setSpecificTimeOpen] = useState(false);

    const patternsField = dlg.field("repeatPatterns");

    // Callback when repeat type changes - reset patterns
    function on_repeat_change(newRepeat: TimerDialogValues["repeat"]) {
        if (newRepeat !== "no") {
            patternsField.set([getInitialPattern(newRepeat, 0)]);
        } else {
            patternsField.set([]);
        }
    }

    async function apply(values: TimerDialogValues) {
        try {
            await create_timer({
                name: values.name,
                description: values.description,
                command: values.command,
                delay: values.delay,
                delayUnit: values.delayUnit,
                delayNumber: Number(values.delayNumber),
                repeat: values.repeat,
                specificTime: values.specificTime,
                repeatPatterns: values.repeatPatterns,
                owner
            });
        } catch (exc) {
            throw DialogError.fromError(_("Timer creation failed"), exc);
        }
    }

    return (
        <Modal
            id="timer-dialog"
            className="timer-dialog"
            position="top"
            variant="medium"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title={!timer ? _("Create timer") : _("Edit timer")} />
            <ModalBody>
                <DialogErrorMessage dialog={dlg} />
                <Form isHorizontal>
                    {timer && !timer.delay && <FormAlert>
                        <Alert variant="danger" title={_("Failed to get the starting conditions for the timer")} isInline />
                    </FormAlert>}
                    {timer && !timer.command && <FormAlert>
                        <Alert variant="danger" title={_("Failed to get the timer command")} isInline />
                    </FormAlert>}

                    <DialogTextInput
                        label={_("Name")}
                        field={dlg.field("name")}
                        isDisabled={!!timer}
                    />

                    <DialogTextInput
                        label={_("Description")}
                        field={dlg.field("description")}
                    />

                    <DialogTextInput
                        label={_("Shell command")}
                        field={dlg.field("command")}
                        explanation={_("This command will be executed by /bin/sh.")}
                    />

                    <FormGroup label={_("Trigger")} hasNoPaddingTop>
                        {/* This is a bit tricky.  We want horizontal
                            radio buttons, which normally is done by
                            making the FormGroup "isInline". But we
                            also want to nest the "Repeat", "Delay"
                            etc elements into the same FormGroup
                            vertically. So we don't make the FormGroup
                            "isInline" but put the radio buttons into
                            a flex.
                          */}
                        <Flex>
                            <DialogRadioSelect
                                field={dlg.field("delay")}
                                options={[
                                    { value: "specific-time", label: _("At specific time") },
                                    { value: "system-boot", label: _("After system boot") }
                                ]}
                            />
                        </Flex>

                        {dlg.values.delay === "system-boot" &&
                            <FormGroup className="delay-group" label={_("Delay")}>
                                <Flex>
                                    <DialogTextInput
                                        field={dlg.field("delayNumber")}
                                    />
                                    <DialogDropdownSelect
                                        field={dlg.field("delayUnit")}
                                        options={[
                                            { value: "sec", label: _("Seconds") },
                                            { value: "min", label: _("Minutes") },
                                            { value: "hr", label: _("Hours") },
                                            { value: "weeks", label: _("Weeks") }
                                        ]}
                                        aria-label={_("Delay")}
                                    />
                                </Flex>
                            </FormGroup>}

                        {dlg.values.delay === "specific-time" &&
                            <>
                                <DialogDropdownSelect
                                    label={_("Repeat")}
                                    field={dlg.field("repeat", on_repeat_change)}
                                    options={[
                                        { value: "no", label: _("Don't repeat") },
                                        { value: "minutely", label: _("Minutely") },
                                        { value: "hourly", label: _("Hourly") },
                                        { value: "daily", label: _("Daily") },
                                        { value: "weekly", label: _("Weekly") },
                                        { value: "monthly", label: _("Monthly") },
                                        { value: "yearly", label: _("Yearly") }
                                    ]}
                                />

                                {dlg.values.repeat === "no" &&
                                    <FormGroup label={_("Run at")}>
                                        <TimePicker className="create-timer-time-picker specific-no-repeat"
                                            isOpen={isSpecificTimeOpen}
                                            setIsOpen={(val) => setSpecificTimeOpen(val ?? false)}
                                            menuAppendTo={() => document.body}
                                            time={dlg.field("specificTime").get()}
                                            is24Hour
                                            onChange={(_, val) => dlg.field("specificTime").set(val)} />
                                    </FormGroup>}

                                {patternsField.map((patternField, idx) => {
                                    const pattern = patternField.get();
                                    const repeat = dlg.values.repeat;

                                    let label;
                                    if (repeat === "minutely")
                                        label = _("At second");
                                    else if (repeat === "hourly")
                                        label = _("At minute");
                                    else if (repeat === "daily")
                                        label = _("Run at");
                                    else if (repeat === "weekly" || repeat === "monthly" || repeat === "yearly")
                                        label = _("Run on");

                                    return (
                                        <FormGroup label={label} key={pattern.key}>
                                            <Flex className="specific-repeat-group" data-index={idx}>
                                                {repeat === "minutely" && "second" in pattern &&
                                                    <DialogTextInput
                                                        field={patternField.at(pattern).sub("second")}
                                                    />
                                                }
                                                {repeat === "hourly" && "minute" in pattern &&
                                                    <DialogTextInput
                                                        field={patternField.at(pattern).sub("minute")}
                                                    />
                                                }
                                                {repeat === "daily" && "time" in pattern &&
                                                    <TimerTimePicker field={patternField.at(pattern).sub("time")} />
                                                }
                                                {repeat === "weekly" && "day" in pattern && typeof pattern.day === "string" &&
                                                    <>
                                                        <FormSelect
                                                            value={pattern.day}
                                                            className="week-days"
                                                            onChange={(_, day) => patternField.at(pattern).sub("day").set(day)}
                                                            aria-label={_("Repeat weekly")}>
                                                            <FormSelectOption value="mon" label={_("Mondays")} />
                                                            <FormSelectOption value="tue" label={_("Tuesdays")} />
                                                            <FormSelectOption value="wed" label={_("Wednesdays")} />
                                                            <FormSelectOption value="thu" label={_("Thursdays")} />
                                                            <FormSelectOption value="fri" label={_("Fridays")} />
                                                            <FormSelectOption value="sat" label={_("Saturdays")} />
                                                            <FormSelectOption value="sun" label={_("Sundays")} />
                                                        </FormSelect>
                                                        <TimerTimePicker field={patternField.at(pattern).sub("time")} />
                                                    </>
                                                }
                                                {repeat === "monthly" && "day" in pattern && typeof pattern.day === "number" &&
                                                    <>
                                                        <FormSelect
                                                            value={String(pattern.day)}
                                                            className="month-days"
                                                            onChange={(_, day) => patternField.at(pattern).sub("day").set(Number(day))}
                                                            aria-label={_("Repeat monthly")}>
                                                            {[_("1st"), _("2nd"), _("3rd"), _("4th"), _("5th"),
                                                                _("6th"), _("7th"), _("8th"), _("9th"), _("10th"),
                                                                _("11th"), _("12th"), _("13th"), _("14th"), _("15th"),
                                                                _("16th"), _("17th"), _("18th"), _("19th"), _("20th"),
                                                                _("21th"), _("22th"), _("23th"), _("24th"), _("25th"),
                                                                _("26th"), _("27th"), _("28th"), _("29th"), _("30th"), _("31st")
                                                            ].map((day, index) => <FormSelectOption key={day} value={String(index + 1)} label={day} />)}
                                                        </FormSelect>
                                                        <TimerTimePicker field={patternField.at(pattern).sub("time")} />
                                                    </>
                                                }
                                                {repeat === "yearly" && "date" in pattern &&
                                                    <>
                                                        <DatePicker aria-label={_("Pick date")}
                                                            buttonAriaLabel={_("Toggle date picker")}
                                                            locale={timeformat.dateFormatLang()}
                                                            weekStart={timeformat.firstDayOfWeek()}
                                                            onChange={(_, str) => patternField.at(pattern).sub("date").set(str)}
                                                            appendTo={() => document.body}
                                                            value={pattern.date || ""} />
                                                        <TimerTimePicker field={patternField.at(pattern).sub("time")} />
                                                    </>}
                                                {repeat !== "no" && <FlexItem align={{ default: 'alignRight' }}>
                                                    <InputGroup>
                                                        <Button icon={<MinusIcon />} aria-label={_("Remove")}
                                                                                variant="secondary"
                                                                                isDisabled={patternsField.get().length === 1}
                                                                                onClick={() => patternsField.remove(idx)} />
                                                        <Button icon={<PlusIcon />} aria-label={_("Add")}
                                                                                variant="secondary"
                                                                                onClick={() => {
                                                                                    const patterns = patternsField.get();
                                                                                    const newKey = patterns.length > 0
                                                                                        ? Math.max(...patterns.map(p => p.key)) + 1
                                                                                        : 0;
                                                                                    patternsField.add(getInitialPattern(repeat, newKey));
                                                                                }} />
                                                    </InputGroup>
                                                </FlexItem>}
                                            </Flex>
                                        </FormGroup>
                                    );
                                })}
                            </>}
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <DialogActionButton dialog={dlg} action={apply} onClose={Dialogs.close}>
                    {_("Save")}
                </DialogActionButton>
                <DialogCancelButton dialog={dlg} onClose={Dialogs.close} />
            </ModalFooter>
        </Modal>
    );
};

export const CreateTimerDialogButton = ({ owner, isLoading }: { owner: string; isLoading: boolean }) => {
    const Dialogs = useDialogs();
    return (
        <Button key='create-timer-action'
                variant="secondary"
                id="create-timer"
                isDisabled={isLoading}
                onClick={() => {
                    updateTime();
                    Dialogs.show(<TimerDialog owner={owner} />);
                }}>
            {_("Create timer")}
        </Button>
    );
};
