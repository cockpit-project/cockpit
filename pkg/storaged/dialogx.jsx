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

       FieldFunction(tag, title, { option: value, ... },
                     [ child, ... ])

   The "tag" is used to uniquely identify this field in the dialog.
   The action function will receive the values of all field in an
   object, and the tag of a field is the key in that object, for
   example.  The tag is also used to interact with a field from tests.

   COMMON FIELD OPTIONS

   Each field function describes its options and its children.
   However, there are some options that apply to all fields:

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

import React from "react";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { StatelessSelect, SelectEntry } from "cockpit-components-select.jsx";
const _ = cockpit.gettext;

const Validated = ({ errors, error_key, explanation, children }) => {
    var error = errors && errors[error_key];
    var text = error || explanation;
    // We need to always render the <div> for the has-error
    // class so that the input field keeps the focus when
    // errors are cleared.  Otherwise the DOM changes enough
    // for the Browser to remove focus.
    return (
        <div className={error ? "has-error" : ""}>
            { children }
            { text ? <span className="help-block">{text}</span> : null }
        </div>
    );
};

const Row = ({ tag, title, errors, options, children }) => {
    if (tag) {
        if (options.widest_title)
            title = [ <div className="widest-title">{options.widest_title}</div>, <div>{title}</div> ];
        return (
            <tr>
                <td className="top">{title}</td>
                <td>
                    <Validated errors={errors} error_key={tag} explanation={options.explanation}>
                        { children }
                    </Validated>
                </td>
            </tr>
        );
    } else {
        return children;
    }
};

function is_visible(field, values) {
    return !field.options || field.options.visible == undefined || field.options.visible(values);
}

const Body = ({body, fields, values, errors, onChange}) => {
    return (
        <div className="modal-body">
            { body || null }
            { fields.length > 0
                ? <table className="form-table-ct">
                    <tbody>
                        { fields.map(f => {
                            if (is_visible(f, values))
                                return (
                                    <Row key={f.tag} tag={f.tag} title={f.title} errors={errors} options={f.options}>
                                        { f.render(values[f.tag], val => { values[f.tag] = val; onChange() }) }
                                    </Row>
                                );
                        })
                        }
                    </tbody>
                </table> : null
            }
        </div>
    );
};

export const dialog_open = (def) => {
    let fields = def.Fields || [ ];
    let values = { };

    fields.forEach(f => { values[f.tag] = f.initial_value });

    // We reconstruct the body everytime the values change so that it
    // will be re-rendered.  This could be done with some state in the
    // Body component maybe, but we also want the values up here so
    // that we can pass them to validate and the action functon.

    const update = (errors) => {
        dlg.setProps(props(errors));
    };

    const props = (errors) => {
        return {
            id: "dialog",
            title: def.Title,
            body: <Body body={def.Body}
                        fields={fields}
                        values={values}
                        errors={errors}
                        onChange={() => update(null)} />
        };
    };

    const update_footer = (running_title, running_promise) => {
        dlg.setFooterProps(footer_props(running_title, running_promise));
    };

    const footer_props = (running_title, running_promise) => {
        let actions = [ ];
        if (def.Action) {
            actions = [
                { caption: def.Action.Title,
                  style: def.Action.DangerButton ? "danger" : "primary",
                  disabled: running_promise != null,
                  clicked: function () {
                      return validate().then(errors => {
                          if (errors) {
                              update(errors);
                              return Promise.reject();
                          } else {
                              return def.Action.action(values);
                          }
                      });
                  }
                }
            ];
        }

        return {
            idle_message: running_promise ? [ <div className="spinner spinner-sm" />, <span>{running_title}</span> ] : null,
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
            let errors = { };
            fields.forEach((f, i) => { if (results[i]) errors[f.tag] = results[i]; });
            return (Object.keys(errors).length > 0) ? errors : null;
        });
    };

    let dlg = show_modal_dialog(props(null), footer_props(null, null));

    return {
        run: (title, promise) => {
            update_footer(title, promise);
            promise.then(
                () => {
                    update_footer(null, null);
                },
                (errors) => {
                    if (errors)
                        update(errors);
                    update_footer(null, null);
                });
        },

        set_values: (new_vals) => {
            Object.assign(values, new_vals);
            update(null);
        }

    };
};

/* GENERIC FIELD TYPES
 */

export const TextInput = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || "",

        render: (val, change) =>
            <input data-field={tag} data-field-type="text-input"
                   className="form-control" type="text" value={val}
                   onChange={event => change(event.target.value)} />
    };
};

export const PassInput = (tag, title, options) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || "",

        render: (val, change) =>
            <input data-field={tag} data-field-type="text-input"
                   className="form-control" type="password" value={val}
                   onChange={event => change(event.target.value)} />
    };
};

export const SelectOne = (tag, title, options, choices) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || choices[0].value,

        render: (val, change) => {
            return (
                <div data-field={tag} data-field-type="select">
                    <StatelessSelect extraClass="form-control" selected={val} onChange={change}>
                        { choices.map(c => <SelectEntry data={c.value} key={c.title}>{c.title}</SelectEntry>) }
                    </StatelessSelect>
                </div>
            );
        }
    };
};

export const SelectOneRadio = (tag, title, options, choices) => {
    return {
        tag: tag,
        title: title,
        options: options,
        initial_value: options.value || choices[0].value,

        render: (val, change) => {
            return (
                <span className="radio radio-horizontal" data-field={tag} data-field-type="select-radio" >
                    { choices.map(c => (
                        <label>
                            <input type="radio" checked={val == c.value} data-data={c.value}
                                     onChange={event => change(c.value)} />{c.title}
                        </label>))
                    }
                </span>
            );
        }
    };
};

export const CheckBox = (tag, title, options) => {
    return {
        tag: tag,
        title: options.row_title || "",
        options: options,
        initial_value: options.value || false,

        render: (val, change) => {
            return (
                <div className="checkbox">
                    <label>
                        <input type="checkbox" data-field={tag} checked={val}
                            onChange={event => change(event.target.checked)} />{title}
                    </label>
                </div>
            );
        }
    };
};

/* A text input that is guarded by a check box.
 *
 * The value is either "false" when the checkbox
 * is not checked, or the string from the text input.
 */

export const TextInputChecked = (tag, title, options) => {
    return {
        tag: tag,
        title: options.row_title,
        options: options,
        initial_value: (options.value === undefined) ? false : options.value,

        render: (val, change) => {
            return (
                <div className="dialog-checkbox-text" data-field={tag} data-field-type="TextInputChecked">
                    <div className="checkbox">
                        <label>
                            <input type="checkbox" checked={val !== false}
                                   onChange={event => change(event.target.checked ? "" : false)} />{title}
                        </label>
                    </div>
                    <input className="form-control" type="text" hidden={val === false}
                           value={val} onChange={event => change(event.target.value)} />
                </div>
            );
        }
    };
};

export const Intermission = (children, options) => {
    return {
        tag: false,
        title: "",
        options: options,
        initial_value: false,

        render: () => {
            return <div className="intermission">{ children }</div>;
        }
    };
};

export const Skip = (className, options) => {
    return {
        tag: false,
        title: "",
        options: options,
        initial_value: false,

        render: () => {
            return <tr><td className={className} /></tr>;
        }
    };
};
