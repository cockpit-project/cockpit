/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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

import React, { useState, useReducer } from "react";
import { createRoot } from 'react-dom/client';
import cockpit from 'cockpit';

import '../lib/patternfly/patternfly-6-cockpit.scss';

import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Bullseye } from "@patternfly/react-core/dist/esm/layouts/Bullseye";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner";

import { WithDialogs, useDialogs } from 'dialogs';

import {
    useDialogState, DialogState,
    useDialogState_async,
    DialogError,
    DialogErrorMessage,
    DialogField,
    DialogCheckbox,
    DialogTextInput,
    DialogRadioSelect,
    DialogDropdownSelect, DialogDropdownSelectObject,
    DialogHelperText,
    DialogActionButton, DialogCancelButton,
} from 'cockpit/dialog';

import 'cockpit-dark-theme'; // once per page
import 'page.scss';

function List<T>({
    label,
    field,
    Component,
    init,
} : {
    label: string
    field: DialogField<T[]>,
    Component: ({ field } : { field: DialogField<T> }) => React.ReactNode,
    init: T,
}) {
    return (
        <FormGroup label={label} id={field.id()}>
            { field.map((f, i) => (
                <Split key={i}>
                    <SplitItem isFilled>
                        <Component field={f} />
                    </SplitItem>
                    <SplitItem>
                        <Button
                            id={f.id("remove")}
                            variant="link"
                            onClick={() => field.remove(i)}
                        >
                            Remove
                        </Button>
                    </SplitItem>
                </Split>
            ))}
            <DialogHelperText field={field} />
            <Button
                id={field.id("add")}
                variant="link"
                onClick={() => field.add(init)}
            >
                Add
            </Button>
        </FormGroup>
    );
}

const StringList = ({
    field,
    label,
} : {
    field: DialogField<string[]>,
    label: string
}) => {
    return (
        <List
            label={label}
            field={field}
            Component={DialogTextInput}
            init=""
        />
    );
};

interface Name {
    name: string;
    _length_cache: Record<string, number>;
}

const NameInput = ({
    field,
} : {
    field: DialogField<Name>,
}) => {
    return <DialogTextInput field={field.sub("name")} />;
};

function validate_Name(field: DialogField<Name>, countAsyncValidation: () => void) {
    const { _length_cache } = field.get();
    field.sub("name").validate_async(1000, async n => {
        await async_sleep(2000);
        countAsyncValidation();
        _length_cache[n] = n.length;
        if (n.length % 2)
            return "Must have even number of characters";
    });
}

const NameList = ({
    field,
    label,
} : {
    field: DialogField<Name[]>,
    label: string
}) => {
    return (
        <List
            label={label}
            field={field}
            Component={NameInput}
            init={{ name: "", _length_cache: { } }}
        />
    );
};

const OptionalTextInput = ({
    field_label,
    checkbox_label,
    field,
} : {
    field_label: string,
    checkbox_label: string;
    field: DialogField<false | string>,
}) => {
    const val = field.get();
    let body;

    if (val === false) {
        body = (
            <Checkbox
                id={field.id("checkbox")}
                isChecked={false}
                label={checkbox_label}
                onChange={() => field.set("")}
            />
        );
    } else {
        body = (
            <>
                <Checkbox
                    id={field.id("checkbox")}
                    isChecked
                    label={checkbox_label}
                    onChange={() => field.set(false)}
                />
                <DialogTextInput field={field.at(val)} />
            </>
        );
    }

    return (
        <FormGroup
            label={field_label}
        >
            {body}
            <DialogHelperText field={field} />
        </FormGroup>
    );
};

function async_sleep(n: number) {
    return new Promise(resolve => {
        window.setTimeout(resolve, n);
    });
}

interface Color {
    name: string,
    red: number,
    green: number,
    blue: number,
}

const colors: Color[] = [
    { name: "red", red: 1, green: 0, blue: 0 },
    { name: "green", red: 0, green: 1, blue: 0 },
    { name: "blue", red: 0, green: 0, blue: 1 },
];

interface ExampleValues {
    flag: boolean;
    text: string;
    radio: string;
    dropdown: string;
    color: Color,
    list: string[];
    async: Name[];
    alternative: false | string;
    error: string;
}

const ExampleDialog = ({
    setResult,
    countAsyncValidation,
} : {
    setResult: (values: ExampleValues) => void,
    countAsyncValidation: () => void,
}) => {
    const Dialogs = useDialogs();

    const init: ExampleValues = {
        flag: false,
        text: "",
        radio: "one",
        dropdown: "one",
        color: colors[0],
        list: [],
        async: [],
        alternative: false,
        error: "none",
    };

    function validate(dlg: DialogState<ExampleValues>) {
        if (dlg.values.flag) {
            dlg.field("text").validate(v => {
                if (!v)
                    return "Text can not be empty";
            });
        }
        dlg.field("list").forEach(v => {
            v.validate(vv => {
                if (vv == ".")
                    return "No dots";
            });
        });
        dlg.field("async").forEach(v => validate_Name(v, countAsyncValidation));
    }

    const dlg = useDialogState(init, validate);

    async function apply(values: ExampleValues) {
        setResult(values);

        if (values.error == "custom") {
            throw new DialogError("This is a failure", <code>1234-567-98A</code>);
        } else if (values.error == "from") {
            const err = new Error("no such file or scraper");
            throw DialogError.fromError("Tool not found", err);
        } else if (values.error == "from-random") {
            const err = [1, 2, 3, 4];
            throw DialogError.fromError("Too random", err);
        } else if (values.error == "message") {
            // eslint-disable-next-line no-throw-literal
            throw { message: "segmentation fault" };
        } else if (values.error == "spawn") {
            await cockpit.spawn(["ls", "--no-such-option"], { err: "message" });
        } else if (values.error == "random") {
            // eslint-disable-next-line no-throw-literal
            throw [1, 2, 3, 4];
        }
    }

    function update_color(color: Color) {
        dlg.field("text").set(color.name);
    }

    return (
        <Modal
            id="dialog"
            position="top"
            variant="medium"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title="Demo" />
            <ModalBody>
                <DialogErrorMessage dialog={dlg} />
                <Form isHorizontal>
                    <DialogCheckbox
                        field_label="Checkbox"
                        checkbox_label="Enable text"
                        field={dlg.field("flag")}
                    />
                    <DialogTextInput
                        label="Text"
                        field={dlg.field("text")}
                        excuse={!dlg.values.flag && "Disabled"}
                        explanation="Explanation"
                        warning={dlg.values.text == "warn" ? "Warning" : null}
                    />
                    {
                        // Calling "map" on a non-array should just do nothing.
                        dlg.field("text").map((v, i) => <span key={i}>{v.get()}</span>)
                    }
                    <DialogRadioSelect
                        label="Radio"
                        field={dlg.field("radio")}
                        options={
                            [
                                {
                                    value: "one",
                                    label: "Eins",
                                    explanation: "One explanation"
                                },
                                {
                                    value: "two",
                                    label: "Zwei",
                                    explanation: "Two explanation",
                                    excuse: "disabled",
                                },
                                {
                                    value: "three",
                                    label: "Drei",
                                },
                            ]
                        }
                    />
                    <DialogDropdownSelect
                        label="Dropdown"
                        field={dlg.field("dropdown")}
                        options={
                            [
                                { value: "one", label: "Eins" },
                                { value: "two", label: "Zwei" },
                                { value: "three", label: "Drei" },
                            ]
                        }
                        warning={dlg.field("dropdown").get() == "two" ? "There is a discount if you buy three." : null}
                    />
                    <DialogDropdownSelectObject
                        label="DropdownObject"
                        field={dlg.field("color", update_color)}
                        options={colors}
                        option_label={c => c.name}
                    />
                    <StringList label="List" field={dlg.field("list")} />
                    <NameList label="Async" field={dlg.field("async")} />
                    <OptionalTextInput
                        field_label="Alternative"
                        checkbox_label="Custom value"
                        field={dlg.field("alternative")}
                    />
                    <DialogDropdownSelectObject
                        label="Error"
                        field={dlg.field("error")}
                        options={["none", "custom", "from", "from-random", "message", "spawn", "random"]}
                        warning={dlg.field("error").get() != "none" ? "There will be an error" : null}
                    />
                </Form>
            </ModalBody>
            <ModalFooter>
                <DialogActionButton dialog={dlg} action={apply} onClose={Dialogs.close}>
                    Apply
                </DialogActionButton>
                <DialogCancelButton dialog={dlg} onClose={Dialogs.close} />
            </ModalFooter>
        </Modal>
    );
};

const ExampleButton = () => {
    const Dialogs = useDialogs();
    const [values, setValues] = useState<ExampleValues | null>(null);
    const [asyncValidationsBase, setAsycountAsyncValidationsBase] = useState<number>(0);
    const [asyncValidations, countAsyncValidation] = useReducer(x => x + 1, 0);

    function entry(id: string, val: string) {
        return (
            <DescriptionListGroup>
                <DescriptionListTerm>{id}</DescriptionListTerm>
                <DescriptionListDescription id={id}>{val}</DescriptionListDescription>
            </DescriptionListGroup>
        );
    }

    return (
        <>
            <Button
                id="open"
                onClick={
                    () => {
                        setAsycountAsyncValidationsBase(asyncValidations);
                        Dialogs.show(
                            <ExampleDialog
                                setResult={setValues}
                                countAsyncValidation={countAsyncValidation}
                            />
                        );
                    }
                }
            >
                Open dialog
            </Button>
            { values &&
                <DescriptionList isHorizontal>
                    { entry("flag", String(values.flag)) }
                    { values.flag && entry("text", values.text) }
                    { entry("radio", values.radio) }
                    { entry("dropdown", values.dropdown) }
                    { entry("color", values.color.red + "/" + values.color.green + "/" + values.color.blue) }
                    { entry("list", values.list.join("/")) }
                    { entry("async", values.async.map(n => n.name + ":" + String(n._length_cache[n.name])).join("/")) }
                    { entry("asyncVals", String(asyncValidations - asyncValidationsBase)) }
                    { entry("alternative", JSON.stringify(values.alternative)) }
                </DescriptionList>
            }
        </>
    );
};

interface ExampleWithInitFuncValues {
    text: string;
}

const ExampleDialogWithInitFunc = () => {
    const Dialogs = useDialogs();

    function init(): ExampleWithInitFuncValues {
        return {
            text: "foo",
        };
    }

    const dlg = useDialogState(init);

    return (
        <Modal
            id="dialog"
            position="top"
            variant="medium"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title="Demo" />
            <ModalBody>
                <DialogErrorMessage dialog={dlg} />
                <Form isHorizontal>
                    <DialogTextInput
                        label="Text"
                        field={dlg.field("text")}
                    />
                </Form>
            </ModalBody>
            <ModalFooter>
                <DialogCancelButton dialog={dlg} onClose={Dialogs.close} />
            </ModalFooter>
        </Modal>
    );
};

interface AsyncExampleValues {
    text: string;
}

const AsyncExampleDialog = ({
    throwError = 0,
} : {
    throwError?: number,
}) => {
    const Dialogs = useDialogs();

    async function init(): Promise<AsyncExampleValues> {
        if (throwError == 1)
            throw new Error("can't get the thing");
        else if (throwError == 2)
            throw new DialogError("Getting the thing failed", <i>can't get it</i>);

        await async_sleep(500);
        return {
            text: "",
        };
    }

    function validate(dlg: DialogState<AsyncExampleValues>) {
        dlg.field("text").validate_async(0, async () => {
            throw Error("upps");
        });
    }

    const dlg = useDialogState_async(init, validate);

    async function apply() {
        await async_sleep(1000);
        Dialogs.close();
    }

    function update_top(values: AsyncExampleValues) {
        console.log("TOP", JSON.stringify(values));
    }

    let body;
    if (!dlg) {
        body = (
            <Bullseye>
                <Spinner />
            </Bullseye>
        );
    } else if (dlg instanceof DialogError) {
        body = null;
    } else if (dlg instanceof DialogState) {
        const vals = dlg.top(update_top);
        body = (
            <Form isHorizontal>
                <DialogTextInput label="Text" field={vals.sub("text")} />
            </Form>
        );
    }

    return (
        <Modal
            id="dialog"
            position="top"
            variant="medium"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title="Async Demo" />
            <ModalBody>
                <DialogErrorMessage dialog={dlg} />
                { body }
            </ModalBody>
            <ModalFooter>
                <DialogActionButton dialog={dlg} action={apply}>
                    Apply
                </DialogActionButton>
                <DialogCancelButton dialog={dlg} onClose={Dialogs.close} />
            </ModalFooter>
        </Modal>
    );
};

const SimpleExampleButtons = () => {
    const Dialogs = useDialogs();

    return (
        <>
            <Button
                id="open-with-func"
                onClick={() => Dialogs.show(<ExampleDialogWithInitFunc />)}
            >
                Open init-func dialog
            </Button>
            <Button
                id="open-async"
                onClick={() => Dialogs.show(<AsyncExampleDialog />)}
            >
                Open async dialog
            </Button>
            <Button
                id="open-error"
                onClick={() => Dialogs.show(<AsyncExampleDialog throwError={1} />)}
            >
                Open Error dialog
            </Button>
            <Button
                id="open-dialog-error"
                onClick={() => Dialogs.show(<AsyncExampleDialog throwError={2} />)}
            >
                Open DialogError dialog
            </Button>
        </>
    );
};

const Demo = () => {
    return (
        <WithDialogs>
            <Page isContentFilled className="no-masthead-sidebar">
                <PageSection>
                    <ExampleButton />
                    <SimpleExampleButtons />
                </PageSection>
            </Page>
        </WithDialogs>
    );
};

document.addEventListener("DOMContentLoaded", function() {
    window.debugging = "dialog";
    createRoot(document.getElementById('app')!).render(<Demo />);
});
