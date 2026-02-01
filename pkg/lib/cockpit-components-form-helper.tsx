/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
