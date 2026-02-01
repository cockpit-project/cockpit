/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

/* Sample dialog body
 */
export class PatternDialogBody extends React.Component {
    selectChanged(value) {
        console.log("new value: " + value);
    }

    render() {
        return (
            <Form isHorizontal>
                <FormGroup fieldId="control-1" label='Label'>
                    <TextInput id="control-1" />
                </FormGroup>
            </Form>
        );
    }
}
