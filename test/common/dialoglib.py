# Copyright (C) 2025 Red Hat, Inc.
#
# SPDX-License-Identifier: LGPL-2.1-or-later

# DIALOG HELPERS
#
# This is a class of dialog helpers. The idea is to instantiate one
# for each dialog that wants it, maybe like so:
#
#
#    def testBasic(self):
#       b = self.browser
#
#       b.click("#open-my-dialog")
#       b.wait_visible("#my-dialog")
#
#       d = DialogHelpers(b, "#my-dialog")
#       d.set_TextInput("name.first"), "Jim")
#       d.set_TextInput("name.last"), "Kirk")
#
# You need to pass the CSS selector prefix of the <Modal> component to
# DialogHelpers.  This makes it possible to work with multiple stacked
# dialogs.
#
# There are helpers for constructing CSS selectors for dialog elements
# such as input fields, helper texts, and the buttons. There are
# helpers for actually interacting with those elements as well.
#
# The fundamental function is this:
#
# - d.id(path, tag)
#
# This constructs the CSS selector for the DOM element that has been
# instantiated with an OUIA component ID computed by
# "value.ouia_id(tag)", see the documentation for the JavaScript
# dialog framework.  The "path" parameter describes the way the value
# handle was derived in JavaScript: For top-level ones created by
# "dlg.field(name)" it is just "name". For sub-values created by
# "handle.sub(name_or_index)" it is the path of "handle" followed by
# ".", followed by "name_or_index". Nothing fancy.
#
# For example,
#
#    <input
#        data-ouia-component-id={dlg.field("name").sub("first").ouia_id("input")}
#        ...
#    />
#
# can be selected in a test like this:
#
#    b.set_input_text(d.id("name.first", "input"), "Jim")
#
# There are some functions that encode the guidelines for choosing
# tags. These should be used most of the time:
#
# - d.field(path)
#
# The main input element of a field.  Same as d.id(path, "field").
#
# - d.helper_text(path)
#
# The helper text for a field.  Same as d.id(path, "helper-text").
#
# The helpers for interacting with porcelain elements are called
# set_TextInput, wait_TextInput, set_RadioSelect, etc. They are
# hopefully easy to figure out.
#
# For example,
#
#    <DialogTextInput label="First" field={dlg.field("name").sub("first")} />
#
# can be controlled like this by a test:
#
#    d.set_TextInput("name.first", "Jim")
#

import testlib


class DialogHelpers:
    def __init__(self, b: testlib.Browser, dialogSelector: str):
        self.browser = b
        self.dialogSelector = dialogSelector

    def ouia(self, component_id: str) -> str:
        return f"{self.dialogSelector} [data-ouia-component-id='{component_id}']"

    def id(self, path: str, tag: str) -> str:
        return self.ouia(f"dialog-{tag}-{path}")

    def field(self, path: str) -> str:
        return self.id(path, "field")

    def helper_text(self, path: str) -> str:
        return self.id(path, "helper-text")

    def error(self) -> str:
        return self.ouia("dialog-error-message")

    def apply_button(self) -> str:
        return self.ouia("dialog-apply")

    def cancel_button(self) -> str:
        return self.ouia("dialog-cancel")

    # TextInput

    def get_TextInput(self, path: str) -> str:
        return self.browser.val(self.field(path))

    def wait_TextInput(self, path: str, val: str):
        self.browser.wait_val(self.field(path), val)

    def set_TextInput(self, path: str, val: str) -> None:
        self.browser.set_input_text(self.field(path), val)

    # Checkbox

    def get_Checkbox(self, path: str) -> bool:
        return self.browser.get_checked(self.field(path))

    def wait_Checkbox(self, path: str, val: bool) -> None:
        # XXX - implement Browser.wait_checked and use it here
        x = ":checked" if val else ":not(:checked)"
        self.browser.wait_visible(self.field(path) + x)

    def set_Checkbox(self, path: str, val: bool) -> None:
        self.browser.set_checked(self.field(path), val)

    # RadioSelect

    def get_RadioSelect(self, path: str) -> str:
        return self.browser.attr(self.field(path), "data-value")

    def wait_RadioSelect(self, path: str, val: str) -> None:
        self.browser.wait_attr(self.field(path), "data-value", val)

    def set_RadioSelect(self, path: str, val: str) -> None:
        self.browser.click(self.id(path, val))

    # DropdownSelect

    def get_DropdownSelect(self, path: str) -> str:
        return self.browser.val(self.field(path))

    def wait_DropdownSelect(self, path: str, val: str) -> None:
        self.browser.wait_val(self.field(path), val)

    def set_DropdownSelect(self, path: str, val: str) -> None:
        self.browser.select_from_dropdown(self.field(path), val)
