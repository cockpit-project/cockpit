/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from "react";

import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';

import { WithDialogs, useDialogs } from "dialogs";
import { FileChooserInput, regexFilter } from "cockpit/file-chooser.jsx";

const _ = cockpit.gettext;

const filters = [
    regexFilter("ISO files", "\\.iso$")
];

const FileChooserModal = () => {
    const Dialogs = useDialogs();

    const [value, setValue] = useState("");

    return (
        <Modal
            position="top"
            variant="medium"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title="File choosing dialog" />
            <ModalBody>
                <Form isHorizontal>
                    <FormGroup
                        label="Choose a file"
                    >
                        <FileChooserInput
                            title="Choose a file"
                            filters={filters}
                            value={value}
                            onChange={setValue}
                        />
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="link" onClick={Dialogs.close}>Close</Button>
            </ModalFooter>
        </Modal>
    );
};

const FileChooserDemoButton = () => {
    const Dialogs = useDialogs();

    return (
        <Button
            onClick={() => Dialogs.show(<FileChooserModal />)}
        >
            Dialog with FileChooser
        </Button>
    );
};

export const FileChooserDemo = () => {
    return (
        <WithDialogs>
            <FileChooserDemoButton />
        </WithDialogs>
    );
};
