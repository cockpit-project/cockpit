// SPDX-License-Identifier: LGPL-2.1-or-later
import React from 'react';
import cockpit from "cockpit";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState";
import { FormFieldGroup, FormFieldGroupHeader } from "@patternfly/react-core/dist/esm/components/Form";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText";

import './cockpit-components-dynamic-list.scss';

type ValidationError = Record<string, string>;

interface DynamicListItem {
    key: number;
    [field: string]: string | number | null;
}

interface DynamicListFormProps {
    emptyStateString: string;
    onChange: (list: (DynamicListItem | undefined)[]) => void;
    id: string;
    itemcomponent: React.ComponentType<{
        idx: number;
        item: DynamicListItem;
        id: string;
        onChange: (idx: number, field: string, value: string | null) => void;
        removeitem: (idx: number) => void;
        additem: () => void;
        options?: Record<string, unknown> | undefined;
        validationFailed?: ValidationError | undefined;
        onValidationChange?: ((value: ValidationError) => void) | undefined;
    }>;
    label: string;
    actionLabel: string;
    default?: Record<string, string | number | null>;
    formclass?: string;
    options?: Record<string, unknown>;
    /*
     * An array where each item represents a validation error of the corresponding row component index.
     *                     A row is strictly mapped to an item of the array by its index.
     *   Example: Let's have a dynamic form, where each row consists of 2 fields: name and email. Then a validation array of
     *            these rows would look like this:
     *   [
     *     { name: "Name must not be empty }, // first row
     *     { }, // second row
     *     { name: "Name cannot contain a number", email: "Email must contain '@'" } // third row
     *   ]
     */
    validationFailed?: (ValidationError | undefined)[];
    /*
     * Handler function which updates the parent's component's validation object.
     * Its parameter is an array the same structure as 'validationFailed'.
     */
    onValidationChange?: (validation: (ValidationError | undefined)[]) => void;
    helperText?: string;
}

interface DynamicListFormState {
    list: (DynamicListItem | undefined)[];
}

// Dynamic list with a variable number of rows. Each row is a custom component, usually an input field(s).
export class DynamicListForm extends React.Component<DynamicListFormProps, DynamicListFormState> {
    keyCounter: number;

    constructor(props: DynamicListFormProps) {
        super(props);
        this.state = {
            list: [],
        };
        this.keyCounter = 0;
        this.removeItem = this.removeItem.bind(this);
        this.addItem = this.addItem.bind(this);
        this.onItemChange = this.onItemChange.bind(this);
    }

    removeItem(idx: number) {
        const validationFailedDelta = this.props.validationFailed ? [...this.props.validationFailed] : [];
        // We also need to remove any error messages which the item (row) may have contained
        delete validationFailedDelta[idx];
        this.props.onValidationChange?.(validationFailedDelta);

        this.setState(state => {
            const items = [...state.list];
            // keep the list structure, otherwise all the indexes shift and the ID/key mapping gets broken
            delete items[idx];

            return { list: items };
        }, () => this.props.onChange(this.state.list));
    }

    addItem() {
        this.setState(state => {
            return { list: [...state.list, { key: this.keyCounter++, ...this.props.default }] };
        }, () => this.props.onChange(this.state.list));
    }

    onItemChange(idx: number, field: string, value: string | null) {
        this.setState(state => {
            const items = [...state.list];
            const item = items[idx];
            cockpit.assert(item, "item at index does not exist");
            item[field] = value || null;
            return { list: items };
        }, () => this.props.onChange(this.state.list));
    }

    render () {
        const { id, label, actionLabel, formclass, emptyStateString, helperText, validationFailed, onValidationChange } = this.props;
        const dialogValues = this.state;
        return (
            <FormFieldGroup header={
                <FormFieldGroupHeader
                    titleText={{ text: label, id: id + "-title" }}
                    actions={<Button variant="secondary" className="btn-add" onClick={this.addItem}>{actionLabel}</Button>}
                />
            } className={"dynamic-form-group " + formclass}>
                {
                    dialogValues.list.some(item => item !== undefined)
                        ? <>
                            {dialogValues.list.map((item, idx) => {
                                if (item === undefined)
                                    return null;

                                return React.createElement(this.props.itemcomponent, {
                                    idx,
                                    item,
                                    id: id + "-" + idx,
                                    key: idx,
                                    onChange: this.onItemChange,
                                    removeitem: this.removeItem,
                                    additem: this.addItem,
                                    options: this.props.options,
                                    validationFailed: validationFailed && validationFailed[idx],
                                    onValidationChange: (value: ValidationError) => {
                                        // Dynamic list consists of multiple rows. Therefore validationFailed object is presented as an array where each item represents a row
                                        // Each row/item then consists of key-value pairs, which represent a field name and it's validation error
                                        const delta = validationFailed ? [...validationFailed] : [];
                                        // Update validation of only a single row
                                        delta[idx] = value;

                                        // If a row doesn't contain any fields with errors anymore, we delete the item of the array
                                        // Deleting an item of an array replaces an item with an "empty item".
                                        // This guarantees that an array of validation errors maps to the correct rows
                                        if (Object.keys(delta[idx]).length == 0)
                                            delete delta[idx];

                                        onValidationChange?.(delta);
                                    },
                                });
                            })
                            }
                            {helperText &&
                            <HelperText>
                                <HelperTextItem>{helperText}</HelperTextItem>
                            </HelperText>
                            }
                        </>
                        : <EmptyState>
                            <EmptyStateBody>
                                {emptyStateString}
                            </EmptyStateBody>
                        </EmptyState>
                }
            </FormFieldGroup>
        );
    }
}
