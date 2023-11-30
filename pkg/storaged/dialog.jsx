/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

/* STORAGE DIALOGS

   To show a modal dialog, make a call like this:

       dialog_show({ Title: _("What is your name?"),
                     Fields: [
                       TextInput("name", _("Name"),
                                 { validate: val => (val == ""? _("Name can't be empty") : null) })
                     ]
                     Action: {
                       Title: _("Ok"),
                       action: vals => { console.log("Hello, " + vals.name + "!"); }
                     }
                   });

   The call to dialog_show will open the dialog and return
   immediately.  Later, when the user clicks on "Ok", the "action"
   function will be called with the values of the dialog fields.  The
   action function usually returns a promise, although it does not in
   the example above.  When that promise resolves, the dialog is
   closed.  When the promise is rejected, it's error is displayed in
   the dialog, and the dialog stays open.

   Fields are described by calling functions such as TextInput.  A
   number of generic ones are defined here, and you can define more
   specialized ones yourself.

   They are all called like this:

       FieldFunction(tag, title, { option: value, ... })

   The "tag" is used to uniquely identify this field in the dialog.
   The action function will receive the values of all fields in an
   object, and the tag of a field is the key in that object, for
   example.  The tag is also used to interact with a field from tests.

   ACTION FUNCTIONS

   The action function is called like this:

      action(values, progress_callback)

   The "values" parameter contains the validated values of the dialog
   fields and the "progress_callback" can be called by the action function
   to update the progress information in the dialog while it runs.

   The progress callback should be called like this:

      progress_callback(message, cancel_callback)

   The "message" will be displayed in the dialog and if "cancel_callback" is
   not null, the Cancel button in the dialog will be enabled and
   "cancel_callback" will be called when the user clicks it.

   The return value of the action function is normally a promise.  When
   it is resolved, the dialog is closed.  When it is rejected the value
   given in the rejection is displayed as an error in the dialog.

   If the error value is a string, it is displayed as a global failure
   message.  When it is an object, it contains errors for individual
   fields in this form:

      { tag1: message, tag2: message }

   As a special case, when "message" is "true", the field is rendered
   as having an error (with a red outline, say), but without any
   directly associated text.  The idea is that a group of fields is in
   error, and the error message for all of them is shown below the last
   one in the group.

   COMMON FIELD OPTIONS

   Each field function describes its options.  However, there are some
   options that apply to all fields:

   - value

   The initial value of the field.

   - visible: vals -> boolean

   This function determines whether the field is shown or not.

   - validate: (val, vals) -> null-or-error-string (or promise)

   The validate function receives the current value of the field and
   should return "null" (or something falsey) when that value is
   acceptable.  Otherwise, it should return a suitable error message.

   The second argument has all values of all fields, in case you need
   to look at more than one field.

   It is permissible to overwrite fields of "vals" to change the final
   value of a field.

   The validate function can also return a promise which resolves to
   null or an error message.  If that promise is rejected, that error
   is shown globally in the dialog as if the action function had
   failed.

   The validate function will only be called for currently visible
   fields.

   - widest_title

   This is a hack to force the column of titles to be a certain
   minimum width, namely the width of the widest_title.  This matters
   when there are rows that are only sometimes visible and the layout
   would jump around when they change visibility.

   Technically, the first column of a row shows the "title" but is as
   wide as its "widest_title".  The idea is that you put the widest
   title of all fields in the widest_title option of one of the rows
   that are always visible.

   - explanation

   A test to show below the field, as an explanation.

   RUNNING TASKS AND DYNAMIC UPDATES

   The dialog_show function returns an object that can be used to interact
   with the dialog in various ways while it is open.

       dlg = dialog_show(...)

   One can run asynchronous tasks:

       dlg.run("title", promise)

   This will disable the footer buttons and wait for promise to be resolved
   or rejected while showing "title" and a spinner.

   One can set field values and options:

       dlg.set_values({ tag1: value1, tag2: value2, ... })
       dlg.set_options(tag, { opt1: value1, opt2: value2, ... })

   It is also possible to specify a "update" function when creating the dialog:

       dialog_show({ ...
                     update: function (dlg, vals, trigger) { }
                     ... })

   This function is called whenever the values of fields are changed.  The
   "trigger" argument is the tag of the field that has just been changed.

   DEFINING NEW FIELD TYPES

   To define a new field type, just define a new function that follows
   a few rules.  Here is TextInput:

       export const TextInput = (tag, title, options) => {
        return {
            tag: tag,
            title: title,
            options: options,
            initial_value: "",

            render: (val, change) =>
                <input data-field={tag}
                       className="form-control" type="text" value={val}
                       onChange={event => change(event.target.value)}/>
        }
       }

   As you can see, a field function should return an object with a
   couple of fields.  The "tag", "title", and "options" field just
   store the parameters to the field function.  The rest are these:

   - initial_value

   This is the initial value of the field.

   - render: (val, change) -> React components

   This should render the value part of the field, that is, the second
   column in the table layout.  The title is in the first column and
   is rendered by the generic dialog machinery.

   The "val" parameter is the current value and you should make sure
   that the DOM element really shows that value, and not something
   that might have left behind by previous user interactions.

   The "change" parameter is a function that should be called with a
   new value for the field whenever the user has interacted with it.

   For the benefits of the integration tests, the DOM elements should
   also contain "data-field" and maybe a "data-field-type" attributes.  The
   "data-field" value should be that tag of the field, and
   "data-field-type" type is used by the tests to know how to interact
   with the field.  If you find to need it, just pick a reasonable value
   and extend the test suite to handle it.

   This function is not called at all for invisible fields.
 */

import cockpit from "cockpit";

import React, { useState } from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { DataList, DataListCell, DataListCheck, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Select as TypeAheadSelect, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select/index.js";
import { Slider } from "@patternfly/react-core/dist/esm/components/Slider/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Split } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { TextInput as TextInputPF4 } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { ExclamationTriangleIcon, InfoIcon, HelpIcon, EyeIcon, EyeSlashIcon } from "@patternfly/react-icons";
import { InputGroup } from "@patternfly/react-core/dist/esm/components/InputGroup/index.js";

import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { FormHelper } from "cockpit-components-form-helper";

import { fmt_size, block_name, format_size_and_text, format_delay, for_each_async } from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import client from "./client.js";

const _ = cockpit.gettext;

function make_rows(fields, values, errors, onChange) {
    return fields.map((f, i) => <Row key={i} field={f} values={values} errors={errors} onChange={onChange} />)
            .filter(r => r);
}

function is_visible(field, values) {
    return !field.options || field.options.visible == undefined || field.options.visible(values);
}

const Row = ({ field, values, errors, onChange }) => {
    const { tag, title, options } = field;

    if (!is_visible(field, values))
        return null;

    const error = errors && errors[tag];
    const explanation = options && options.explanation;
    const validated = (tag && errors && errors[tag]) ? 'error' : 'default';

    function change(val) {
        values[tag] = val;
        onChange(tag);
    }

    const field_elts = field.render(values[tag], change, validated, error);
    const nested_elts = (options && options.nested_fields
        ? make_rows(options.nested_fields, values, errors, onChange)
        : []);

    if (title || title == "") {
        let titleLabel = title;

        if (options.widest_title)
            titleLabel = (
                <>
                    <div className="widest-title">{options.widest_title}</div>
                    <div>{title}</div>
                </>
            );
        return (
            <FormGroup label={titleLabel} hasNoPaddingTop={field.hasNoPaddingTop}>
                { field_elts }
                { nested_elts }
                <FormHelper helperText={explanation} helperTextInvalid={validated && error} />
            </FormGroup>
        );
    } else if (!field.bare) {
        return (
            <FormGroup validated={validated} hasNoPaddingTop={field.hasNoPaddingTop}>
                { field_elts }
                { nested_elts }
                <FormHelper helperText={explanation} helperTextInvalid={validated && error} />
            </FormGroup>
        );
    } else
        return field_elts;
};

const Body = ({ body, teardown, fields, values, errors, isFormHorizontal, onChange }) => {
    let error_alert = null;

    if (errors && errors.toString() != "[object Object]") {
        // This is a global error from a failed action
        error_alert = <Alert variant='danger' isInline title={errors.toString()} />;
        errors = null;
    }

    return (
        <>
            { error_alert }
            { body || null }
            { fields.length > 0
                ? <Form onSubmit={apply_modal_dialog}
                        isHorizontal={isFormHorizontal !== false}>
                    { make_rows(fields, values, errors, onChange) }
                </Form>
                : null }
            { teardown }
        </>
    );
};

function flatten_fields(fields) {
    return fields.reduce(
        (acc, val) => acc.concat([val]).concat(val.options && val.options.nested_fields
            ? flatten_fields(val.options.nested_fields)
            : []),
        []);
}

export const dialog_open = (def) => {
    const nested_fields = def.Fields || [];
    const fields = flatten_fields(nested_fields);
    const values = { };
    let errors = null;

    fields.forEach(f => { values[f.tag] = f.initial_value });

    // We reconstruct the body every time the values change so that it
    // will be re-rendered.  This could be done with some state in the
    // Body component maybe, but we also want the values up here so
    // that we can pass them to validate and the action function.

    const update = () => {
        dlg.setProps(props());
    };

    const props = () => {
        return {
            id: "dialog",
            title: def.Title,
            titleIconVariant: (def.Action && (def.Action.Danger || def.Action.DangerButton)) ? "warning" : null,
            body: <Body body={def.Body}
                        teardown={def.Teardown}
                        fields={nested_fields}
                        values={values}
                        errors={errors}
                        isFormHorizontal={def.isFormHorizontal}
                        onChange={trigger => {
                            errors = null;
                            if (def.update)
                                def.update(self, values, trigger);
                            update();
                        }} />
        };
    };

    const update_footer = (running_title, running_promise) => {
        dlg.setFooterProps(footer_props(running_title, running_promise));
    };

    function run_action(progress_callback, variant) {
        const func = () => {
            return validate(variant)
                    .then(() => {
                        const visible_values = { variant };
                        fields.forEach(f => {
                            if (is_visible(f, values))
                                visible_values[f.tag] = values[f.tag];
                        });
                        if (def.Action.wrapper)
                            return def.Action.wrapper(visible_values, progress_callback,
                                                      def.Action.action);
                        else
                            return def.Action.action(visible_values, progress_callback);
                    })
                    .catch(errs => {
                        if (errs && errs.toString() != "[object Object]") {
                        // Log errors from failed actions, for debugging and
                        // to allow the test suite to catch known issues.
                            console.warn(errs.toString());
                        }
                        errors = errs;
                        update();
                        update_footer();
                        return Promise.reject();
                    });
        };
        return client.run(func);
    }

    const footer_props = (running_title, running_promise) => {
        const actions = [];

        function add_action(variant) {
            actions.push({
                caption: variant.Title,
                style: actions.length == 0 ? "primary" : "secondary",
                danger: def.Action.Danger || def.Action.DangerButton,
                disabled: running_promise != null || (def.Action.disable_on_error &&
                                                      errors && errors.toString() != "[object Object]"),
                clicked: progress_callback => run_action(progress_callback, variant.tag),
            });
        }

        if (def.Action) {
            if (def.Action.Title) {
                add_action({
                    Title: def.Action.Title,
                    tag: null,
                });
            }

            if (def.Action.Variants) {
                for (const v of def.Action.Variants) {
                    add_action(v);
                }
            }
        }

        const extra = (
            <div>
                { def.Action && def.Action.Danger
                    ? <HelperText><HelperTextItem variant="error">{def.Action.Danger} </HelperTextItem></HelperText>
                    : null
                }
            </div>);

        return {
            idle_message: (running_promise
                ? <>
                    <span>{running_title}</span>
                    <Spinner className="dialog-wait-ct-spinner" size="md" />
                </>
                : null),
            extra_element: extra,
            actions,
            cancel_button: def.Action ? {} : { text: _("Close"), variant: "secondary" }
        };
    };

    const validate = (variant) => {
        return Promise.all(fields.map(f => {
            if (is_visible(f, values) && f.options && f.options.validate)
                return f.options.validate(values[f.tag], values, variant);
            else
                return null;
        })).then(results => {
            const errors = { };
            fields.forEach((f, i) => { if (results[i]) errors[f.tag] = results[i]; });
            if (Object.keys(errors).length > 0)
                return Promise.reject(errors);
        });
    };

    const dlg = show_modal_dialog(props(), footer_props(null, null));

    const self = {
        run: (title, promise) => {
            update_footer(title, promise);
            promise.then(
                () => {
                    update_footer(null, null);
                },
                (errs) => {
                    if (errs) {
                        errors = errs;
                        update();
                    }
                    update_footer(null, null);
                });
        },

        set_values: (new_vals) => {
            Object.assign(values, new_vals);
            update();
        },

        get_value: (tag) => {
            return values[tag];
        },

        update_actions: (new_actions) => {
            Object.assign(def.Action, new_actions);
            update_footer(null, null);
        },

        set_nested_values: (key, new_vals) => {
            const updated = values[key];
            Object.assign(updated, new_vals);
            values[key] = updated;
            update();
        },

        get_options: (tag) => {
            for (const f of fields) {
                if (f.tag == tag) {
                    return f.options;
                }
            }
        },

        set_options: (tag, new_options) => {
            fields.forEach(f => {
                if (f.tag == tag) {
                    Object.assign(f.options, new_options);
                    update();
                }
            });
        },

        set_attribute: (name, value) => {
            def[name] = value;
            update();
        },

        add_danger: (danger) => {
            def.Action.Danger = <>{def.Action.Danger} {danger}</>;
            update();
        },

        close: () => {
            dlg.footerProps.dialog_done();
        }
    };

    for_each_async(def.Inits || [],
                   init => {
                       if (init) {
                           const promise = init.func(self);
                           self.run(init.title, promise);
                           return promise;
                       } else
                           return Promise.resolve();
                   });

    return self;
};

/* GENERIC FIELD TYPES
 */

export const TextInput = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || "",

        render: (val, change, validated) =>
            <TextInputPF4 data-field={tag} data-field-type="text-input"
                          validated={validated}
                          aria-label={title}
                          value={val}
                          isDisabled={options.disabled}
                          onChange={(_event, value) => change(value)} />
    };
};

const PassInputElement = ({ tag, title, options, val, change, validated }) => {
    const [show, setShow] = useState(false);

    return (
        <InputGroup>
            <TextInputPF4 data-field={tag} data-field-type="text-input"
                          validated={validated}
                          disabled={options.disabled}
                          aria-label={title}
                          autoComplete={options.new_password ? "new-password" : null}
                          type={show ? "text" : "password"}
                          value={val}
                          onChange={(_event, value) => change(value)} />
            <Button variant="control"
                    onClick={() => setShow(!show)}
                    isDisabled={options.disabled}>
                { show ? <EyeSlashIcon /> : <EyeIcon /> }
            </Button>
        </InputGroup>);
};

export const PassInput = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || "",

        render: (val, change, validated) =>
            <PassInputElement tag={tag}
                              title={title}
                              options={options}
                              val={val}
                              change={change}
                              validated={validated} />
    };
};

const TypeAheadSelectElement = ({ options, change }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [value, setValue] = useState(options.value);

    return (
        <TypeAheadSelect
            variant="typeahead"
            isCreatable
            createText={_("Use")}
            id="nfs-path-on-server"
            isOpen={isOpen}
            selections={value}
            onToggle={(_event, isOpen) => setIsOpen(isOpen)}
            onSelect={(event, value) => { setValue(value); change(value) }}
            onClear={() => setValue(false)}
            isDisabled={options.disabled}>
            {options.choices.map(entry => <SelectOption key={entry} value={entry} />)}
        </TypeAheadSelect>
    );
};

export const ComboBox = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || "",

        render: (val, change, validated) => {
            return <div data-field={tag} data-field-type="combobox">
                <TypeAheadSelectElement options={options} change={change} />
            </div>;
        }
    };
};

export const SelectOne = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || options.choices[0].value,

        render: (val, change, validated) => {
            return (
                <div data-field={tag} data-field-type="select" data-value={val}>
                    <FormSelect value={val} aria-label={tag}
                                validated={validated}
                                onChange={(_, value) => change(value)}>
                        { options.choices.map(c => <FormSelectOption value={c.value} isDisabled={c.disabled}
                                                                     key={c.title} label={c.title} />) }
                    </FormSelect>
                </div>
            );
        }
    };
};

export const SelectOneRadio = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || options.choices[0].value,
        hasNoPaddingTop: true,

        render: (val, change) => {
            return (
                <Split hasGutter data-field={tag} data-field-type="select-radio">
                    { options.choices.map(c => (
                        <Radio key={c.value} isChecked={val == c.value} data-data={c.value}
                            id={tag + '.' + c.value}
                            onChange={() => change(c.value)} label={c.title} />))
                    }
                </Split>
            );
        }
    };
};

export const SelectOneRadioVertical = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || options.choices[0].value,
        hasNoPaddingTop: true,

        render: (val, change) => {
            return (
                <div data-field={tag} data-field-type="select-radio">
                    { options.choices.map(c => (
                        <Radio key={c.value} isChecked={val == c.value} data-data={c.value}
                            id={tag + '.' + c.value}
                            onChange={() => change(c.value)} label={c.title} />))
                    }
                </div>
            );
        }
    };
};

export const SelectRow = (tag, headers, options) => {
    return {
        tag,
        title: null,
        options,
        initial_value: options.value || options.choices[0].value,

        render: (val, change) => {
            return (
                <table data-field={tag} data-field-type=" select-row" className="dialog-select-row-table">
                    <thead>
                        <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        { options.choices.map(row => {
                            return (
                                <tr key={row.value}
                                    onMouseDown={ev => { if (ev && ev.button === 0) change(row.value); }}
                                    className={row.value == val ? "highlight-ct" : ""}>
                                    {row.columns.map(c => <td key={c}>{c}</td>)}
                                </tr>
                            );
                        })
                        }
                    </tbody>
                </table>
            );
        }
    };
};

function nice_block_name(block) {
    return block_name(client.blocks[block.CryptoBackingDevice] || block);
}

export const SelectSpaces = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || [],
        hasNoPaddingTop: options.spaces.length == 0,

        render: (val, change) => {
            if (options.spaces.length === 0)
                return <span className="text-danger">{options.empty_warning}</span>;

            return (
                <DataList isCompact
                    data-field={tag} data-field-type="select-spaces">
                    { options.spaces.map(spc => {
                        const selected = (val.indexOf(spc) >= 0);
                        const block = spc.block ? nice_block_name(spc.block) : "";
                        const desc = block === spc.desc ? "" : spc.desc;

                        const on_change = (_event, checked) => {
                            // Be careful to keep "val" in the same order as "options.spaces".
                            if (checked && !selected)
                                change(options.spaces.filter(v => val.indexOf(v) >= 0 || v == spc));
                            else if (!checked && selected)
                                change(val.filter(v => (v != spc)));
                        };

                        const datalistcells = (
                            <DataListItemCells
                                            dataListCells={[
                                                <DataListCell key="select-space-name" className="select-space-name">
                                                    {format_size_and_text(spc.size, desc)}
                                                </DataListCell>,
                                                <DataListCell alignRight isFilled={false} key="select-space-details" className="select-space-details">
                                                    {block}
                                                </DataListCell>,
                                            ]}
                            />);

                        return (
                            <DataListItem key={spc.block ? spc.block.Device : spc.desc}>
                                <DataListItemRow>
                                    <DataListCheck id={(spc.block ? spc.block.Device : spc.desc) + "-row-checkbox"}
                                                   isDisabled={options.min_selected &&
                                                               selected && val.length <= options.min_selected}
                                                   isChecked={selected} onChange={on_change} />
                                    <label htmlFor={(spc.block ? spc.block.Device : spc.desc) + "-row-checkbox"}
                                           className='data-list-row-checkbox-label'>
                                        {datalistcells}
                                    </label>
                                </DataListItemRow>
                            </DataListItem>
                        );
                    })
                    }
                </DataList>
            );
        }
    };
};

export const SelectSpace = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: null,

        render: (val, change) => {
            if (options.spaces.length === 0)
                return <span className="text-danger">{options.empty_warning}</span>;

            return (
                <DataList isCompact
                    data-field={tag} data-field-type="select-spaces">
                    { options.spaces.map(spc => {
                        const block = spc.block ? nice_block_name(spc.block) : "";
                        const desc = block === spc.desc ? "" : spc.desc;
                        const on_change = (event) => {
                            if (event.target.checked)
                                change(spc);
                        };

                        return (
                            <DataListItem key={spc.block ? spc.block.Device : spc.desc}>
                                <DataListItemRow>
                                    <div className="pf-v5-c-data-list__item-control">
                                        <div className="pf-v5-c-data-list__check">
                                            <input type='radio' value={desc} name='space' checked={val == spc} onChange={on_change} />
                                        </div>
                                    </div>
                                    <DataListItemCells
                                        dataListCells={[
                                            <DataListCell key="select-space-name" className="select-space-name">
                                                {format_size_and_text(spc.size, desc)}
                                            </DataListCell>,
                                            <DataListCell alignRight isFilled={false} key="select-space-details" className="select-space-details">
                                                {block}
                                            </DataListCell>,
                                        ]}
                                    />
                                </DataListItemRow>
                            </DataListItem>
                        );
                    })
                    }
                </DataList>
            );
        }
    };
};

const CheckBoxComponent = ({ tag, val, title, tooltip, update_function }) => {
    return (
        <Checkbox data-field={tag} data-field-type="checkbox"
                  id={tag}
                  isChecked={val}
                  label={
                      <>
                          {title}
                          { tooltip && <Popover bodyContent={tooltip}>
                              <Button className="dialog-item-tooltip" variant="link">
                                  <HelpIcon />
                              </Button>
                          </Popover>
                          }
                      </>
                  }
                  onChange={(_, v) => update_function(v)} />
    );
};

export const CheckBoxes = (tag, title, options) => {
    return {
        tag,
        title,
        options,
        initial_value: options.value || { },
        hasNoPaddingTop: true,

        render: (val, change) => {
            const fieldset = options.fields.map(field => {
                const ftag = tag + "." + field.tag;
                const fval = (val[field.tag] !== undefined) ? val[field.tag] : false;
                function fchange(newval) {
                    val[field.tag] = newval;
                    change(val);
                }

                if (field.type === undefined || field.type == "checkbox")
                    return <CheckBoxComponent key={`checkbox-${ftag}`}
                                              tag={ftag}
                                              val={fval}
                                              title={field.title}
                                              tooltip={field.tooltip}
                                              options={options}
                                              update_function={fchange} />;
                else if (field.type == "checkboxWithInput")
                    return <TextInputCheckedComponent key={`checkbox-with-text-${ftag}`}
                                                      tag={ftag}
                                                      val={fval}
                                                      title={field.title}
                                                      update_function={fchange} />;
                else
                    return null;
            });

            if (options.fields.length == 1)
                return fieldset;

            return <>{ fieldset }</>;
        }
    };
};

const TextInputCheckedComponent = ({ tag, val, title, update_function }) => {
    return (
        <div data-field={tag} data-field-type="text-input-checked" key={tag}>
            <Checkbox isChecked={val !== false}
                      id={tag}
                      label={title}
                      onChange={(_event, checked) => update_function(checked ? "" : false)} />
            {val !== false && <TextInputPF4 id={tag + "-input"} value={val} onChange={(_event, value) => update_function(value)} />}
        </div>
    );
};

export const Skip = (className, options) => {
    return {
        tag: false,
        title: null,
        options,
        initial_value: false,

        render: () => {
            return <div className={className} />;
        }
    };
};

export const Message = (text, options) => {
    return {
        options,

        render: () => <HelperText><HelperTextItem icon={<InfoIcon />}>{text}</HelperTextItem></HelperText>,
    };
};

function size_slider_round(value, round) {
    if (round) {
        if (typeof round == "function")
            value = round(value);
        else
            value = Math.round(value / round) * round;
    } else {
        // Only produce integers by default
        value = Math.round(value);
    }
    return value;
}

class SizeSliderElement extends React.Component {
    constructor(props) {
        super();
        this.units = cockpit.get_byte_units(props.value || props.max);
        this.state = { unit: this.units.find(u => u.selected).factor };
    }

    render() {
        const { val, max, round, onChange, tag } = this.props;
        const min = this.props.min || 0;
        const { unit } = this.state;

        const change_slider = (_event, f) => {
            onChange(Math.max(min, size_slider_round(f, round)));
        };

        const change_text = (value) => {
            /* We keep the literal string as the value and only
             * interpret it below in the validate function inside
             * SizeSlider.  This allows people to freely interact with
             * the text input without getting the text changed all the
             * time by rounding, etc.
             */
            onChange({ text: value, unit });
        };

        let slider_val, text_val;
        if (val.text && val.unit) {
            slider_val = Number(val.text) * val.unit;
            text_val = val.text;
        } else {
            slider_val = val;
            text_val = cockpit.format_number(val / unit);
        }

        const change_unit = (_, u) => this.setState({
            unit: Number(u),
        });

        return (
            <Grid hasGutter className="size-slider">
                <GridItem span={12} sm={8}>
                    <Slider showBoundaries={false} min={min} max={max} step={(max - min) / 500}
                            value={slider_val} onChange={change_slider} />
                </GridItem>
                <GridItem span={6} sm={2}>
                    <TextInputPF4 className="size-text" value={text_val} onChange={(_event, value) => change_text(value)} />
                </GridItem>
                <GridItem span={6} sm={2}>
                    <FormSelect className="size-unit" value={unit} aria-label={tag} onChange={change_unit}>
                        { this.units.map(u => <FormSelectOption value={u.factor} key={u.name} label={u.name} />) }
                    </FormSelect>
                </GridItem>
            </Grid>
        );
    }
}

export const SizeSlider = (tag, title, options) => {
    const validate = (val, vals) => {
        let msg = null;

        if (val.text && val.unit) {
            // Convert to number.
            const unit = val.unit;

            val = Number(val.text) * unit;

            // As a special case, if the user types something that
            // looks like the maximum (or minimum) when formatted,
            // always use exactly the maximum (or minimum).  Otherwise
            // we have the confusing possibility that with the exact
            // same string in the text input, the size is sometimes
            // too large (or too small) and sometimes not.

            const sanitize = (limit) => {
                const fmt = cockpit.format_number(limit / unit);
                const parse = +fmt * unit;

                if (val == parse)
                    val = limit;
            };

            sanitize(all_options.min || 0);
            sanitize(all_options.max);

            val = size_slider_round(val, all_options.round);
            vals[tag] = val;
        }

        if (isNaN(val))
            msg = _("Size must be a number");
        else if (val === 0)
            msg = _("Size cannot be zero");
        else if (val < 0)
            msg = _("Size cannot be negative");
        else if (!options.allow_infinite && val > options.max)
            msg = _("Size is too large");
        else if (options.min !== undefined && val < options.min)
            msg = cockpit.format(_("Size must be at least $0"), fmt_size(options.min));
        else if (options.validate)
            msg = options.validate(val, vals);

        return msg;
    };

    /* This object might be mutated by dialog.set_options(), so we
       have to use it below for the 'max' option in order to pick up
       changes to it.
     */
    const all_options = Object.assign({ }, options, { validate });

    return {
        tag,
        title,
        options: all_options,
        initial_value: options.value || options.max || 0,

        render: (val, change) => {
            return (
                <div data-field={tag} data-field-type="size-slider">
                    <SizeSliderElement val={val}
                                       max={all_options.max}
                                       min={all_options.min}
                                       round={all_options.round}
                                       tag={tag}
                                       onChange={change} />
                </div>
            );
        }
    };
};

export const BlockingMessage = (usage) => {
    const usage_desc = {
        pvol: _("physical volume of LVM2 volume group"),
        "mdraid-member": _("member of MDRAID device"),
        vdo: _("backing device for VDO device"),
        "stratis-pool-member": _("member of Stratis pool"),
        mounted: _("Filesystem outside the target"),
        "btrfs-device": _("device of btrfs volume"),
    };

    const rows = [];
    usage.forEach(use => {
        if (use.blocking && use.block) {
            const fsys = client.blocks_stratis_fsys[use.block.path];
            const name = (fsys
                ? fsys.Devnode
                : block_name(client.blocks[use.block.CryptoBackingDevice] || use.block));
            rows.push({
                columns: [name, use.location || "-", usage_desc[use.usage] || "-"]
            });
        }
    });

    return (
        <div>
            <HelperText><HelperTextItem variant="warning">{_("This device is currently in use.")}</HelperTextItem></HelperText>
            <ListingTable variant='compact'
                          columns={[
                              { title: _("Device") },
                              { title: _("Location") },
                              { title: _("Use") }
                          ]}
                          rows={rows} />
        </div>);
};

const UsersPopover = ({ users }) => {
    const max = 10;
    const services = users.filter(u => u.unit);
    const processes = users.filter(u => u.pid);

    return (
        <Popover
            appendTo={document.body}
            bodyContent={
                <>
                    { services.length > 0
                        ? <>
                            <p><b>{_("Services using the location")}</b></p>
                            <List>
                                { services.slice(0, max).map((u, i) => <ListItem key={i}>{u.unit.replace(/\.service$/, "")}</ListItem>) }
                                { services.length > max ? <ListItem key={max}>...</ListItem> : null }
                            </List>
                        </>
                        : null
                    }
                    { services.length > 0 && processes.length > 0
                        ? <br />
                        : null
                    }
                    { processes.length > 0
                        ? <>
                            <p><b>{_("Processes using the location")}</b></p>
                            <List>
                                { processes.slice(0, max).map((u, i) => <ListItem key={i}>{u.comm} (user: {u.user}, pid: {u.pid})</ListItem>) }
                                { processes.length > max ? <ListItem key={max}>...</ListItem> : null }
                            </List>
                        </>
                        : null
                    }
                </>}>
            <Button variant="link" style={{ visibility: users.length == 0 ? "hidden" : null }}>
                <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /> { "\n" }
                {_("Currently in use")}
            </Button>
        </Popover>);
};

function is_expected_unmount(usage, expect_single_unmount) {
    return (expect_single_unmount && usage.length == 1 &&
            usage[0].usage == "mounted" && usage[0].location == expect_single_unmount);
}

export const TeardownMessage = (usage, expect_single_unmount) => {
    if (usage.length == 0)
        return null;

    if (is_expected_unmount(usage, expect_single_unmount))
        return <StopProcessesMessage mount_point={expect_single_unmount} users={usage[0].users} />;

    const rows = [];
    usage.forEach((use, index) => {
        if (use.block) {
            const fsys = client.blocks_stratis_fsys[use.block.path];
            const name = (fsys
                ? fsys.Devnode
                : block_name(client.blocks[use.block.CryptoBackingDevice] || use.block));
            let location = use.location;
            if (use.usage == "mounted") {
                location = client.strip_mount_point_prefix(location);
                if (location === false)
                    location = _("(Not part of target)");
            }
            rows.push({
                columns: [name,
                    location || "-",
                    use.actions.length ? use.actions.join(", ") : "-",
                    {
                        title: <UsersPopover users={use.users || []} />,
                        props: { className: "pf-v5-u-text-align-right" }
                    }
                ]
            });
        }
    });

    return (
        <div className="modal-footer-teardown">
            <p>{_("These changes will be made:")}</p>
            <ListingTable variant='compact'
                          columns={[
                              { title: _("Device") },
                              { title: _("Location") },
                              { title: _("Action") },
                              { title: "" }
                          ]}
                          rows={rows} />
        </div>);
};

export function teardown_danger_message(usage, expect_single_unmount) {
    if (is_expected_unmount(usage, expect_single_unmount))
        return stop_processes_danger_message(usage[0].users);

    const usage_with_users = usage.filter(u => u.users);
    const n_processes = usage_with_users.reduce((sum, u) => sum + u.users.filter(u => u.pid).length, 0);
    const n_services = usage_with_users.reduce((sum, u) => sum + u.users.filter(u => u.unit).length, 0);
    if (n_processes > 0 && n_services > 0) {
        return _("Related processes and services will be forcefully stopped.");
    } else if (n_processes > 0) {
        return _("Related processes will be forcefully stopped.");
    } else if (n_services > 0) {
        return _("Related services will be forcefully stopped.");
    } else {
        return null;
    }
}

export function init_active_usage_processes(client, usage, expect_single_unmount) {
    return {
        title: _("Checking related processes"),
        func: dlg => {
            return for_each_async(usage, u => {
                if (u.usage == "mounted") {
                    return client.find_mount_users(u.location)
                            .then(users => {
                                u.users = users;
                            });
                } else
                    return Promise.resolve();
            }).then(() => {
                dlg.set_attribute("Teardown", TeardownMessage(usage, expect_single_unmount));
                const msg = teardown_danger_message(usage, expect_single_unmount);
                if (msg)
                    dlg.add_danger(msg);
            });
        }
    };
}

export const StopProcessesMessage = ({ mount_point, users }) => {
    if (!users || users.length == 0)
        return null;

    const process_rows = users.filter(u => u.pid).map(u => {
        return {
            columns: [
                u.pid,
                { title: u.cmd.substr(0, 100), props: { modifier: "breakWord" } },
                u.user || "-",
                { title: format_delay(-u.since * 1000), props: { modifier: "nowrap" } }
            ]
        };
    });

    const service_rows = users.filter(u => u.unit).map(u => {
        return {
            columns: [
                { title: u.unit.replace(/\.service$/, ""), props: { modifier: "breakWord" } },
                { title: u.cmd.substr(0, 100), props: { modifier: "breakWord" } },
                { title: u.desc || "", props: { modifier: "breakWord" } },
                { title: format_delay(-u.since * 1000), props: { modifier: "nowrap" } }
            ]
        };
    });

    // If both tables are shown, we press the columns into a uniform
    // width to reduce the visual mess.
    const colprops = (process_rows.length > 0 && service_rows.length > 0) ? { width: 25 } : { };

    return (
        <div className="modal-footer-teardown">
            { process_rows.length > 0
                ? <>
                    <p>{fmt_to_fragments(_("The mount point $0 is in use by these processes:"), <b>{mount_point}</b>)}</p>
                    <ListingTable variant='compact'
                                  columns={
                                      [
                                          { title: _("PID"), props: colprops },
                                          { title: _("Command"), props: colprops },
                                          { title: _("User"), props: colprops },
                                          { title: _("Runtime"), props: colprops }
                                      ]
                                  }
                                      rows={process_rows} />
                </>
                : null
            }
            { process_rows.length > 0 && service_rows.length > 0
                ? <br />
                : null
            }
            { service_rows.length > 0
                ? <>
                    <p>{fmt_to_fragments(_("The mount point $0 is in use by these services:"), <b>{mount_point}</b>)}</p>
                    <ListingTable variant='compact'
                                  columns={
                                      [
                                          { title: _("Service"), props: colprops },
                                          { title: _("Command"), props: colprops },
                                          { title: _("Description"), props: colprops },
                                          { title: _("Runtime"), props: colprops }
                                      ]
                                  }
                                  rows={service_rows} />
                </>
                : null
            }
        </div>);
};

export const stop_processes_danger_message = (users) => {
    const n_processes = users.filter(u => u.pid).length;
    const n_services = users.filter(u => u.unit).length;

    if (n_processes > 0 && n_services > 0)
        return _("The listed processes and services will be forcefully stopped.");
    else if (n_processes > 0)
        return _("The listed processes will be forcefully stopped.");
    else if (n_services > 0)
        return _("The listed services will be forcefully stopped.");
    else
        return null;
};
