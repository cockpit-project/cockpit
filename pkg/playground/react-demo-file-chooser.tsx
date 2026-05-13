/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useReducer } from "react";

import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText } from "@patternfly/react-core/dist/esm/components/HelperText";

import { WithDialogs, useDialogs } from "dialogs";
import { FileChooserInput } from "cockpit-components-file-chooser.jsx";

const _ = cockpit.gettext;

const FileChooserModal = () => {
    const Dialogs = useDialogs();

    const [value, _setValue] = useState("");
    const [numChanges, countChange] = useReducer(x => x + 1, 0);
    const [value2, setValue2] = useState("");

    function setValue(val: string) {
        _setValue(val);
        countChange();
    }

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
                            shortcuts={
                                [
                                    { label: _("Downloads"), path: "/home/mvo/Downloads/" },
                                    { label: _("Pictures"), path: "/home/mvo/Pictures/" },
                                    { label: _("Images"), path: "/var/lib/libvirt/images/" },
                                ]
                            }
                            filters={
                                [
                                    { label: "ISO files",  regex: ".*\\.iso$" },
                                    { label: "Disk images", regex: ".*\\.qcow2$" },
                                ]
                            }
                            value={value}
                            onChange={setValue}
                        />
                        <FormHelperText>
                            <HelperText>
                                {numChanges} changes
                            </HelperText>
                        </FormHelperText>
                    </FormGroup>
                    <FormGroup
                        label="Choose a location"
                    >
                        <FileChooserInput
                            title="Choose a location"
                            shortcuts={
                                [
                                    { label: _("Home"), path: "/home/mvo/" },
                                    { label: _("Downloads"), path: "/home/mvo/Downloads/" },
                                    { label: _("Default"), path: "/var/lib/libvirt/images/" },
                                ]
                            }
                            value={value2}
                            onChange={setValue2}
                            onlyDirectories
                        />
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="link" onClick={Dialogs.close}>Close</Button>
            </ModalFooter>
        </Modal>
    );
}

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
