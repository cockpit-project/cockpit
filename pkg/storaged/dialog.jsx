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
import {
    Alert,
    FormSelect, FormSelectOption,
    Button,
    Checkbox,
    DataList, DataListItem, DataListCheck, DataListItemRow, DataListItemCells, DataListCell,
    Form, FormGroup,
    Radio,
    Select as TypeAheadSelect, SelectOption, SelectVariant,
    Spinner, Split,
    TextInput as TextInputPF4,
    Tooltip, TooltipPosition,
} from "@patternfly/react-core";
import { InfoCircleIcon } from "@patternfly/react-icons";

import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";

import { fmt_size, block_name, format_size_and_text } from "./utils.js";
import client from "./client.js";

import "form-layout.scss";

const _ = cockpit.gettext;

const Row = ({ field, values, errors, onChange }) => {
    const { tag, title, options } = field;

    const error = errors && errors[tag];
    const explanation = options && options.explanation;
    const validated = (tag && errors && errors[tag]) ? 'error' : 'default';

    function change(val) {
        values[tag] = val;
        onChange(tag);
    }

    const children = field.render(values[tag], change, validated, error);

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
            <FormGroup label={titleLabel} validated={validated}
                       helperTextInvalid={error} helperText={explanation} hasNoPaddingTop={field.hasNoPaddingTop}>
                { children }
            </FormGroup>
        );
    } else if (!field.bare) {
        return (
            <FormGroup validated={validated}
                       helperTextInvalid={error} helperText={explanation} hasNoPaddingTop={field.hasNoPaddingTop}>
                { children }
            </FormGroup>
        );
    } else
        return children;
};

function is_visible(field, values) {
    return !field.options || field.options.visible == undefined || field.options.visible(values);
}

const Body = ({ body, fields, values, errors, isFormHorizontal, onChange }) => {
    function make_row(field, index) {
        if (field.length !== undefined)
            return make_rows(field, index);

        if (is_visible(field, values))
            return <Row key={index} field={field} values={values} errors={errors} onChange={onChange} />;
    }

    function make_rows(fields, index) {
        const rows = fields.map(make_row).filter(r => r);
        if (rows.length === 0)
            return null;
        else if (index === undefined) // top-level
            return <Form onSubmit={apply_modal_dialog}
                         isHorizontal={isFormHorizontal !== false}>{ rows }</Form>;
        else // nested
            return <FormGroup key={index}>{ rows }</FormGroup>;
    }

    return (
        <>
            { body || null }
            { make_rows(fields) }
        </>
    );
};

function flatten(arr1) {
    return arr1.reduce((acc, val) => Array.isArray(val) ? acc.concat(flatten(val)) : acc.concat(val), []);
}

export const dialog_open = (def) => {
    const nested_fields = def.Fields || [];
    const fields = flatten(nested_fields);
    const values = { };

    fields.forEach(f => { values[f.tag] = f.initial_value });

    // We reconstruct the body every time the values change so that it
    // will be re-rendered.  This could be done with some state in the
    // Body component maybe, but we also want the values up here so
    // that we can pass them to validate and the action function.

    const update = (errors, trigger) => {
        if (def.update)
            def.update(self, values, trigger);
        dlg.setProps(props(errors));
    };

    const props = (errors) => {
        return {
            id: "dialog",
            title: def.Title,
            body: <Body body={def.Body}
                        fields={nested_fields}
                        values={values}
                        errors={errors}
                        isFormHorizontal={def.isFormHorizontal}
                        onChange={trigger => update(null, trigger)} />
        };
    };

    const update_footer = (running_title, running_promise) => {
        dlg.setFooterProps(footer_props(running_title, running_promise));
    };

    const footer_props = (running_title, running_promise) => {
        let actions = [];
        if (def.Action) {
            actions = [
                {
                    caption: def.Action.Title,
                    style: (def.Action.Danger || def.Action.DangerButton) ? "danger" : "primary",
                    disabled: running_promise != null,
                    clicked: function (progress_callback) {
                        const func = () => {
                            return validate()
                                    .then(() => {
                                        const visible_values = { };
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
                                    .catch(error => {
                                        if (error.toString() != "[object Object]") {
                                            return Promise.reject(error);
                                        } else {
                                            update(error, null);
                                            return Promise.reject();
                                        }
                                    });
                        };
                        return client.run(func);
                    }
                }
            ];
        }

        const extra = <div>
            { def.Footer }
            { def.Action && def.Action.Danger ? <Alert isInline variant='danger' title={def.Action.Danger} /> : null }
        </div>;

        return {
            idle_message: (running_promise
                ? <>
                    <span>{running_title}</span>
                    <Spinner isSVG className="dialog-wait-ct-spinner" size="md" />
                </>
                : null),
            extra_element: extra,
            actions: actions,
            cancel_caption: def.Action ? _("Cancel") : _("Close")
        };
    };

    const validate = () => {
        return Promise.all(fields.map(f => {
            if (is_visible(f, values) && f.options && f.options.validate)
                return f.options.validate(values[f.tag], values);
            else
                return null;
        })).then(results => {
            const errors = { };
            fields.forEach((f, i) => { if (results[i]) errors[f.tag] = results[i]; });
            if (Object.keys(errors).length > 0)
                return Promise.reject(errors);
        });
    };

    const dlg = show_modal_dialog(props(null), footer_props(null, null));

    const self = {
        run: (title, promise) => {
            update_footer(title, promise);
            promise.then(
                () => {
                    update_footer(null, null);
                },
                (errors) => {
                    if (errors)
                        update(errors, null);
                    update_footer(null, null);
                });
        },

        set_values: (new_vals) => {
            Object.assign(values, new_vals);
            update(null, null);
        },

        set_nested_values: (key, new_vals) => {
            const updated = values[key];
            Object.assign(updated, new_vals);
            values[key] = updated;
            update(null, null);
        },

        set_options: (tag, new_options) => {
            fields.forEach(f => {
                if (f.tag == tag) {
                    Object.assign(f.options, new_options);
                    update(null, null);
                }
            });
        },

        close: () => {
            dlg.footerProps.dialog_done();
        }
    };

    return self;
};

/* GENERIC FIELD TYPES
 */

export const TextInput = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || "",

        render: (val, change, validated) =>
            <TextInputPF4 data-field={tag} data-field-type="text-input"
                          validated={validated}
                          aria-label={title}
                          value={val}
                          isDisabled={options.disabled}
                          onChange={change} />
    };
};

export const PassInput = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || "",

        render: (val, change, validated) =>
            <TextInputPF4 data-field={tag} data-field-type="text-input"
                   validated={validated}
                   aria-label={title}
                   type="password" value={val}
                   onChange={change} />
    };
};

const TypeAheadSelectElement = ({ options, change }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [value, setValue] = useState(null);

    return (
        <TypeAheadSelect
            variant={SelectVariant.typeahead}
            id="nfs-path-on-server"
            isOpen={isOpen}
            selections={value}
            onToggle={isOpen => setIsOpen(isOpen)}
            onSelect={(event, value) => { setValue(value); change(value) }}
            onClear={() => setValue(false)}
            isDisabled={options.disabled}>
            {options.choices.map(entry => <SelectOption key={entry} value={entry} />)}
        </TypeAheadSelect>
    );
};

export const ComboBox = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || "",

        render: (val, change) =>
            <div data-field={tag} data-field-type="combobox">
                <TypeAheadSelectElement options={options} change={change} />
            </div>
    };
};

export const SelectOne = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || options.choices[0].value,

        render: (val, change, validated) => {
            return (
                <div data-field={tag} data-field-type="select" data-value={val}>
                    <FormSelect value={val} aria-label={tag}
                                validated={validated}
                                onChange={change}>
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
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || options.choices[0].value,
        hasNoPaddingTop: true,

        render: (val, change) => {
            return (
                <Split hasGutter data-field={tag} data-field-type="select-radio">
                    { options.choices.map(c => (
                        <Radio key={c.value} isChecked={val == c.value} data-data={c.value}
                            id={tag + '.' + c.value}
                            onChange={event => change(c.value)} label={c.title} />))
                    }
                </Split>
            );
        }
    };
};

export const SelectRow = (tag, headers, options) => {
    return {
        tag: tag,
        title: null,
        options: options,
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

export const SelectSpaces = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: [],

        render: (val, change) => {
            if (options.spaces.length === 0)
                return <span className="text-danger">{options.empty_warning}</span>;

            return (
                <DataList isCompact
                    data-field={tag} data-field-type="select-spaces">
                    { options.spaces.map(spc => {
                        const selected = (val.indexOf(spc) >= 0);
                        const block = spc.block ? block_name(spc.block) : "";
                        const desc = block === spc.desc ? "" : spc.desc;

                        const on_change = (checked) => {
                            if (checked && !selected)
                                change(val.concat(spc));
                            else if (!checked && selected)
                                change(val.filter(v => (v != spc)));
                        };

                        return (
                            <DataListItem key={spc.block ? spc.block.Device : spc.desc}>
                                <DataListItemRow>
                                    <DataListCheck id={(spc.block ? spc.block.Device : spc.desc) + "-row-checkbox"}
                                                   isChecked={selected} onChange={on_change} />
                                    <label htmlFor={(spc.block ? spc.block.Device : spc.desc) + "-row-checkbox"}
                                           className='data-list-row-checkbox-label'>
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
        tag: tag,
        title: title,
        options: options,
        initial_value: null,

        render: (val, change) => {
            if (options.spaces.length === 0)
                return <span className="text-danger">{options.empty_warning}</span>;

            return (
                <DataList isCompact
                    data-field={tag} data-field-type="select-spaces">
                    { options.spaces.map(spc => {
                        const block = spc.block ? block_name(spc.block) : "";
                        const desc = block === spc.desc ? "" : spc.desc;
                        const on_change = (event) => {
                            if (event.target.checked)
                                change(spc);
                        };

                        return (
                            <DataListItem key={spc.block ? spc.block.Device : spc.desc}>
                                <DataListItemRow>
                                    <div className="pf-c-data-list__item-control">
                                        <div className="pf-c-data-list__check">
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
        <div key={tag} className="ct-storage-checkbox">
            <Checkbox data-field={tag} data-field-type="checkbox"
                      id={tag}
                      isChecked={val}
                      label={
                          <>
                              {title}
                              { tooltip && <Tooltip id="tip-service" content={tooltip} position={TooltipPosition.right}>
                                  <Button className="dialog-item-tooltip" variant="link">
                                      <InfoCircleIcon />
                                  </Button>
                              </Tooltip>
                              }
                          </>
                      }
                      onChange={update_function} />
        </div>
    );
};

export const CheckBoxes = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
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
            });

            if (options.fields.length == 1)
                return fieldset;

            return (
                <div role="group">
                    { fieldset }
                </div>
            );
        }
    };
};

const TextInputCheckedComponent = ({ tag, val, title, update_function }) => {
    return (
        <div className="ct-storage-checkbox" data-field={tag} data-field-type="text-input-checked" key={tag}>
            <Checkbox isChecked={val !== false}
                      id={tag}
                      label={title}
                      onChange={checked => update_function(checked ? "" : false)} />
            {val !== false && <TextInputPF4 id={tag + "-input"} value={val} onChange={update_function} />}
        </div>
    );
};

export const Skip = (className, options) => {
    return {
        tag: false,
        title: null,
        options: options,
        initial_value: false,

        render: () => {
            return <div className={className} />;
        }
    };
};

const StatelessSlider = ({ fraction, onChange }) => {
    function start_dragging(event) {
        let el = event.currentTarget;
        const width = el.offsetWidth;
        let left = el.offsetLeft;
        while (el.offsetParent) {
            el = el.offsetParent;
            left += el.offsetLeft;
        }

        function drag(event) {
            let f = (event.pageX - left) / width;
            if (f < 0) f = 0;
            if (f > 1) f = 1;
            onChange(f);
        }

        function stop_dragging() {
            document.removeEventListener("mousemove", drag);
            document.removeEventListener("mouseup", stop_dragging);
        }

        document.addEventListener("mousemove", drag);
        document.addEventListener("mouseup", stop_dragging);
        drag(event);
    }

    if (fraction < 0) fraction = 0;
    if (fraction > 1) fraction = 1;

    return (
        <div className="slider" role="presentation" onMouseDown={start_dragging}>
            <div className="slider-bar" style={{ width: fraction * 100 + "%" }}>
                <div className="slider-thumb" />
            </div>
        </div>
    );
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

        const change_slider = (f) => {
            onChange(Math.max(min, size_slider_round(f * max, round)));
        };

        const change_text = (value) => {
            /* We keep the literal string as the value and only
             * interpret it below in the validate function inside
             * SizeSlider.  This allows people to freely interact with
             * the text input without getting the text changed all the
             * time by rounding, etc.
             */
            onChange({ text: value, unit: unit });
        };

        const change_unit = (u) => this.setState({ unit: Number(u) });

        let slider_val, text_val;
        if (val.text && val.unit) {
            slider_val = Number(val.text) * val.unit;
            text_val = val.text;
        } else {
            slider_val = val;
            text_val = cockpit.format_number(val / unit);
        }

        return (
            <div className="size-sliderx">
                <StatelessSlider fraction={slider_val / max} onChange={change_slider} />
                <TextInputPF4 className="size-text" value={text_val} onChange={change_text} />
                <FormSelect className="size-unit" value={unit} aria-label={tag} onChange={change_unit}>
                    { this.units.map(u => <FormSelectOption value={u.factor} key={u.name} label={u.name} />) }
                </FormSelect>
            </div>
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
                var fmt = cockpit.format_number(limit / unit);
                var parse = +fmt * unit;

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
    const all_options = Object.assign({ }, options, { validate: validate });

    return {
        tag: tag,
        title: title,
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

function add_para(parts, text) {
    parts.push(<p key={text}>{text}</p>);
}

function add_usage_message(parts, list, text, c1, c2) {
    if (list && list.length > 0) {
        add_para(parts, text);
        parts.push(<DataList key={text + " datalist"} aria-label={_("Affected locations")} isCompact>
            { list.map(elt => <DataListItem aria-labelledby={elt[c2]} key={elt[c2]}>
                <DataListItemRow>
                    <DataListItemCells
                        dataListCells={[
                            <DataListCell key={elt[c2]} id={elt[c2]}>{elt[c2]}</DataListCell>,
                            <DataListCell alignRight isFilled={false} key={elt[c1]}>{elt[c1]}</DataListCell>
                        ]}
                    />
                </DataListItemRow>
            </DataListItem>)}
        </DataList>);
    }
}

export const BlockingMessage = (usage) => {
    const parts = [];
    const blocking = usage.Blocking;

    if (!blocking)
        return null;

    add_usage_message(parts, blocking.PhysicalVolumes,
                      _("This device is currently used for volume groups."),
                      "Name", "VGroup");

    add_usage_message(parts, blocking.MDRaidMembers,
                      _("This device is currently used for RAID devices."),
                      "Name", "MDRaid");

    add_usage_message(parts, blocking.VDOs,
                      _("This device is currently used for VDO devices."),
                      "Name", "VDO");

    if (parts.length > 0)
        return <div>{ parts }</div>;
    else
        return null;
};

export const TeardownMessage = (usage) => {
    const parts = [];
    const teardown = usage.Teardown;

    if (!teardown)
        return null;

    add_usage_message(parts, teardown.Mounts,
                      _("This device has filesystems that are currently in use. Proceeding will unmount all filesystems on it."),
                      "Name", "MountPoint");

    add_usage_message(parts, teardown.PhysicalVolumes,
                      _("This device is currently used for volume groups. Proceeding will remove it from its volume groups."),
                      "Name", "VGroup");

    add_usage_message(parts, teardown.MDRaidMembers,
                      _("This device is currently used for RAID devices. Proceeding will remove it from its RAID devices."),
                      "Name", "MDRaid");

    const has_sessions = teardown.Sessions && teardown.Sessions.length > 0;
    const has_services = teardown.Services && teardown.Services.length > 0;

    if (has_sessions && has_services)
        add_para(parts, _("The filesystem is in use by login sessions and system services. Proceeding will stop these."));
    else if (has_sessions)
        add_para(parts, _("The filesystem is in use by login sessions. Proceeding will stop these."));
    else if (has_services)
        add_para(parts, _("The filesystem is in use by system services. Proceeding will stop these."));

    function add_units(list, key, h1, h2, h3, c1, c2, c3) {
        if (list && list.length > 0) {
            parts.push(
                <table key={key} className="table table-bordered units-table">
                    <thead>
                        <tr>
                            <th>{h1}</th>
                            <th>{h2}</th>
                            <th>{h3}</th>
                        </tr>
                    </thead>
                    <tbody>
                        { list.map(elt =>
                            <tr key={elt[c3]}>
                                <td>{elt[c1]}</td>
                                <td className="cmd">{elt[c2]}</td>
                                <td>{elt[c3]}</td>
                            </tr>)
                        }
                    </tbody>
                </table>);
        }
    }

    add_units(teardown.Sessions, "sessions",
              _("Session"), _("Process"), _("Active since"),
              "Name", "Command", "Since");

    add_units(teardown.Services, "services",
              _("Service"), _("Unit"), _("Active since"),
              "Name", "Unit", "Since");

    if (parts.length > 0)
        return <div className="modal-footer-teardown">{ parts }</div>;
    else
        return null;
};
