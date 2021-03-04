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
import React from 'react';
import { FormGroup, Popover, Progress, ProgressSize, ProgressMeasureLocation, TextInput } from '@patternfly/react-core';
import { HelpIcon } from '@patternfly/react-icons';

import './cockpit-components-password.scss';

const _ = cockpit.gettext;

export function password_quality(password, force) {
    return new Promise((resolve, reject) => {
        cockpit.spawn('/usr/bin/pwscore', { err: "message" })
                .input(password)
                .done(function(content) {
                    var quality = parseInt(content, 10);
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

export const PasswordFormFields = ({
    password, password_confirm,
    password_label, password_confirm_label,
    password_strength, password_message,
    password_label_info,
    error_password, error_password_confirm,
    idPrefix, change
}) => {
    let variant;
    if (password_strength === "")
        variant = "default";
    else if (password_strength > 66)
        variant = "success";
    else if (password_strength > 33)
        variant = "warning";
    else
        variant = "danger";

    return (
        <>
            <FormGroup label={password_label}
                       labelIcon={password_label_info &&
                           <Popover bodyContent={password_label_info}>
                               <button onClick={e => e.preventDefault()}
                                       className="pf-c-form__group-label-help">
                                   <HelpIcon noVerticalAlign />
                               </button>
                           </Popover>
                       }
                       helperTextInvalid={error_password}
                       validated={error_password ? "error" : "default"}
                       fieldId={idPrefix + "-pw1"}>
                <TextInput className="check-passwords" type="password" id={idPrefix + "-pw1"}
                           value={password} onChange={value => change("password", value)} />
                <div>
                    <Progress id={idPrefix + "-meter"}
                              className={"ct-password-strength-meter " + variant}
                              title={_("password quality")}
                              size={ProgressSize.sm}
                              measureLocation={ProgressMeasureLocation.none}
                              variant={variant}
                              value={Number.isInteger(password_strength) ? password_strength : 0} />
                    <div id={idPrefix + "-password-meter-message"} className="pf-c-form__helper-text" aria-live="polite">{password_message}</div>
                </div>
            </FormGroup>

            {password_confirm_label && <FormGroup label={password_confirm_label}
                       helperTextInvalid={error_password_confirm}
                       validated={error_password_confirm ? "error" : "default"}
                       fieldId={idPrefix + "-pw2"}>
                <TextInput type="password" id={idPrefix + "-pw2"}
                           value={password_confirm} onChange={value => change("password_confirm", value)} />
            </FormGroup>}
        </>
    );
};
