/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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

/* WIP - intended to be promoted into pkg/lib
 */

/* DIALOG IMPLEMENTATION CONVENIENCE
 *
 * import { useNewDialogState, Dialog, Fields, TextField } from "dialogs.jsx";
 *
 * const MyDialog = () => {
 *   const dlg = useNewDialogState({ message: "" });
 *
 *   function send() {
 *     if (!dlg.values.message) {
 *       dlg.set_value_error("message", "Message can't be empty");
 *       return;
 *     }
 *
 *     const channel = cockpit.spawn(["wall", dlg.values.message], { });
 *     dlg.set_cancel(() => channel.close("cancelled"));
 *     dlg.set_progress("Sending message...");
 *
 *     return channel;
 *   }
 *
 *   return (
 *     <Dialog state={dlg}
 *             title="Send a message to everyone"
 *             actionLabel="Send"
 *             action={send}>
 *       <Fields>
 *         <TextField tag="message" label="Message" />
 *       </Fields>
 *     </Dialog>);
 * };
 *
 * In this example, the error from cockpit.spawn will automatically
 * show up in the dialog, progress can be reported and cancellation
 * can be offered.  Wiring up the TextField to the dialog state needs
 * almost no code at all.  Fields get disabled while an action runs
 * and they can show in-line errors.
 *
 * You are encouraged to look at the implementations of Dialog,
 * Fields, and TextField. It should all be very straighforward and
 * easily modified.
 *
 * [ mvo: I hope this is convenient enough for new dialogs, and for
 *   adding more features to existing dialogs.
 * ]
 */

/* REFERENCE DOCUMENTATION
 *
 * [tbw]
 */

import cockpit from "cockpit";
import React, { useState, useContext } from "react";
import { useDialogs } from "dialogs.jsx";

import {
    Alert,
    Button,
    Modal,
    Form,
    FormGroup,
    InputGroup,
    TextInput,
    Checkbox
} from "@patternfly/react-core";
import { EyeIcon, EyeSlashIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

export class DialogError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
    }
}

const DialogStateContext = React.createContext();
export const useDialogState = () => useContext(DialogStateContext);

export const WithDialogState = ({ state, children }) =>
    <DialogStateContext.Provider value={state}>{children}</DialogStateContext.Provider>;

export const useNewDialogState = (default_values) => {
    const Dialogs = useDialogs();
    const [values, setValues] = useState(default_values);
    const [valueErrors, setValueErrors] = useState({});
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState(null);
    const [cancel, setCancel] = useState(null);
    const [task, setTask] = useState(null);

    let n_valueErrors = 0;

    const self = {
        values: values,
        value_errors: valueErrors,
        error: error,

        task: task,
        progress: progress,
        cancel: cancel,

        set: (tag, val) => setValues(old => Object.assign({}, old, { [tag]: val })),

        set_value_error: (tag, err) => {
            n_valueErrors += 1;
            setValueErrors(old => Object.assign({}, old, { [tag]: err }));
        },

        has_value_errors: () => n_valueErrors > 0,

        set_progress: setProgress,
        set_cancel: (func) => setCancel(() => func),

        set_error: setError,

        clear_errors: () => {
            n_valueErrors = 0;
            setValueErrors({});
            setError(null);
        },

        run: (action) => {
            setProgress(null);
            setCancel(null);
            self.clear_errors();
            setTask((action() || Promise.resolve())
                    .then(() => {
                        if (n_valueErrors == 0)
                            self.close();
                    })
                    .catch(setError)
                    .finally(() => {
                        setProgress(null);
                        setCancel(null);
                        setTask(null);
                    }));
        },

        close: Dialogs.close,

        make_id: str => "dialog-field-" + str.replace(/[^A-Za-z0-9_-]/g, '')
    };

    return self;
};

const DialogFooter = ({ actionLabel, action, danger, cancelLabel, closeLabel }) => {
    const dlg = useDialogState();

    const buttons = [];
    if (action)
        buttons.push(<Button key="action"
                             variant={danger ? "danger" : "primary"}
                             isLoading={!!dlg.task} isDisabled={!!dlg.task}
                             onClick={() => dlg.run(action)}>
            {actionLabel}
        </Button>);
    if (dlg.cancel)
        buttons.push(<Button key="cancel" variant="secondary" onClick={dlg.cancel}>
            {cancelLabel}
        </Button>);
    else
        buttons.push(<Button key="close" variant="link" onClick={dlg.close}>
            {closeLabel}
        </Button>);

    return (
        <>
            {buttons}
            {dlg.progress ? <span>{dlg.progress}</span> : null}
        </>);
};

export const Dialog = ({
    state,
    id,
    title,
    danger,
    actionLabel, action,
    cancelLabel,
    closeLabel,
    children
}) => {
    return (
        <WithDialogState state={state}>
            <Modal id={id}
                   position="top"
                   variant="medium"
                   isOpen
                   onClose={state.close}
                   showClose={!state.task}
                   footer={<DialogFooter actionLabel={actionLabel} action={action} danger={danger}
                                         cancelLabel={cancelLabel || _("Stop")}
                                         closeLabel={closeLabel || _("Cancel")} />}
                   title={danger
                       ? <>
                           <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />
                           { "\n" }
                           {title}
                       </>
                       : title}>
                { state.error
                    ? <>
                        <Alert variant="danger" isInline title={state.error.message || state.error}>
                            {state.error.details}
                        </Alert>
                        <br />
                    </>
                    : null }
                {children}
            </Modal>
        </WithDialogState>);
};

export const Fields = ({ children }) => <Form isHorizontal>{children}</Form>;

export const TextField = ({ tag, label, helperText }) => {
    const dlg = useDialogState();
    const validated = dlg.value_errors[tag] ? "error" : "default";

    return (
        <FormGroup label={label}
                   validated={validated}
                   helperText={helperText}
                   helperTextInvalid={dlg.value_errors[tag]}>
            <TextInput value={dlg.values[tag]} onChange={val => dlg.set(tag, val)}
                       validated={validated} isDisabled={!!dlg.task}
                       id={dlg.make_id(tag)} />
        </FormGroup>);
};

export const NewPasswordField = ({ tag, label, helperText }) => {
    const dlg = useDialogState();
    const [show, setShow] = useState(false);

    return (
        <FormGroup label={label} helperText={helperText}>
            <InputGroup>
                <TextInput type={show ? "text" : "password"}
                           value={dlg.values[tag]}
                           onChange={val => dlg.set(tag, val)}
                           autoComplete="new-password"
                           isDisabled={!!dlg.task}
                           id={dlg.make_id(tag)} />
                <Button variant="control"
                        onClick={() => setShow(!show)}
                        isDisabled={!!dlg.task}>
                    { show ? <EyeSlashIcon /> : <EyeIcon /> }
                </Button>
            </InputGroup>
        </FormGroup>);
};

export const CheckboxField = ({ label, children }) => {
    return (
        <FormGroup label={label} hasNoPaddingTop>
            {children}
        </FormGroup>);
};

export const CheckboxFieldItem = ({ tag, label }) => {
    const dlg = useDialogState();

    return (
        <Checkbox label={label}
                  id={dlg.make_id(tag + label)}
                  isDisabled={!!dlg.task}
                  isChecked={dlg.values[tag]} onChange={val => dlg.set(tag, val)} />);
};
