# This file is part of Cockpit.
#
# Copyright (C) 2025 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.


# DIALOG HELPERS
#
# This is a class of dialog helpers. The idea is to instantiate one
# for each test that wants it, maybe like so:
#
#
#    def testBasic(self):
#       b = self.browser
#       d = DialogHelpers(b)
#
#       ...
#       d.set_TextInput("name.first"), "Jim")
#       d.set_TextInput("name.last"), "Kirk")
#
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
# instantiated with an ID attribute computed by "value.id(tag)", see
# the documentation for the JavaScript dialog framework.  The "path"
# parameter describes the way the value handle was derived in
# JavaScript: For top-level ones created by "dlg.value(name)" it is
# just "name". For sub-values created by "value.sub(name_or_index)" it
# is the path of "value" followed by ".", followed by
# "name_or_index". Nothing fancy.
#
# For example,
#
#    <input id={dlg.value("name").sub("first").id("input")} />
#
# can be selected in a test like this:
#
#    b.set_input_text(d.field("name.first", "input"), "Jim")
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
# The helpers for interacting with elements are called set_TextInput,
# wait_TextInput, set_RadioSelect, etc. They are hopefully easy to
# figure out.

import testlib


def css_escape(x: str) -> str:
    return x.replace(".", "\\.")


class DialogHelpers:
    def __init__(self, b: testlib.Browser):
        self.browser = b

    def id(self, path: str, tag: str) -> str:
        return f"#dialog-{tag}-{css_escape(path)}"

    def field(self, path: str) -> str:
        return self.id(path, "field")

    def helper_text(self, path: str) -> str:
        return self.id(path, "helper-text")

    def error(self) -> str:
        return "#dialog-error-message"

    def apply_button(self) -> str:
        return "#dialog-apply"

    def cancel_button(self) -> str:
        return "#dialog-cancel"

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
        # XXX - implemnt Browser.wait_checked and use it here
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
