/*
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/** Dialog Implementation Convenience Kit **/

/* TODOs:

   - progress reporting
   - action cancelling
   - array splicing via value handles
   - different validation rules for different actions
 */

/* This is a framework for conveniently implementing dialogs. It is
   meant to save us from having to think through all the details every
   time of how a dialog should work exactly and to allow us to just
   get on with the business logic.

   The framework has two parts (like git): plumbing and porcelain.

   The plumbing takes care of the state management of dialog values,
   asynchronous and debounced input validation, progress feedback and
   errors from actions, etc. It's basically a couple of rather
   complicated JavaScript classes that work in the background.  This
   is the part we don't want to implement from scratch for every
   dialog.

   The porcelain is a set of React components that integrates with the
   plumbing. They are usually very straightforward and easy to
   write. If none of the existing ones works for you, just write a new
   one that does. But they are boilerplatey, so having common ones for
   common things like text input fields makes a lot of sense, too.

   Here is an example of a simple dialog that prompts for some text
   and writes it to the journal:

    interface LoggerValues {
        text: string;
    }

    const LoggerDialog = () => {
        const Dialogs = useDialogs();

        function validate() {
            dlg.value("text").validate(v => {
                if (!v)
                    return "Text can not be empty";
            });
        }

        async function apply(values: LoggerValues) {
            await cockpit.spawn(["logger", values.text]);
        }

        const dlg = useDialogState({ text: "" }, validate);
        const text_field = dlg.field("text");

        return (
            <Modal position="top" variant="medium" isOpen onClose={Dialogs.close}>
                <ModalHeader title="Logger" />
                <ModalBody>
                    <DialogErrorMessage dialog={dlg} />
                    <Form>
                        <FormGroup label="Log message">
                            <TextInput
                                value={text_field.get()}
                                onChange={(_event, val) => text_field.set(val)}
                            />
                            <DialogHelperText field={text_field} />
                        </FormGroup>
                    </Form>
                </ModalBody>
                <ModalFooter>
                    <DialogActionButton dialog={dlg} action={apply} onClose={Dialogs.close}>
                        Log
                    </DialogActionButton>
                    <DialogCancelButton dialog={dlg} onClose={Dialogs.close}/>
                </ModalFooter>
            </Modal>
        );
    };

    const LoggerButton = () => {
        const Dialogs = useDialogs();

        return (
            <Button onClick={() => Dialogs.show(<LoggerDialog />)}>Open logger dialog</Button>
        );
    };

   This uses some porcelain for the error message and footer buttons,
   but none for the text input field.  There is a "DialogTextInput"
   porcelain component that could have been used to make this example
   even more concise. But we didn't use it here just to show how input
   form elements hook into the plumbing.

   PLUMBING API

   The central piece of the plumbing API is the useDialogState hook
   (and it's async variant useDialogState_async).  You can think of it
   as "useState" on steroids.

   - Like useState, useDialogState gives you a place to store state in
     a function component, and gives you a way to change that state
     and trigger a render so that the new state is put on the screen.

   - Unlike useState, you are only supposed to have a single
     useDialogState and put all of the state in a single JavaScript
     object.  And instead of a single setter function, there are ways
     to get setters to individual parts of that object via "handles".

   - The handles work also for nested objects and arrays. You can get
     a "sub handles" for a single key from a handle for an object, for
     example.

   - The useDialogState hook also provides for global validation of
     the state object, at exactly the right times, and communicates
     the result of that to the "Apply" button, for example.

   - The handles to parts of the state give you access to everything
     needed to implement a part of the dialog form: The current value,
     a method to change the value, and any validation errors that
     should be shown.  This makes it possible to write encapsulated
     components that can be cleanly combined into full dialogs.

   - The useDialogState hook also provides for miscellaneous things
     like transporting the exception from running the "Apply" action
     to the error message in the dialog.

   Here is a speedrun of the plumbing API:

   - dlg = useDialogState(init, validate)

   This is a React hook that creates a new instance of the plumbing
   machinery.  It also causes the current component to re-render
   appropriately.

   The values of the input fields of a dialog are stored in a
   JavaScript object, and that object is initialized to "init", or the
   result of calling "init" if it is a function.  The actual values of
   a dialog can be anything, strings, number, other objects, arrays,
   etc, to an arbitrary depth.

   The "validate" parameter is a function that performs input
   validation. It has to follow a very specific code pattern, which is
   explained below.

   There is a variant of useDialogState for asynchronous
   initialization, called useDialogState_async. It takes a async init
   function and returns null until that function has resolved.  You
   should render a spinner in the dialog while "dlg" is null.

   If the asynchronous "init" function throws an exception, "dlg" is
   set to a DialogError object. In that case you should render the
   error in the dialog.

   The porcelain components that do not work on actual dialog values,
   such as DialogActionButton and DialogErrorMessage, can deal with
   their "dialog" properties being null or a DialogError, and will do
   the right thing.

   The return value of useDialogState, "dlg", has a number of fields
   and methods.

   - handle = dlg.field(name)
   - handle = dlg.field(name, update_func)

   This returns a handle for a specific field of the dialog
   values. Using handles like this becomes convenient when there are
   nested values, and when writing reusable porcelain components. They
   also work well with TypeScript. For simple dialogs they might feel
   a bit clunky.

   The second argument, "update_func", is optional. If given, it
   should be a function and that function will be called whenever the
   dialog value is changed via the returned handle (and the returned
   handle only).

   - handle = dlg.top()
   - handle = dlg.top(update_func)

   Get a handle for the whole value object.  The usual
   "dlg.field(name)" call is actually just a shortcut for
   "dlg.top().sub(name)".  But since that looks quite obscure in
   simple dialogs that only have one level of values, we have the
   "dlg.field(name)" shortcut as well.  This whole-value handle is
   useful for "dlg.top().at(...)", see below, or for update
   notifications that trigger for each and every change.

   - dlg.values

   The current whole dialog value object. This is the same as
   "dlg.top().get()", but accessing it is common enough in simple
   dialogs that exposing it directly makes sense.

   The object will never be mutated by the plumbing itself. When it
   needs to be changed, a whole new value object is constructed and
   assigned to "dlg.values".

   - handle.get()

   Get the current value of a value handle.

   - handle.validation_text()

   Get the current validation error message for this value. This is
   "undefined" when there is no message.

   - handle.set(val)

   Set the current value of a value handle. This will re-render the
   dialog, and do input validation as necessary and all the other
   things that you don't need to think about.

   - handle.sub(name_or_index)
   - handle.sub(name_or_index, update_func)

   Get a handle for a nested value. When the current value is an
   object, you should pass the name of a nested field. If it is an
   array, pass the index of the desired element.  See "dlg.field()"
   above for more information about handles.

   - handle.at(witness)

   Get a handle with a narrowed type for "handle".  The new handle
   works like "handle" and modifies the same place in the dialog value
   object, but it's type will be the type of "witness".  This is
   useful to carry over type inference into value handles.  The
   general pattern is:

     const val = handle.get();
     if (some_type_narrowing_condition(val)) {
       const narrowed_handle = handle.at(val);

       ...
     }

   - handle.add(val)

   If the current value is an array, append "val" at the end.

   - handle.remove(index)

   If the current value is an array, remove the element at "index".
   It is important to use this function instead of just "handle.set()"
   with an appropriately modified array. By using this function, the
   plumbing is able to keep its internal state in synch, which is
   especially important for asynchronous validation functions.

   However, it is okay to just replace an array with a different
   array, so you are not strictly required to use this function. But
   doing so might look to the validation machinery as if each and
   every element of the array has just changed, and it will do a lot
   of needless validations all over again.

   - handle.map(func)

   If the current value is an array, map "func" over handles for its
   elements. This is nice for creating React components for arrays.

   - handle.forEach(func)

   If the current value is an array, call "func" with handles for each
   of its elements, in order. This is nice for "validate" functions.

   Now back to the fields and methods of the dialog state.

   - dlg.busy
   - dlg.actions_disabled
   - dlg.cancel_disabled

   Boolean flags that indicate which parts of the dialog should be
   disabled. The porcelain should of course look at these and do the
   right thing.

   - dlg.error

   The most recent error thrown by an action function.  This can be
   any kind of JavaScript value, but the idea is that it is something
   with a "message" field, or a DialogError instance.  The
   DialogErrorMessage porcelain component will do the right thing with
   these kind of error values.

   - dlg.run_action(func)

   Performs input validation (if necessary) and if that was
   successful, calls "func" and puts the dialog into a "busy" state
   while it runs. When "func" throws an error, it is caught and stored
   in "dlg.error".

   "dlg.run_action" returns true when validation has passed and "func"
   has completed without throwing an error.

   All state changes via "field.set()" are denied while
   "dlg.run_action" is running. This is done to prevent the user from
   interacting with the dialog while an action runs. But there is
   nothing fundamentally wrong with programmatically changing dialog
   state as part of an action. If you want to do that, write code like

     if (dlg.run_action(...))
       dlg.field("xxx").set(...)

   Let's now finally talk about input validation.

   Input validation is done by a single, central function for the
   whole dialog.  This has been done so that there is a central place
   that establishes the "shape" of the dialog values. This is
   important for dialogs that have expander areas or other optional
   things.

   If such an optional part of the values has failed validation
   earlier, but has subsequently been removed from the dialog by the
   user, the plumbing needs to know that it should now ignore this
   failed validation. But the code that knows what is currently in the
   dialog is the render function that instantiates all the field input
   components (like TextInput). This hacker here has found no reliable
   and non-magical way to connect what the render function actually
   does with the plumbing machinery. So everyone has to write a big
   validate function now that duplicates this, sorry!

   The formal job of the validation function is to call the "validate"
   method (or "validate_async") of all relevant dialog value handles.
   If and only if the render function instantiates a component for a
   dialog value, should the validate function visit it.

   - handle.validate(v => ...)

   This might call the given function with the current value of the
   handle. If it passes validation, the function should return
   "undefined". If it fails, the function should return a string with
   the appropriate message. This message will be available from the
   "handle.validation_text" method and should be shown by the React
   component for this value, of course.

   The "v => ..." function is only called when necessary, when the
   value has actually changed.

   The "v => ..." function should not make any modifications to
   anything involved in the dialog. Specifically, it should not call
   "set()" on any value handle.

   If your validation function needs to communicate out-of-band with
   your action function (maybe to pass the results of some expensive
   operations that you don't want to repeat in your action function),
   then you need to find some other way. Maybe with a memoized
   function or an explicit cache.

   - handle.validate_async(debounce, async v >= ...)

   Calls the given async function "debounce" milliseconds after the
   value represented by the handle has last been changed. (Or
   immediately when the apply button is clicked.)  When the function
   throws an exception, the validation is considered to have been
   successful.

   See the documentation for "handle.validate" above for more rules
   that apply to validation functions.

   TESTING

   Our automated tests will want to drive the dialogs created by this
   framework, of course.  To support this, the various DOM elements
   instantiated for a dialog should be decorated with structured "id"
   attributes. The code that instantiates an element can get suitable
   IDs for dialog value handles with the following function:

   - handle.id(tag)

   This will return a unique and predictable string for the value
   handle that will also include "tag". This is suitable for the "id"
   attribute of DOM elements associated with "value".  The "tag"
   parameter can be used to generate multiple IDs if a component has
   multiple interesting DOM elements.  The "tag" parameter defaults to
   "field", see below.

   There is a support library for use by the tests that can generate
   the same IDs, and there are also some guidelines for how to use
   these IDs:

   - The main input element (text input, form select, ...) should use
     the "field" tag.

   - The helper text should use the "helper-text" tag.

   - A set of radio buttons should use a different tag for each
     button. Whatever makes sense in the specific case.

   - ...

   PORCELAIN GALLERY

   Here are some noteworthy React components that integrate with the
   plumbing API.

   - <DialogErrorMessage dialog={dlg} />

   This creates an appropriate Alert for "dlg.error", if it is set. It
   works well with instances of DialogError, and all usual errors
   thrown by the Cockpit API.

   In addition to a proper DialogState, the "dialog" property can be
   anything returned by "use_DialogState_async".

   If given one the of Cockpit API errors, the title of the Alert will
   be a generic "Failed" text. If you want more control, use a
   DialogError.

   A DialogError contains a title and details, and the details can
   come from another error.  For example:

       try {
           await cockpit.spawn(["/bin/frob", "--bars"])
       } catch (ex) {
           throw DialogError.fromError("Failed to frob the bars", ex);
       }

   You can also construct a DialogError directly from title and
   details:

       throw new DialogError("Failed to frob", <pre>...</pre>);

   In that case, the details can be any React node.

   - <DialogActionButton dialog={dlg} action={func} onClose={close_func}>

   This will produce a action button for a dialog that correctly disables
   itself according to the state of "dlg".

   In addition to a proper DialogState, the "dialog" property can be
   anything returned by "use_DialogState_async".

   When clicked, "func" will be run via "dlg.run_action". If "func"
   completes successfully, "close_func" is called to close the dialog.

   - <DialogCancelButton dialog={dlg} onClose={close_func} />

   This will produce a cancel button for a dialog that correctly
   disables itself according to the state of "dlg".

   In addition to a proper DialogState, the "dialog" property can be
   anything returned by "use_DialogState_async".

   Clicking it will either just close the dialog by calling
   "close_func", or run the cancel function provided by the currently
   running action function (if there is any).

   - <DialogTextInput label="Name" field={dlg.field("name")} ... />

   This will produce a TextInput in a (optional) FormGroup that will
   manage the given value handle.  The "label" property is optional
   and omitting it will also omit the FormGroup.

  - <DialogCheckbox label= field= .../>

  For a single checkbox that drives a boolean.

  - <DialogRadioSelect label= field= options= .../>

  For a group of radio buttons.  The options can be disabled and have
  explanations.

  - <DialogDropdownSelect label= field= options= .../> </>

  For a simple dropdown select. Options can not be disabled or have
  explanations.

  - <DialogDropdownSelectObject label= field= options= option_label= />

  A variant of the simple dropdown select from above where the options
  can be of any type whatsoever, such as something directly from your
  data model. A simple case is selecting from an array of strings. In
  that case you can omit the "option_label" function.

  WRITING COMPLEX PORCELAIN COMPONENTS

  Here is a pattern that you might want to follow when writing
  complicated components. Even if they are not meant to be reused
  much, it pays of to try to encapsulate their behavior.

  Let's write a component for two level selection.  Parameter is
  something like

     {
       "Fruit": [ "Apple", "Banana" ],
       "Bread": [ "Toast", "Rye" ],
       "Meat": [ "Chicken", "Pork" ],
     }

  and there will be two dropdowns in the dialog, one for selecting
  between "Fruit", "Bread", and "Meat"; and one for selecting "Apple"
  or "Banana" when the first is "Fruit", etc.

  First, declare the type of the value that the component works with.
  It should store everything needed by the component, to simplify
  initialization and validation.

    export interface TwoLevelSelectValue {
      first: string;
      second: string;

      _firsts: string[],
      _options: Record<string, string[]>,
    }

  Write a "init" function to create such a value:

    export function init_TwoLevelSelect(options: Record<string, string[]>): TwoLevelValue {
      const _firsts = Object.keys(options);
      const _seconds = options[_firsts[0]];

      return {
        first: _firsts[0],
        second: _seconds[0],

        _firsts,
        _seconds,
        _options: options,
      };
    }

  And the component itself:

    export const TwoLevelSelect = ({ field } : { field: DialogField<TwoLevelSelectValue> }) => {
      const { _firsts, _seconds, _options } = field.get();

      function update_first(f: string) {
        const _seconds = _options[f];
        value.sub("second").set(_seconds[0]);
        value.sub("_seconds").set(_seconds);
      }

      return (
        <>
          <DialogDropdownSelectObject
            label="First"
            field={field.sub("first", update_first)}
            options={_firsts}
          />
          <DialogDropdownSelectObject
            label="Second"
            field={field.sub("second")}
            options={_seconds}
          />
        </>
      );
    }

  It would be used in a dialog like this:

    interface DialogValues {
      food: TwoLevelSelectValue;
    }

    function init() {
      return {
        food: init_TwoLevelSelect({ "Fruit": [ "Apple", "Banana" ], "Bread": [ "Toast", "Rye" ], "Meat": [ "Chicken", "Pork" ] }),
      }
    }

    const dlg = useDialogState(init);

    return (
      ...
      <TwoLevelSelect field={dlg.field("food")} />
      ...
    );

  Here is a pattern for handling types that include alternatives, such
  as "TwoLevelSelectValue | string".  This could be used to encode
  either the state for a working TwoLevelSelect component, or an
  excuse message that explains why it can't work.

    function init_TwoLevelSelect(options: Record<string, string[]>): TwoLevelSelectValue | string {
      if (Object.keys(options).length == 0)
        return _("Nothing to select.");

      return { ... };
    }

    export const TwoLevel = ({ field } : { field: DialogField<TwoLevelValue | string> }) => {
      const val = field.get();
      if (typeof val == "string")
          return null;

      const tls_field = field.at(val);

      const { _firsts, _seconds, _options } = tls_field.get();
      ...
    }

  Note the use of the "field.at()" function to get a handle for a
  TwoLevelSelectValue that can be used to access the "first" sub
  value, etc.
 */

import React, { useState } from "react";
import { useObject, useInit, useOn } from 'hooks';
import { EventEmitter } from 'cockpit/event';

import cockpit from "cockpit";

import { Button, type ButtonProps } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { FormGroup, type FormGroupProps, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form";
import { TextInput, type TextInputProps } from "@patternfly/react-core/dist/esm/components/TextInput";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import {
    HelperText, HelperTextItem, type HelperTextItemProps
} from "@patternfly/react-core/dist/esm/components/HelperText";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox";
import {
    FormSelect, FormSelectOption, type FormSelectProps,
} from "@patternfly/react-core/dist/esm/components/FormSelect";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio";

const _ = cockpit.gettext;

function debug(...args: unknown[]) {
    if (window.debugging == "all" || window.debugging?.includes("dialog"))
        console.debug("dialog:", ...args);
}

type ArrayElement<ArrayType> =
  ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

function toSpliced<T>(arr: T[], start: number, deleteCount: number, ...rest: T[]): T[] {
    const copy = [...arr];
    copy.splice(start, deleteCount, ...rest);
    return copy;
}

export class DialogField<T> {
    /* eslint-disable no-use-before-define */
    #dialog: DialogState<unknown>;
    /* eslint-enable */
    #getter: () => T;
    #setter: (val: T) => void;
    #path: string;

    constructor(
        dialog: DialogState<unknown>,
        getter: () => T,
        setter: (val: T) => void,
        path: string
    ) {
        this.#dialog = dialog;
        this.#getter = getter;
        this.#setter = setter;
        this.#path = path;
    }

    validation_text(): string | undefined {
        return this.#dialog._get_validation(this.#path);
    }

    get(): T {
        return this.#getter();
    }

    set(val: T): void {
        this.#setter(val);
    }

    id(tag: string = "field"): string {
        return "dialog-" + tag + "-" + this.#path;
    }

    map<X>(func: (val: DialogField<ArrayElement<T>>, index: number) => X): X[] {
        const val = this.get();
        if (Array.isArray(val)) {
            return val.map((_, i) => func(this.sub(i as keyof T) as DialogField<ArrayElement<T>>, i));
        } else
            return [];
    }

    forEach(func: (val: DialogField<ArrayElement<T>>, index: number) => void): void {
        const val = this.get();
        if (Array.isArray(val)) {
            val.forEach((_, i) => func(this.sub(i as keyof T) as DialogField<ArrayElement<T>>, i));
        }
    }

    remove(index: number) {
        const val = this.get();
        if (Array.isArray(val)) {
            for (let j = index; j < val.length - 1; j++)
                this.#dialog._rename_validation_state(this.#path, j + 1, j);
            this.set(toSpliced(val, index, 1) as T);
        }
    }

    add(item: ArrayElement<T>) {
        const val = this.get();
        if (Array.isArray(val)) {
            this.set(val.concat(item) as T);
        }
    }

    sub<K extends keyof T>(tag: K, update_func?: ((val: T[K]) => void) | undefined): DialogField<T[K]> {
        return new DialogField<T[K]>(
            this.#dialog,
            () => this.get()[tag],
            (val) => {
                const container = this.get();
                if (Array.isArray(container) && typeof tag == "number")
                    this.#setter(toSpliced(container, tag, 1, val) as T);
                else
                    this.#setter({ ...container, [tag]: val });
                if (update_func)
                    update_func(val);
            },
            this.#path ? this.#path + "." + String(tag) : String(tag)
        );
    }

    at<TT extends T>(witness: TT): DialogField<TT> {
        cockpit.assert(Object.is(witness, this.get()));
        return new DialogField<TT>(
            this.#dialog,
            () => this.get() as TT,
            (val) => {
                this.#setter(val);
            },
            this.#path,
        );
    }

    validate(func: (val: T) => string | undefined): void {
        const val = this.get();
        this.#dialog._validate_value(this.#path, val, () => func(val));
    }

    validate_async(debounce: number, func: (val: T) => Promise<string | undefined>): void {
        const val = this.get();
        this.#dialog._validate_value_async(this.#path, val, debounce, () => func(val));
    }
}

interface DialogValidationState {
    path: string;
    cached_value: unknown;
    cached_result: string | undefined;
    timeout_id: number;
    promise: Promise<void> | undefined;
    round_id: unknown;
}

interface DialogStateEvents {
    changed(): void;
}

export class DialogState<V> extends EventEmitter<DialogStateEvents> {
    values: V;

    busy: boolean = false;
    actions_disabled: boolean = false;
    cancel_disabled: boolean = false;

    error: unknown = null;

    #validation_failed: boolean = false;
    #online_validation: boolean = false;
    #action_running: boolean = false;
    #validation: Record<string, string | undefined> = { };
    #validation_state: Record<string, DialogValidationState> = { };

    /* eslint-disable no-use-before-define */
    #validate_callback: undefined | ((dlg: DialogState<V>) => void);
    /* eslint-enable */

    constructor(init: V, validate: undefined | ((dlg: DialogState<V>) => void)) {
        super();
        this.#validate_callback = validate;
        this.values = init;
    }

    #update() {
        this.busy = this.#action_running;
        this.actions_disabled = this.#action_running || this.#validation_failed;
        this.cancel_disabled = this.#action_running;
        this.emit("changed");
    }

    /* VALIDATION
     */

    /* Validation is started by calling the #trigger_validation
       method. This will reset all validation errors and then call the
       provided "validate" callback, which in turn will (eventually
       but synchronously) call the "_validate_value" or
       "_validate_value_async" methods of all relevant value paths.
       Those functions will eventually call #set_validation to install
       the validation results in the fresh #validation object created
       by #trigger_validation.
     */

    #trigger_validation(): void {
        debug("trigger validation");
        if (!this.#validate_callback)
            return;
        this.#validation = { };
        this.#validation_failed = false;
        this.#validate_callback(this);
        this.#update();
    }

    #set_validation(path: string, result: string | undefined) {
        if (result) {
            this.#validation[path] = result;
            this.#validation_failed = true;
            this.#online_validation = true;
            this.#update();
        }
    }

    _get_validation(path: string): string | undefined {
        if (path in this.#validation)
            return this.#validation[path];
        else
            return undefined;
    }

    /* In between #trigger_validation and #set_validation, a lot is
       going on, especially with asynchronous validation.

       We use a DialogValidationState object to keep the necessary
       state for that, such as cached results, and timeouts and
       promises.

       Note that a DialogValidationState object can change which path
       it is for, see _rename_validation_state below. So we have to be
       careful to always get the path out of the DialogValidationState
       object.
     */

    #get_validation_state(path: string): DialogValidationState {
        if (!(path in this.#validation_state))
            this.#validation_state[path] = {
                path,
                cached_value: undefined,
                cached_result: undefined,
                timeout_id: 0,
                promise: undefined,
                round_id: undefined,
            };
        return this.#validation_state[path];
    }

    /* Calling #set_validation_state_result is the final thing that
       should happen when validating a given path. It will install the
       result in the cache and then call #set_validation.
     */

    #set_validation_state_result(
        state: DialogValidationState,
        val: unknown,
        result: string | undefined,
    ) {
        state.cached_value = val;
        state.cached_result = result;
        state.timeout_id = 0;
        state.promise = undefined;
        state.round_id = undefined;
        this.#set_validation(state.path, result);
    }

    /* The first thing should be of course to probe that cache.  If we
       get a hit, it is used immediately to call #set_validation.

       In that case, the DialogValidationState is also made part of
       the current round since any asynchronous validation that is
       currently running is still relevant. See below for more about
       that.
     */

    #probe_validation_state_cache(state: DialogValidationState, val: unknown): boolean {
        if (Object.is(state.cached_value, val)) {
            state.round_id = this.#get_current_validation_round_id();
            debug("cache hit", state.path, state.cached_result);
            this.#set_validation(state.path, state.cached_result);
            return true;
        } else
            return false;
    }

    /* And in fact, _validate_value does exactly those two things.
     */

    _validate_value(path: string, val: unknown, func: () => string | undefined): void {
        const state = this.#get_validation_state(path);
        if (!this.#probe_validation_state_cache(state, val)) {
            const result = func();
            debug("sync validate", state.path, result);
            this.#set_validation_state_result(state, val, result);
        }
    }

    /* Now asynchronous validation.

       Each call to #trigger_validation starts a new "validation
       round" and a DialogValidationState keeps track to which round
       it applies to.  This matters of course for asynchronous
       validation: If async validation for a given path was started in
       one round, and then the next round happens but the path is no
       longer enumerated by the validation callback (i.e., its value
       is no longer relevant for the dialog), then this asynchronous
       validation should have no effect.

       We use the #validation object as the round identifier, since it
       is created fresh by each call to #trigger_validation.
     */

    #get_current_validation_round_id(): unknown {
        return this.#validation;
    }

    #is_current_validation_round_id(id: unknown): boolean {
        return Object.is(id, this.#validation);
    }

    /* If there was no cache hit, asynchronous validation starts with
       a timeout, followed by letting a asynchronous function run to
       resolution.

       Setting a new timeout of course cancels any previously set
       one. It also installs the current value in the cache, so that
       subsequent validation rounds do nothing until the value
       actually changes.

       One interesting thing to note is that when doing the final
       validation before running an action function, no debouncing
       delay should be applied of course. We want to get on with
       validation immediately.
     */

    #set_validation_state_timeout(
        state: DialogValidationState,
        val: unknown,
        delay: number,
        func: () => void,
    ) {
        if (state.timeout_id) {
            debug("timeout cancel", state.path);
            window.clearTimeout(state.timeout_id);
            state.timeout_id = 0;
        }
        if (this.#action_running || delay == 0) {
            func();
        } else {
            state.cached_value = val;
            state.cached_result = undefined;
            state.timeout_id = window.setTimeout(
                () => {
                    debug("timeout", state.path);
                    if (!this.#validation_state_is_current(state)) {
                        debug("timeout outdated", state.path);
                        return;
                    }
                    func();
                },
                delay);
            state.promise = undefined;
            state.round_id = this.#get_current_validation_round_id();
        }
    }

    /* Once the timeout is over (and the path is still relevant to the
       current round), the actual asynchronous validation is launched.
       This promise that represents it is simply installed in the
       DialogValidationState.
     */

    #set_validation_state_promise(
        state: DialogValidationState,
        val: unknown,
        prom: Promise<void>,
    ) {
        state.cached_value = val;
        state.cached_result = undefined;
        state.timeout_id = 0;
        state.promise = prom;
        state.round_id = this.#get_current_validation_round_id();
    }

    /* Unlike with the timeout, we can not cancel the old promise when
       installing a new one. Instead we check at the end whether it is
       still really us that is supposed to deliver the result, by
       comparing promises.

       To summarize:

       - The round id check will fail if the value is no longer
         relevant to the dialog.  For example, say there is a text
         input that can be toggled in and out of the dialog via a
         checkbox. Now a validation round is started while the text
         input is part of the dialog. During the debounce timeout or
         while the asynchronous validation function runs, the user
         toggles the checkbox (which triggers a new validation round)
         and the text input is no longer part of the dialog. Now when
         the timeout or validation for the text input concludes, the
         round id check fails and the result is ignored, as it should.

       - The promise check will fail when a asynchronous validation
         takes longer than the debounce timeout.  Let's say there is a
         text input with a debounce timeout of 1 second and a
         validation function that takes 2 seconds. The user makes a
         change that triggers validation and then remains idle for
         more than a second. After one second, the timeout expires and
         the promise is created and starts running. It will finish at
         second 3, but we are not there yet. At second 1.5 the user
         makes another change, a new timeout expires at 2.5 and a new
         promise is created. At second 3 the original promise finally
         comes to a conclusion, and the path is still relevant to the
         dialog, but this promise is no longer the current
         promise. Its result will be ignored, as it should.
     */

    #validation_state_is_current(state: DialogValidationState, prom?: Promise<void>): boolean {
        return (
            (!prom || Object.is(state.promise, prom)) &&
                this.#is_current_validation_round_id(state.round_id)
        );
    }

    /* _validate_value_async puts this all together.
     */

    _validate_value_async(path: string, val: unknown, debounce: number, func: () => Promise<string | undefined>): void {
        const state = this.#get_validation_state(path);
        if (!this.#probe_validation_state_cache(state, val)) {
            debug("async validate start debounce", state.path, val);
            this.#set_validation_state_timeout(
                state,
                val,
                debounce,
                () => {
                    debug("async validate start promise", state.path, val);
                    const prom =
                        func()
                                .catch(
                                    ex => {
                                        console.error(ex);
                                        return undefined;
                                    }
                                )
                                .then(
                                    result => {
                                        if (this.#validation_state_is_current(state, prom)) {
                                            debug("async validate done", state.path, result);
                                            this.#set_validation_state_result(state, val, result);
                                        } else {
                                            debug("promise outdated", state.path);
                                        }
                                    }
                                );
                    this.#set_validation_state_promise(state, val, prom);
                }
            );
        }
    }

    /* Since the DialogValidationState for a path is so important, it
       is also important to keep them firmly associated with each
       other when the path of a value changes.

       A path might change when there are arrays involved, and
       elements get new indices without actually changing identity.
     */

    _rename_validation_state(path: string, from: number, to: number) {
        const from_path = path + "." + String(from);
        const to_path = path + "." + String(to);
        if (from_path in this.#validation_state) {
            debug("rename", from_path, to_path);
            this.#validation_state[to_path] = this.#validation_state[from_path];
            this.#validation_state[to_path].path = to_path;
            delete this.#validation_state[from_path];
        }
        for (const k in this.#validation_state) {
            if (k.indexOf(from_path + ".") == 0) {
                const to = to_path + k.substring(from_path.length);
                debug("rename", k, to);
                this.#validation_state[to] = this.#validation_state[k];
                this.#validation_state[to].path = to;
                delete this.#validation_state[k];
            }
        }
    }

    /* The first thing run_action does is to trigger a new validation
       round and then wait for all the asynchronous results to have
       come in.

       If there are any DialogValidationState objects that are waiting
       for a timeout, we want to cancel those and start over, so that
       their validation starts immediately. (Also, it would be hairy
       to wait for those timeouts to be over from here.)
     */

    async validate(): Promise<boolean> {
        this.#cancel_all_validation_timeouts();
        this.#trigger_validation();
        await this.#wait_for_validation_promises();
        return !this.#validation_failed;
    }

    #cancel_all_validation_timeouts() {
        for (const p in this.#validation_state) {
            const state = this.#validation_state[p];
            if (state.timeout_id) {
                debug("timeout bulk cancel", p);
                window.clearTimeout(state.timeout_id);
                delete this.#validation_state[p];
            }
        }
    }

    async #wait_for_validation_promises(): Promise<void> {
        for (const path in this.#validation_state) {
            const state = this.#validation_state[path];
            if (state.promise) {
                debug("waiting for promise", path);
                await state.promise;
                debug("waiting for promise done", path);
            }
        }
    }

    async run_action(func: (vals: V) => Promise<void>): Promise<boolean> {
        this.error = null;
        this.#action_running = true;
        this.#update();
        if (!await this.validate()) {
            this.#action_running = false;
            this.#update();
            return false;
        }

        try {
            await func(this.values);
        } catch (ex) {
            console.error(String(ex));
            this.error = ex;
        }

        this.#action_running = false;
        this.#update();

        return !this.error;
    }

    top(update_func?: ((val: V) => void) | undefined): DialogField<V> {
        return new DialogField<V>(
            this as DialogState<unknown>,
            () => this.values,
            (val) => {
                debug("set", val);
                if (this.#action_running) {
                    // Deny state changes while actions run.  This
                    // prevents the user from interacting with the
                    // dialog while it is busy. The alternative would
                    // be to officially disable all fields and prevent
                    // interactions that way, but that is visually
                    // very jarring and not something that we have
                    // been doing earlier.
                    debug("set denied");
                    return;
                }
                this.values = val;
                this.#update();
                if (this.#online_validation)
                    this.#trigger_validation();
                if (update_func)
                    update_func(val);
            },
            "");
    }

    field<K extends keyof V>(tag: K, update_func?: ((val: V[K]) => void) | undefined): DialogField<V[K]> {
        return this.top().sub(tag, update_func);
    }
}

export class DialogError {
    title: string;
    details: React.ReactNode;

    constructor(title: string, details: React.ReactNode) {
        this.title = title;
        this.details = details;
    }

    toString() {
        return this.title + ": " + String(this.details);
    }

    static fromError(title: string, err: unknown) {
        if (err && typeof err == "object" && "message" in err && typeof err.message == "string") {
            return new DialogError(title, err.message);
        } else {
            return new DialogError(title, String(err));
        }
    }
}

export function useDialogState<V extends object>(
    init: V | (() => V),
    validate?: undefined | ((dlg: DialogState<V>) => void),
) : DialogState<V> {
    const dlg = useObject(
        () => new DialogState(
            typeof init == "function" ? init() : init,
            validate
        ),
        null,
        []
    );
    useOn(dlg, "changed");
    return dlg;
}

export function useDialogState_async<V extends object>(
    init: () => Promise<V>,
    validate?: undefined | ((dlg: DialogState<V>) => void),
) : null | DialogError | DialogState<V> {
    const [dlg, setDlg] = useState<null | DialogError | DialogState<V>>(null);
    useOn((dlg instanceof DialogError ? null : dlg), "changed");
    useInit(async () => {
        try {
            setDlg(new DialogState<V>(await init(), validate));
        } catch (ex) {
            if (ex instanceof DialogError)
                setDlg(ex);
            else
                setDlg(DialogError.fromError(_("Error during initialization"), ex));
        }
    });
    return dlg;
}

// Common elements

export function DialogErrorMessage<V>({
    dialog,
} : {
    dialog: DialogState<V> | DialogError | null,
}) {
    const err = (!dialog || dialog instanceof DialogError) ? dialog : dialog.error;
    if (!err)
        return null;

    let title: string;
    let details: React.ReactNode;

    if (err instanceof DialogError) {
        title = err.title;
        details = err.details;
    } else if (err && typeof err == "object" && "message" in err && typeof err.message == "string") {
        title = _("Failed");
        details = err.message;
    } else {
        title = _("Failed");
        details = String(err);
    }

    return (
        <Alert
            id="dialog-error-message"
            variant='danger'
            isInline
            title={title}
        >
            {details}
        </Alert>
    );
}

export function DialogActionButton<V>({
    dialog,
    children,
    action,
    onClose = undefined,
    ...props
} : {
    dialog: DialogState<V> | DialogError | null,
    children: React.ReactNode,
    action: (values: V) => Promise<void>,
    onClose?: undefined | (() => void)
} & Omit<ButtonProps, "id" | "action" | "isLoading" | "isDisabled" | "variant" | "onClick">) {
    return (
        <Button
            id="dialog-apply"
            isLoading={!!dialog && !(dialog instanceof DialogError) && dialog.busy}
            isDisabled={!dialog || dialog instanceof DialogError || dialog.actions_disabled}
            variant="primary"
            onClick={async () => {
                cockpit.assert(dialog && !(dialog instanceof DialogError));
                if (await dialog.run_action(action) && onClose)
                    onClose();
            }}
            {...props}
        >
            {children}
        </Button>
    );
}

export function DialogCancelButton<V>({
    dialog,
    onClose,
    ...props
} : {
    dialog: DialogState<V> | DialogError | null,
    onClose: () => void
} & Omit<ButtonProps, "id" | "isDisabled" | "variant" | "onClick">) {
    return (
        <Button
            id="dialog-cancel"
            isDisabled={!dialog || (dialog instanceof DialogState && dialog.cancel_disabled)}
            variant="link"
            onClick={onClose}
            {...props}
        >
            {_("Cancel")}
        </Button>
    );
}

/* Common dialog field implementations.
 */

type falsy = null | undefined | false;

export function DialogHelperText<V>({
    field,
    excuse,
    warning,
    explanation,
} : {
    field: DialogField<V>;
    excuse?: string | falsy;
    warning?: React.ReactNode;
    explanation?: React.ReactNode;
}) {
    let text: React.ReactNode = field.validation_text();
    let variant: HelperTextItemProps["variant"] = "error";
    if (!text && excuse) {
        text = excuse;
        variant = "default";
    }
    if (!text && warning) {
        text = warning;
        variant = "warning";
    }
    if (!text) {
        text = explanation;
        variant = "default";
    }

    if (!text)
        return null;

    return (
        <FormHelperText>
            <HelperText>
                <HelperTextItem id={field.id("helper-text")} variant={variant}>
                    {text}
                </HelperTextItem>
            </HelperText>
        </FormHelperText>
    );
}

export const OptionalFormGroup = ({
    label,
    children,
    ...props
} : {
    label: React.ReactNode,
    children: React.ReactNode,
} & Omit<FormGroupProps, "label" | "children">) => {
    if (label) {
        return (
            <FormGroup
                label={label}
                {...props}
            >
                {children}
            </FormGroup>
        );
    } else {
        return children;
    }
};

export const DialogTextInput = ({
    label = null,
    field,
    excuse,
    warning,
    explanation,
    isDisabled = false,
    ...props
} : {
    label?: React.ReactNode,
    field: DialogField<string>,
    excuse?: string | falsy,
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
    isDisabled?: boolean,
} & Omit<TextInputProps, "id" | "label" | "value" | "onChange">) => {
    return (
        <OptionalFormGroup label={label} fieldId={field.id()}>
            <TextInput
                id={field.id()}
                value={field.get()}
                onChange={(_event, val) => field.set(val)}
                isDisabled={!!excuse || isDisabled}
                {...props}
            />
            <DialogHelperText explanation={explanation} warning={warning} excuse={excuse} field={field} />
        </OptionalFormGroup>
    );
};

export const DialogCheckbox = ({
    field_label = null,
    checkbox_label,
    field,
    excuse,
    warning,
    explanation,
} : {
    field_label?: React.ReactNode,
    checkbox_label: string,
    field: DialogField<boolean>,
    excuse?: string | falsy,
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
}) => {
    return (
        <OptionalFormGroup label={field_label} hasNoPaddingTop>
            <Checkbox
                id={field.id()}
                isChecked={field.get()}
                label={checkbox_label}
                onChange={(_event, checked) => field.set(checked)}
                isDisabled={!!excuse}
            />
            <DialogHelperText explanation={explanation} warning={warning} excuse={excuse} field={field} />
        </OptionalFormGroup>
    );
};

export interface DialogRadioSelectOption<T extends string> {
    value: T,
    label: React.ReactNode,
    explanation?: React.ReactNode,
    excuse?: string | falsy,
}

export function DialogRadioSelect<T extends string>({
    label = null,
    field,
    options,
    warning,
    explanation,
    isInline = false,
} : {
    label?: React.ReactNode,
    field: DialogField<T>,
    options: DialogRadioSelectOption<T>[],
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
    isInline?: boolean,
}) {
    function makeLabel(o: DialogRadioSelectOption<T>, i: number) {
        const exc = o.excuse ? <> ({o.excuse})</> : null;
        const pad = (!isInline && i < options.length - 1) ? <><br />{"\u00A0"}</> : null;
        const exp = o.explanation ? <><br /><small>{o.explanation}{pad}</small></> : null;
        return <div id={field.id(o.value + "-label")}>{o.label}{exc}{exp}</div>;
    }

    return (
        <OptionalFormGroup
            label={label}
            hasNoPaddingTop
            isInline={isInline}
            id={field.id()}
            data-value={field.get()}
        >
            {
                options.map((o, i) =>
                    <Radio
                        key={o.value}
                        id={field.id(o.value)}
                        name={o.value}
                        isChecked={field.get() == o.value}
                        label={makeLabel(o, i)}
                        onChange={() => field.set(o.value)}
                        isDisabled={!!o.excuse}
                    />
                )
            }
            <DialogHelperText explanation={explanation} warning={warning} field={field} />
        </OptionalFormGroup>
    );
}

export interface DialogDropdownSelectOption<T extends string> {
    value: T;
    label: string;
}

export function DialogDropdownSelect<T extends string>({
    label,
    field,
    excuse,
    warning,
    explanation,
    options,
    ...props
} : {
    label?: React.ReactNode,
    field: DialogField<T>,
    excuse?: string | falsy,
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
    options: DialogDropdownSelectOption<T>[],
} & Omit<FormSelectProps, "ref" | "children">) {
    return (
        <OptionalFormGroup label={label}>
            <FormSelect
                id={field.id()}
                onChange={(_event, val) => field.set(val as T) }
                validated={warning ? "warning" : undefined}
                isDisabled={!!excuse}
                value={field.get()}
                {...props}
            >
                {
                    options.map(
                        o => {
                            return <FormSelectOption key={o.value} value={o.value} label={o.label} />;
                        }
                    )
                }
            </FormSelect>
            <DialogHelperText explanation={explanation} warning={warning} excuse={excuse} field={field} />
        </OptionalFormGroup>
    );
}

export function DialogDropdownSelectObject<T>({
    label,
    field,
    excuse,
    warning,
    explanation,
    options,
    option_label = (o: T): string => { cockpit.assert(typeof o == "string"); return o },
    ...props
} : {
    label?: React.ReactNode,
    field: DialogField<T>,
    excuse?: string | falsy,
    warning?: React.ReactNode,
    explanation?: React.ReactNode,
    options: T[],
    option_label?: (o: T) => string,
} & Omit<FormSelectProps, "ref" | "children">) {
    return (
        <OptionalFormGroup label={label}>
            <FormSelect
                id={field.id()}
                onChange={(_event, val) => {
                    const opt = options.find(o => option_label(o) == val);
                    field.set(opt!);
                }}
                validated={warning ? "warning" : undefined}
                isDisabled={!!excuse}
                value={option_label(field.get())}
                {...props}
            >
                {
                    options.map(
                        o => {
                            const l = option_label(o);
                            return <FormSelectOption key={l} value={l} label={l} />;
                        }
                    )
                }
            </FormSelect>
            <DialogHelperText explanation={explanation} warning={warning} excuse={excuse} field={field} />
        </OptionalFormGroup>
    );
}
