/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import React from "react";

import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import {
    HelperText, HelperTextItem, type HelperTextItemProps
} from "@patternfly/react-core/dist/esm/components/HelperText";

export const FormHelper = ({ helperText, helperTextInvalid, variant, icon, fieldId } :
  {
      helperText?: React.ReactNode,
      helperTextInvalid?: React.ReactNode,
      variant?: HelperTextItemProps["variant"],
      icon?: HelperTextItemProps["icon"],
      fieldId?: string,
  }
) => {
    const formHelperVariant = variant || (helperTextInvalid ? "error" : "default");

    if (!(helperText || helperTextInvalid))
        return null;

    return (
        <FormHelperText>
            <HelperText>
                <HelperTextItem
                    // TODO @Venefilyn: Handle screenreader for this and add translation
                    {...fieldId && { id: fieldId + '-helper' }}
                    variant={formHelperVariant}
                    icon={icon}>
                    {formHelperVariant === "error" ? helperTextInvalid : helperText}
                </HelperTextItem>
            </HelperText>
        </FormHelperText>
    );
};
