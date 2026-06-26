/*
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from "react";

import cockpit from "cockpit";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { TextInput, type TextInputProps } from "@patternfly/react-core/dist/esm/components/TextInput";
import { InputGroup, InputGroupItem } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";
import { EyeIcon, EyeSlashIcon } from "@patternfly/react-icons";
import { Progress, ProgressMeasureLocation, ProgressSize, type ProgressProps } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { DialogField, DialogHelperText, OptionalFormGroup, effectiveFormId } from "cockpit/dialog";

import "./PasswordInput.scss";

const _ = cockpit.gettext;

async function password_quality(password: string): Promise<number> {
    try {
        const content = await (cockpit.spawn(['/usr/bin/pwscore'], { err: "message" }).input(password));
        return parseInt(content, 10);
    } catch (ex) {
        if (ex && typeof ex == "object" && "problem" in ex && ex.problem == "not-found")
            return -1;
        return 0;
    }
}

export const DialogPasswordInput = ({
    label = null,
    field,
    excuse,
    warning,
    explanation,
    isDisabled = false,
    showStrength = false,
    id,
    ...props
} : {
    label?: React.ReactNode,
    field: DialogField<string>,
    excuse?: string | null | undefined | false,
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
    isDisabled?: boolean,
    showStrength?: boolean,
} & Omit<TextInputProps, "label" | "value" | "onChange">) => {
    const [passwordStrength, setPasswordStrength] = useState<number>(-1);
    const [visible, setVisible] = useState(false);

    function onPasswordChange(value: string) {
        field.set(value);
        if (showStrength) {
            field.get_async(300, async (value, signal) => {
                if (value) {
                    const strength = await password_quality(value);
                    if (!signal.aborted)
                        setPasswordStrength(strength);
                } else {
                    setPasswordStrength(-1);
                }
            });
        }
    }

    let variant: ProgressProps['variant'];
    let message;
    let messageColor;
    if (passwordStrength > 66) {
        variant = "success";
        messageColor = "pf-v6-u-success-color-200";
        message = passwordStrength == 100 ? _("Excellent password") : _("Strong password");
    } else if (passwordStrength > 33) {
        variant = "warning";
        messageColor = "pf-v6-u-warning-color-200";
        message = _("Acceptable password");
    } else {
        variant = "danger";
        messageColor = "pf-v6-u-danger-color-200";
        message = _("Weak password");
    }

    let passwordStrengthValue = passwordStrength;
    if (field.get() !== "" && (passwordStrengthValue >= 0 && passwordStrengthValue < 25))
        passwordStrengthValue = 25;

    const strengthExplanation = (
        passwordStrengthValue >= 0 &&
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                <FlexItem>
                    <Progress
                        className={"pf-v6-u-pt-xs ct-password-strength-meter " + variant}
                        title={_("password quality")}
                        size={ProgressSize.sm}
                        measureLocation={ProgressMeasureLocation.none}
                        variant={variant}
                        value={passwordStrengthValue}
                    />
                </FlexItem>
                <FlexItem>
                    <div
                        className={"pf-v6-c-form__helper-text " + messageColor}
                        aria-live="polite"
                    >
                        {message}
                    </div>
                </FlexItem>
            </Flex>
    );

    const eid = effectiveFormId(id, label, field);
    return (
        <OptionalFormGroup label={label} fieldId={eid}>
            <InputGroup>
                <InputGroupItem isFill>
                    <TextInput
                        id={eid}
                        ouiaId={field.ouia_id()}
                        type={visible ? "text" : "password"}
                        value={field.get()}
                        onChange={(_event, value) => onPasswordChange(value)}
                        isDisabled={!!excuse || isDisabled}
                        {...props}
                    />
                </InputGroupItem>
                <InputGroupItem>
                    <Button
                        ouiaId={field.ouia_id("showhide")}
                        variant="control"
                        aria-label={visible ? _("Hide password") : _("Show password")}
                        onClick={() => setVisible(!visible)}
                    >
                        {visible ? <EyeSlashIcon /> : <EyeIcon />}
                    </Button>
                </InputGroupItem>
            </InputGroup>
            <DialogHelperText
                explanation={strengthExplanation || explanation}
                warning={warning}
                excuse={excuse}
                field={field}
            />
        </OptionalFormGroup>
    );
};
