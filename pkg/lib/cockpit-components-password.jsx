/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import { debounce } from 'throttle-debounce';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { InputGroup, InputGroupItem } from '@patternfly/react-core/dist/esm/components/InputGroup/index.js';
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Progress, ProgressMeasureLocation, ProgressSize } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { EyeIcon, EyeSlashIcon, HelpIcon } from '@patternfly/react-icons';

import { FormHelper } from "cockpit-components-form-helper";

import './cockpit-components-password.scss';
import { Flex, FlexItem } from '@patternfly/react-core';

const _ = cockpit.gettext;

export function password_quality(password, force) {
    return new Promise((resolve, reject) => {
        cockpit.spawn('/usr/bin/pwscore', { err: "message" })
                .input(password)
                .done(function(content) {
                    const quality = parseInt(content, 10);
                    if (quality === 0)
                        reject(new Error(_("Password is too weak")));
                    else
                        resolve({ value: quality, message: quality === 100 ? _("Excellent password") : undefined });
                })
                .fail(function(ex) {
                    if (!force)
                        reject(new Error(ex.message || _("Password is not acceptable")));
                    else
                        resolve({ value: 0 });
                });
    });
}

const debounced_password_quality = debounce(300, (value, callback) => {
    password_quality(value).catch(() => ({ value: 0 })).then(callback);
});

export const PasswordFormFields = ({
    password_label, password_confirm_label,
    password_label_info,
    initial_password,
    error_password, error_password_confirm,
    idPrefix, change
}) => {
    const [password, setPassword] = useState(initial_password || "");
    const [passwordConfirm, setConfirmPassword] = useState("");
    const [passwordStrength, setPasswordStrength] = useState();
    const [passwordMessage, setPasswordMessage] = useState("");
    const [passwordHidden, setPasswordHidden] = useState(true);
    const [passwordConfirmHidden, setPasswordConfirmHidden] = useState(true);

    function onPasswordChanged(value) {
        setPassword(value);
        change("password", value);

        if (value) {
            debounced_password_quality(value, strength => {
                setPasswordStrength(strength.value);
                setPasswordMessage(strength.message);
            });
        } else {
            setPasswordStrength();
            setPasswordMessage("");
        }
    }

    let variant;
    let message;
    let messageColor;
    if (passwordStrength > 66) {
        variant = "success";
        messageColor = "pf-v5-u-success-color-200";
        message = _("Strong password");
    } else if (passwordStrength > 33) {
        variant = "warning";
        messageColor = "pf-v5-u-warning-color-200";
        message = _("Acceptable password");
    } else {
        variant = "danger";
        messageColor = "pf-v5-u-danger-color-200";
        message = _("Weak password");
    }

    if (!passwordMessage && message)
        setPasswordMessage(message);

    let passwordStrengthValue = Number.isInteger(passwordStrength) ? Number.parseInt(passwordStrength) : -1;
    if (password !== "" && (passwordStrengthValue >= 0 && passwordStrengthValue < 25))
        passwordStrengthValue = 25;

    return (
        <>
            <FormGroup label={password_label}
                       labelIcon={password_label_info &&
                           <Popover bodyContent={password_label_info}>
                               <button onClick={e => e.preventDefault()}
                                       className="pf-v5-c-form__group-label-help">
                                   <HelpIcon />
                               </button>
                           </Popover>
                       }
                       validated={error_password ? "warning" : "default"}
                       id={idPrefix + "-pw1-group"}
                       fieldId={idPrefix + "-pw1"}>
                <InputGroup>
                    <InputGroupItem isFill>
                        <TextInput className="check-passwords" type={passwordHidden ? "password" : "text"} id={idPrefix + "-pw1"}
                                   autoComplete="new-password" value={password} onChange={(_event, value) => onPasswordChanged(value)}
                                   validated={error_password ? "warning" : "default"} />
                    </InputGroupItem>
                    <InputGroupItem>
                        <Button
                            variant="control"
                            onClick={() => setPasswordHidden(!passwordHidden)}
                            aria-label={passwordHidden ? _("Show password") : _("Hide password")}>
                            {passwordHidden ? <EyeIcon /> : <EyeSlashIcon />}
                        </Button>
                    </InputGroupItem>
                </InputGroup>
                {passwordStrengthValue >= 0 && <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                        <Progress id={idPrefix + "-meter"}
                            className={"pf-v5-u-pt-xs ct-password-strength-meter " + variant}
                            title={_("password quality")}
                            size={ProgressSize.sm}
                            measureLocation={ProgressMeasureLocation.none}
                            variant={variant}
                            value={passwordStrengthValue} />
                    </FlexItem>
                    <FlexItem>
                        <div id={idPrefix + "-password-meter-message"} className={"pf-v5-c-form__helper-text " + messageColor} aria-live="polite">{passwordMessage}</div>
                    </FlexItem>
                </Flex>}
                {error_password && <FormHelperText>
                    <HelperText component="ul" aria-live="polite" id="password-error-message">
                        <HelperTextItem isDynamic variant="warning" component="li">
                            {error_password}
                        </HelperTextItem>
                    </HelperText>
                </FormHelperText>}
            </FormGroup>

            {password_confirm_label && <FormGroup label={password_confirm_label}
                       id={idPrefix + "-pw2-group"}
                       fieldId={idPrefix + "-pw2"}>
                <InputGroup>
                    <InputGroupItem isFill>
                        <TextInput type={passwordConfirmHidden ? "password" : "text"} id={idPrefix + "-pw2"} autoComplete="new-password"
                            value={passwordConfirm} onChange={(_event, value) => { setConfirmPassword(value); change("password_confirm", value) }} />
                    </InputGroupItem>
                    <InputGroupItem>
                        <Button
                            variant="control"
                            onClick={() => setPasswordConfirmHidden(!passwordConfirmHidden)}
                            aria-label={passwordConfirmHidden ? _("Show confirmation password") : _("Hide confirmation password")}>
                            {passwordConfirmHidden ? <EyeIcon /> : <EyeSlashIcon />}
                        </Button>
                    </InputGroupItem>
                </InputGroup>
                <FormHelper fieldId={idPrefix + "-pw2"} helperTextInvalid={error_password_confirm} />
            </FormGroup>}
        </>
    );
};
