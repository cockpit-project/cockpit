# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
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

"""Tools for writing Cockpit test cases."""

import argparse
import base64
import errno
import fnmatch
import functools
import glob
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import unittest
from time import sleep
from typing import Any, Callable, Dict, List, Optional, Union

import cdp
import testvm
from lcov import write_lcov
from lib.constants import OSTREE_IMAGES

try:
    from PIL import Image
except ImportError:
    Image = None

BASE_DIR = os.path.realpath(f'{__file__}/../../..')
TEST_DIR = f'{BASE_DIR}/test'
BOTS_DIR = f'{BASE_DIR}/bots'

os.environ["PATH"] = f"{os.environ.get('PATH')}:{BOTS_DIR}:{TEST_DIR}"

# Be careful when changing this string, check in cockpit-project/bots where it is being used
UNEXPECTED_MESSAGE = "FAIL: Test completed, but found unexpected "
PIXEL_TEST_MESSAGE = "Some pixel tests have failed"

__all__ = (
    'PIXEL_TEST_MESSAGE',
    'TEST_DIR',
    'UNEXPECTED_MESSAGE',
    'Browser',
    'Error',
    'MachineCase',
    'arg_parser',
    'no_retry_when_changed',
    'nondestructive',
    'onlyImage',
    'opts',
    'sit',
    'skipBrowser',
    'skipDistroPackage',
    'skipImage',
    'skipOstree',
    'test_main',
    'timeout',
    'todo',
    'todoPybridge',
    'todoPybridgeRHEL8',
    'wait',
)

# Command line options
opts = argparse.Namespace()
opts.sit = False
opts.trace = False
opts.attachments = None
opts.revision = None
opts.address = None
opts.jobs = 1
opts.fetch = True
opts.coverage = False

# Browser layouts
#
# A browser can be switched into a number of different layouts, such
# as "desktop" and "mobile".  A default set of layouts is defined
# here, but projects can override this with a file called
# "test/browser-layouts.json".
#
# Each layout defines the size of the shell (where the main navigation
# is) and also the size of the content iframe (where the actual page
# like "Networking" or "Overview" is displayed).
#
# When the browser layout is switched (by calling Browset.set_layout),
# this will either set the shell size or the content size, depending
# on which frame is current (as set by Browser.enter_page or
# Browser.leave_page).
#
# This makes sure that pixel tests for the whole content iframe are
# always the exact size as specified in the layout definition, and
# don't change size when the navigation stuff in the shell changes.
#
# The browser starts out in the first layout of this list, which is
# "desktop" by default.

default_layouts = [
    {
        "name": "desktop",
        "theme": "light",
        "shell_size": [1920, 1200],
        "content_size": [1680, 1130]
    },
    {
        "name": "medium",
        "theme": "light",
        "is_mobile": False,
        "shell_size": [1280, 768],
        "content_size": [1040, 698]
    },
    {
        "name": "mobile",
        "theme": "light",
        "shell_size": [414, 1920],
        "content_size": [414, 1856]
    },
    {
        "name": "dark",
        "theme": "dark",
        "shell_size": [1920, 1200],
        "content_size": [1680, 1130]
    },
    {
        "name": "rtl",
        "theme": "light",
        "shell_size": [1920, 1200],
        "content_size": [1680, 1130]
    },
]


def attach(filename: str, move: bool = False):
    """Put a file into the attachments directory.

    :param filename: file to put in attachments directory
    :param move: set this to true to move dynamically generated files which
                 are not touched by destructive tests. (default False)
    """
    if not opts.attachments:
        return
    dest = os.path.join(opts.attachments, os.path.basename(filename))
    if os.path.exists(filename) and not os.path.exists(dest):
        if move:
            shutil.move(filename, dest)
        else:
            shutil.copy(filename, dest)


def unique_filename(base, ext):
    for i in range(20):
        if i == 0:
            f = f"{base}.{ext}"
        else:
            f = f"{base}-{i}.{ext}"
        if not os.path.exists(f):
            return f
    return f"{base}.{ext}"


class Browser:
    def __init__(self, address, label, machine, pixels_label=None, coverage_label=None, port=None):
        if ":" in address:
            self.address, _, self.port = address.rpartition(":")
        else:
            self.address = address
            self.port = 9090
        if port is not None:
            self.port = port
        self.default_user = "admin"
        self.label = label
        self.pixels_label = pixels_label
        self.used_pixel_references = set()
        self.coverage_label = coverage_label
        self.machine = machine
        path = os.path.dirname(__file__)
        sizzle_js = os.path.join(path, "../../node_modules/sizzle/dist/sizzle.js")
        helpers = [os.path.join(path, "test-functions.js")]
        if os.path.exists(sizzle_js):
            helpers.append(sizzle_js)
        self.cdp = cdp.CDP("C.utf8", verbose=opts.trace, trace=opts.trace,
                           inject_helpers=helpers,
                           start_profile=coverage_label is not None)
        self.password = "foobar"
        self.timeout_factor = int(os.getenv("TEST_TIMEOUT_FACTOR", "1"))
        self.failed_pixel_tests = 0
        self.allow_oops = False
        self.body_clip = None
        try:
            with open(f'{TEST_DIR}/browser-layouts.json') as fp:
                self.layouts = json.load(fp)
        except FileNotFoundError:
            self.layouts = default_layouts
        # Firefox CDP does not support setting EmulatedMedia
        # https://bugzilla.mozilla.org/show_bug.cgi?id=1549434
        if self.cdp.browser.name != "chromium":
            self.layouts = [layout for layout in self.layouts if layout["theme"] != "dark"]
        self.current_layout = None

    def allow_download(self) -> None:
        """Allow browser downloads"""
        if self.cdp.browser.name == "chromium":
            self.cdp.invoke("Page.setDownloadBehavior", behavior="allow", downloadPath=self.cdp.download_dir)

    def open(self, href: str, cookie: Optional[Dict[str, str]] = None, tls: bool = False):
        """Load a page into the browser.

        :param href: the path of the Cockpit page to load, such as "/users". Either PAGE or URL needs to be given.
        :param cookie: a dictionary object representing a cookie.
        :param tls: load the page using https (default False)

        Raises:
          Error: When a timeout occurs waiting for the page to load.
        """
        if href.startswith("/"):
            schema = "https" if tls else "http"
            href = "%s://%s:%s%s" % (schema, self.address, self.port, href)

        if not self.current_layout and os.environ.get("TEST_SHOW_BROWSER") in [None, "pixels"]:
            self.current_layout = self.layouts[0]
            size = self.current_layout["shell_size"]
            self._set_window_size(size[0], size[1])
        if cookie:
            self.cdp.invoke("Network.setCookie", **cookie)

        self.switch_to_top()
        # Some browsers optimize this away if the current URL is already href
        # (e.g. in TestKeys.testAuthorizedKeys). Load the blank page first to always
        # force a load.
        self.cdp.invoke("Page.navigate", url="about:blank")
        self.cdp.invoke("Page.navigate", url=href)

    def set_user_agent(self, ua: str):
        """Set the user agent of the browser

        :param ua: user agent string
        :type ua: str
        """
        self.cdp.invoke("Emulation.setUserAgentOverride", userAgent=ua)

    def reload(self, ignore_cache: bool = False):
        """Reload the current page

        :param ignore_cache: if true browser cache is ignored (default False)
        :type ignore_cache: bool
        """

        self.switch_to_top()
        self.wait_js_cond("ph_select('iframe.container-frame').every(function (e) { return e.getAttribute('data-loaded'); })")
        self.cdp.invoke("Page.reload", ignoreCache=ignore_cache)

        self.machine.allow_restart_journal_messages()

    def switch_to_frame(self, name: str):
        """Switch to frame in browser tab

        Each page has a main frame and can have multiple subframes, usually
        iframes.

        :param name: frame name
        """
        self.cdp.set_frame(name)

    def switch_to_top(self):
        """Switch to the main frame

        Switch to the main frame from for example an iframe.
        """
        self.cdp.set_frame(None)

    def upload_files(self, selector: str, files: 'list[str]') -> None:
        """Upload a local file to the browser

        The selector should select the <input type="file"/> element.
        Files is a list of absolute paths to files which should be uploaded.
        """
        r = self.cdp.invoke("Runtime.evaluate", expression='document.querySelector(%s)' % jsquote(selector))
        objectId = r["result"]["objectId"]
        self.cdp.invoke("DOM.setFileInputFiles", files=files, objectId=objectId)

    def raise_cdp_exception(self, func, arg, details, trailer=None):
        # unwrap a typical error string
        if details.get("exception", {}).get("type") == "string":
            msg = details["exception"]["value"]
        elif details.get("text", None):
            msg = details.get("text", None)
        else:
            msg = str(details)
        if trailer:
            msg += "\n" + trailer
        raise Error("%s(%s): %s" % (func, arg, msg))

    def inject_js(self, code: str):
        """Execute JS code that does not return anything

        :param code: a string containing JavaScript code
        :type code: str
        """
        self.cdp.invoke("Runtime.evaluate", expression=code, trace=code,
                        silent=False, awaitPromise=True, returnByValue=False, no_trace=True)

    def eval_js(self, code: str, no_trace: bool = False) -> Optional[Any]:
        """Execute JS code that returns something

        :param code: a string containing JavaScript code
        :param no_trace: do not print information about unknown return values (default False)
        """
        result = self.cdp.invoke("Runtime.evaluate", expression=code, trace=code,
                                 silent=False, awaitPromise=True, returnByValue=True, no_trace=no_trace)
        if "exceptionDetails" in result:
            self.raise_cdp_exception("eval_js", code, result["exceptionDetails"])
        _type = result.get("result", {}).get("type")
        if _type == 'object' and result["result"].get("subtype", "") == "error":
            raise Error(result["result"]["description"])
        if _type == "undefined":
            return None
        if _type and "value" in result["result"]:
            return result["result"]["value"]

        if opts.trace:
            print("eval_js(%s): cannot interpret return value %s" % (code, result))
        return None

    def call_js_func(self, func: str, *args: Any) -> Optional[Any]:
        """Call a JavaScript function

        :param func: JavaScript function to call
        :param args: arguments for the JavaScript function
        """
        return self.eval_js("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def set_mock(self, mock: Dict[str, str], base: Optional[str] = ""):
        """Replace some DOM elements with mock text

        The 'mock' parameter is a dictionary from CSS selectors to the
        text that the elements matching the selector should be
        replaced with.

        XXX - There is no way to easily undo the effects of this
              function.  There is no coordination with React.  This
              will improve as necessary.

        :param mock: the mock data, see above
        :param base: if given, all selectors are relative to this one
        """
        self.call_js_func('ph_set_texts', {base + " " + k: v for k, v in mock.items()})

    def cookie(self, name: str):
        """Retrieve a browser cookie by name

        :param name: the name of the cookie
        :type name: str
        """
        cookies = self.cdp.invoke("Network.getCookies")
        for c in cookies["cookies"]:
            if c["name"] == name:
                return c
        return None

    def go(self, url_hash: str):
        self.call_js_func('ph_go', url_hash)

    def mouse(self, selector: str, event: str, x: int = 0, y: int = 0, btn: int = 0, ctrlKey: bool = False, shiftKey: bool = False, altKey: bool = False, metaKey: bool = False):
        """Simulate a browser mouse event

        :param selector: the element to interact with
        :param type: the mouse event to simulate, for example mouseenter, mouseleave, mousemove, click
        :param x: the x coordinate
        :param y: the y coordinate
        :param btn: mouse button to click https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
        :param crtlKey: press the ctrl key
        :param shiftKey: press the shift key
        :param altKey: press the alt key
        :param metaKey: press the meta key
        """
        self.wait_visible(selector)
        self.call_js_func('ph_mouse', selector, event, x, y, btn, ctrlKey, shiftKey, altKey, metaKey)

    def click(self, selector: str):
        """Click on a ui element

        :param selector: the selector to click on
        """
        self.mouse(selector + ":not([disabled]):not([aria-disabled=true])", "click", 0, 0, 0)

    def val(self, selector: str):
        """Get the value attribute of a selector.

        :param selector: the selector to get the value of
        """
        self.wait_visible(selector)
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector: str, val):
        """Set the value attribute of a non disabled DOM element.

        This also emits a change DOM change event.

        :param selector: the selector to set the value of
        :param val: the value to set
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector: str):
        """Get an element's textContent value.

        :param selector: the selector to get the value of
        """
        self.wait_visible(selector)
        return self.call_js_func('ph_text', selector)

    def attr(self, selector: str, attr):
        """Get the value of a given attribute of an element.

        :param selector: the selector to get the attribute of
        :param attr: the DOM element attribute
        """
        self._wait_present(selector)
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector, attr, val):
        """Set an attribute value of an element.

        :param selector: the selector
        :param attr: the element attribute
        :param val: the value of the attribute
        """
        self._wait_present(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_attr', selector, attr, val)

    def get_checked(self, selector: str):
        """Get checked state of a given selector.

        :param selector: the selector
        :return: the checked state
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        return self.call_js_func('ph_get_checked', selector)

    def set_checked(self, selector: str, val):
        """Set checked state of a given selector.

        :param selector: the selector
        :param val: boolean value to enable or disable checkbox
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_checked', selector, val)

    def focus(self, selector: str):
        """Set focus on selected element.

        :param selector: the selector
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_focus', selector)

    def blur(self, selector: str):
        """Remove keyboard focus from selected element.

        :param selector: the selector
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_blur', selector)

    # TODO: Unify them so we can have only one
    def key_press(self, keys: str, modifiers: int = 0, use_ord: bool = False):
        if self.cdp.browser.name == "chromium":
            self._key_press_chromium(keys, modifiers, use_ord)
        else:
            self._key_press_firefox(keys, modifiers, use_ord)

    def _key_press_chromium(self, keys: str, modifiers: int = 0, use_ord=False):
        for key in keys:
            args = {"type": "keyDown", "modifiers": modifiers}

            # If modifiers are used we need to pass windowsVirtualKeyCode which is
            # basically the asci decimal representation of the key
            args["text"] = key
            if use_ord:
                args["windowsVirtualKeyCode"] = ord(key)
            elif (not key.isalnum() and ord(key) < 32) or modifiers != 0:
                args["windowsVirtualKeyCode"] = ord(key.upper())
            else:
                args["key"] = key

            self.cdp.invoke("Input.dispatchKeyEvent", **args)
            args["type"] = "keyUp"
            self.cdp.invoke("Input.dispatchKeyEvent", **args)

    def _key_press_firefox(self, keys: str, modifiers: int = 0, use_ord: bool = False):
        # https://python-reference.readthedocs.io/en/latest/docs/str/ASCII.html
        # Both line feed and carriage return are normalized to Enter (https://html.spec.whatwg.org/multipage/form-elements.html)
        keyMap = {
            8: "Backspace",   # Backspace key
            9: "Tab",         # Tab key
            10: "Enter",      # Enter key (normalized from line feed)
            13: "Enter",      # Enter key (normalized from carriage return)
            27: "Escape",     # Escape key
            37: "ArrowLeft",  # Arrow key left
            40: "ArrowDown",  # Arrow key down
            45: "Insert",     # Insert key
        }
        for key in keys:
            args = {"type": "keyDown", "modifiers": modifiers}

            args["key"] = key
            if ord(key) < 32 or use_ord:
                args["key"] = keyMap[ord(key)]

            self.cdp.invoke("Input.dispatchKeyEvent", **args)
            args["type"] = "keyUp"
            self.cdp.invoke("Input.dispatchKeyEvent", **args)

    def select_from_dropdown(self, selector: str, value):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        text_selector = f"{selector} option[value='{value}']"
        self._wait_present(text_selector)
        self.set_val(selector, value)
        self.wait_val(selector, value)

    def select_PF4(self, selector: str, value):
        self.click(f"{selector}:not([disabled]):not([aria-disabled=true])")
        select_entry = f"{selector} + ul button:contains('{value}')"
        self.click(select_entry)
        if self.is_present(f"{selector}.pf-m-typeahead"):
            self.wait_val(f"{selector} > div input[type=text]", value)
        else:
            self.wait_text(f"{selector} .pf-v5-c-select__toggle-text", value)

    def select_PF5(self, selector_button: str, selector: str, value):
        self.click(f"{selector_button}:not([disabled]):not([aria-disabled=true])")
        select_entry = f"{selector} ul button:contains('{value}')"
        self.click(select_entry)

    def set_input_text(self, selector: str, val: str, append: bool = False, value_check: bool = True, blur: bool = True):
        self.focus(selector)
        if not append:
            self.key_press("a", 2)  # Ctrl + a
        if val == "":
            self.key_press("\b")  # Backspace
        else:
            self.key_press(val)
        if blur:
            self.blur(selector)

        if value_check:
            self.wait_val(selector, val)

    def set_file_autocomplete_val(self, group_identifier: str, location: str):
        self.set_input_text(f"{group_identifier} .pf-v5-c-select__toggle-typeahead input", location)
        # click away the selection list, to force a state update
        self.click(f"{group_identifier} .pf-v5-c-select__toggle-typeahead")
        self.wait_not_present(f"{group_identifier} .pf-v5-c-select__menu")

    def wait_timeout(self, timeout: int):
        browser = self

        class WaitParamsRestorer():
            def __init__(self, timeout):
                self.timeout = timeout

            def __enter__(self):
                pass

            def __exit__(self, type_, value, traceback):
                browser.cdp.timeout = self.timeout
        r = WaitParamsRestorer(self.cdp.timeout)
        self.cdp.timeout = timeout
        return r

    def wait(self, predicate: Callable):
        for _ in range(self.cdp.timeout * self.timeout_factor * 5):
            val = predicate()
            if val:
                return val
            time.sleep(0.2)
        raise Error('timed out waiting for predicate to become true')

    def wait_js_cond(self, cond: str, error_description: str = "null"):
        count = 0
        timeout = self.cdp.timeout * self.timeout_factor
        start = time.time()
        while True:
            count += 1
            try:
                result = self.cdp.invoke("Runtime.evaluate",
                                         expression="ph_wait_cond(() => %s, %i, %s)" % (cond, timeout * 1000, error_description),
                                         silent=False, awaitPromise=True, trace="wait: " + cond)
                if "exceptionDetails" in result:
                    if self.cdp.browser.name == "firefox" and count < 20 and "ph_wait_cond is not defined" in result["exceptionDetails"].get("text", ""):
                        time.sleep(0.1)
                        continue
                    trailer = "\n".join(self.cdp.get_js_log())
                    self.raise_cdp_exception("timeout\nwait_js_cond", cond, result["exceptionDetails"], trailer)
                if timeout > 0:
                    duration = time.time() - start
                    percent = int(duration / timeout * 100)
                    if percent >= 50:
                        print(f"WARNING: Waiting for {cond} took {duration:.1f} seconds, which is {percent}% of the timeout.")
                return
            except RuntimeError as e:
                data = e.args[0]
                if count < 20 and isinstance(data, dict) and "response" in data and data["response"].get("message") in ["Execution context was destroyed.", "Cannot find context with specified id"]:
                    time.sleep(1)
                else:
                    raise e

    def wait_js_func(self, func: str, *args: Any):
        self.wait_js_cond("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def is_present(self, selector: str) -> Optional[bool]:
        return self.call_js_func('ph_is_present', selector)

    def _wait_present(self, selector: str):
        self.wait_js_func('ph_is_present', selector)

    def wait_not_present(self, selector: str):
        self.wait_js_func('!ph_is_present', selector)

    def is_visible(self, selector: str) -> Optional[bool]:
        return self.call_js_func('ph_is_visible', selector)

    def wait_visible(self, selector: str):
        self._wait_present(selector)
        self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector: str, val: str):
        self.wait_visible(selector)
        self.wait_js_func('ph_has_val', selector, val)

    def wait_not_val(self, selector: str, val: str):
        self.wait_visible(selector)
        self.wait_js_func('!ph_has_val', selector, val)

    def wait_attr(self, selector, attr, val):
        self._wait_present(selector)
        self.wait_js_func('ph_has_attr', selector, attr, val)

    def wait_attr_contains(self, selector, attr, val):
        self._wait_present(selector)
        self.wait_js_func('ph_attr_contains', selector, attr, val)

    def wait_attr_not_contains(self, selector, attr, val):
        self._wait_present(selector)
        self.wait_js_func('!ph_attr_contains', selector, attr, val)

    def wait_not_attr(self, selector, attr, val):
        self._wait_present(selector)
        self.wait_js_func('!ph_has_attr', selector, attr, val)

    def wait_not_visible(self, selector: str):
        self.wait_js_func('!ph_is_visible', selector)

    def wait_in_text(self, selector: str, text: str):
        self.wait_visible(selector)
        self.wait_js_cond("ph_in_text(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_not_in_text(self, selector: str, text: str):
        self.wait_visible(selector)
        self.wait_js_func('!ph_in_text', selector, text)

    def wait_collected_text(self, selector: str, text: str):
        self.wait_js_func('ph_collected_text_is', selector, text)

    def wait_text(self, selector: str, text: str):
        self.wait_visible(selector)
        self.wait_js_cond("ph_text_is(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_text_not(self, selector: str, text: str):
        self.wait_visible(selector)
        self.wait_js_func('!ph_text_is', selector, text)

    def wait_text_matches(self, selector: str, pattern: str):
        self.wait_visible(selector)
        self.wait_js_func('ph_text_matches', selector, pattern)

    def wait_popup(self, elem_id: str):
        """Wait for a popup to open.

        :param id: the 'id' attribute of the popup.
        """
        self.wait_visible('#' + elem_id)

    def wait_popdown(self, elem_id: str):
        """Wait for a popup to close.

        :param id: the 'id' attribute of the popup.
        """
        self.wait_not_visible('#' + elem_id)

    def wait_language(self, lang: str):
        parts = lang.split("-")
        code_1 = parts[0]
        code_2 = parts[0]
        if len(parts) > 1:
            code_2 += "_" + parts[1].upper()
        self.wait_js_cond("cockpit.language == '%s' || cockpit.language == '%s'" % (code_1, code_2))

    def dialog_cancel(self, sel: str, button: str = "button[data-dismiss='modal']"):
        self.click(sel + " " + button)
        self.wait_not_visible(sel)

    def enter_page(self, path: str, host: Optional[str] = None, reconnect: bool = True):
        """Wait for a page to become current.

        :param path: The identifier the page.  This is a string starting with "/"
        :type path: str
        :param host: The host to connect too
        :type host: str
        :param reconnect: Try to reconnect
        :type reconnect: bool
        """
        assert path.startswith("/")
        if host:
            frame = host + path
        else:
            frame = "localhost" + path
        frame = "cockpit1:" + frame

        self.switch_to_top()

        while True:
            try:
                self._wait_present("iframe.container-frame[name='%s'][data-loaded]" % frame)
                self.wait_not_visible(".curtains-ct")
                self.wait_visible("iframe.container-frame[name='%s']" % frame)
                break
            except Error as ex:
                if reconnect and ex.msg.startswith('timeout'):
                    reconnect = False
                    if self.is_present("#machine-reconnect"):
                        self.click("#machine-reconnect")
                        self.wait_not_visible(".curtains-ct")
                        continue
                raise

        self.switch_to_frame(frame)
        self._wait_present("body")
        self.wait_visible("body")

    def leave_page(self):
        self.switch_to_top()

    def try_login(self, user: Optional[str] = None, password: Optional[str] = None, superuser: Optional[bool] = True, legacy_authorized: Optional[bool] = None):
        """Fills in the login dialog and clicks the button.

        This differs from login_and_go() by not expecting any particular result.

        :param user: the username to login with
        :type user: str
        :param password: the password of the user
        :type password: str
        :param superuser: determines whether the new session will try to get Administrative Access (default true)
        :type superuser: bool
        :param legacy_authorized: old versions of the login dialog that still
             have the "[ ] Reuse my password for magic things" checkbox.  Such a
             dialog is encountered when testing against old bastion hosts, for
             example.
        """
        if user is None:
            user = self.default_user
        if password is None:
            password = self.password
        self.wait_visible("#login")
        self.set_val('#login-user-input', user)
        self.set_val('#login-password-input', password)
        if legacy_authorized is not None:
            self.set_checked('#authorized-input', legacy_authorized)
        if superuser is not None:
            self.eval_js('window.localStorage.setItem("superuser:%s", "%s");' % (user, "any" if superuser else "none"))
        self.click('#login-button')

    def login_and_go(self, path: Optional[str] = None, user: Optional[str] = None, host: Optional[str] = None,
                     superuser: bool = True, urlroot: Optional[str] = None, tls: bool = False, password: Optional[str] = None,
                     legacy_authorized: Optional[bool] = None):
        """Fills in the login dialog, clicks the button and navigates to the given path

        :param user: the username to login with
        :type user: str
        :param password: the password of the user
        :type password: str
        :param superuser: determines whether the new session will try to get Administrative Access (default true)
        :type superuser: bool
        :param legacy_authorized: old versions of the login dialog that still
             have the "[ ] Reuse my password for magic things" checkbox.  Such a
             dialog is encountered when testing against old bastion hosts, for
             example.
        """
        href = path
        if not href:
            href = "/"
        if urlroot:
            href = urlroot + href
        if host:
            href = "/@" + host + href
        self.open(href, tls=tls)

        self.try_login(user, password, superuser=superuser, legacy_authorized=legacy_authorized)

        self._wait_present('#content')
        self.wait_visible('#content')
        if path:
            self.enter_page(path.split("#")[0], host=host)

    def logout(self):
        self.assert_no_oops()
        self.switch_to_top()

        self.wait_visible("#toggle-menu")
        if self.is_present("button#machine-reconnect") and self.is_visible("button#machine-reconnect"):
            # happens when shutting down cockpit or rebooting machine
            self.click("button#machine-reconnect")
        else:
            # happens when cockpit is still running
            self.open_session_menu()
            try:
                self.click('#logout')
            except RuntimeError as e:
                # logging out does destroy the current frame context, it races with the CDP driver finishing the command
                if "Execution context was destroyed" not in str(e):
                    raise
        self.wait_visible('#login')

        self.machine.allow_restart_journal_messages()

    def relogin(self, path: Optional[str] = None, user: Optional[str] = None, password: Optional[str] = None,
                superuser: Optional[bool] = None, wait_remote_session_machine: Optional[testvm.Machine] = None):
        self.logout()
        if wait_remote_session_machine:
            wait_remote_session_machine.execute("while pgrep -a cockpit-ssh; do sleep 1; done")
        self.try_login(user, password=password, superuser=superuser)
        self._wait_present('#content')
        self.wait_visible('#content')
        if path:
            if path.startswith("/@"):
                host = path[2:].split("/")[0]
            else:
                host = None
            self.enter_page(path.split("#")[0], host=host)

    def open_session_menu(self):
        self.wait_visible("#toggle-menu")
        if (self.attr("#toggle-menu", "aria-expanded") != "true"):
            self.click("#toggle-menu")

    def layout_is_mobile(self):
        return self.current_layout and self.current_layout["shell_size"][0] < 420

    def open_superuser_dialog(self):
        if self.layout_is_mobile():
            self.open_session_menu()
            self.click("#super-user-indicator-mobile button")
        else:
            self.click("#super-user-indicator button")

    def check_superuser_indicator(self, expected: str):
        if self.layout_is_mobile():
            self.open_session_menu()
            self.wait_text("#super-user-indicator-mobile", expected)
            self.click("#toggle-menu")
        else:
            self.wait_text("#super-user-indicator", expected)

    def become_superuser(self, user: Optional[str] = None, password: Optional[str] = None, passwordless: Optional[bool] = False):
        cur_frame = self.cdp.cur_frame
        self.switch_to_top()

        self.open_superuser_dialog()

        if passwordless:
            self.wait_in_text("div[role=dialog]:contains('Administrative access')", "You now have administrative access.")
            self.click("div[role=dialog] button:contains('Close')")
            self.wait_not_present("div[role=dialog]:contains('You now have administrative access.')")
        else:
            self.wait_in_text("div[role=dialog]:contains('Switch to administrative access')", f"Password for {user or 'admin'}:")
            self.set_input_text("div[role=dialog]:contains('Switch to administrative access') input", password or "foobar")
            self.click("div[role=dialog] button:contains('Authenticate')")
            self.wait_not_present("div[role=dialog]:contains('Switch to administrative access')")

        self.check_superuser_indicator("Administrative access")
        self.switch_to_frame(cur_frame)

    def drop_superuser(self):
        cur_frame = self.cdp.cur_frame
        self.switch_to_top()

        self.open_superuser_dialog()
        self.click("div[role=dialog]:contains('Switch to limited access') button:contains('Limit access')")
        self.wait_not_present("div[role=dialog]:contains('Switch to limited access')")
        self.check_superuser_indicator("Limited access")

        self.switch_to_frame(cur_frame)

    def click_system_menu(self, path: str, enter: bool = True):
        """Click on a "System" menu entry with given URL path

        Enters the given target frame afterwards, unless enter=False is given
        (useful for remote hosts).
        """
        self.switch_to_top()
        self.click(f"#host-apps a[href='{path}']")
        if enter:
            # strip off parameters after hash
            self.enter_page(path.split('#')[0].rstrip('/'))

    def get_pf_progress_value(self, progress_bar_sel):
        """Get numeric value of a PatternFly <ProgressBar> component"""
        sel = progress_bar_sel + " .pf-v5-c-progress__indicator"
        self.wait_visible(sel)
        self.wait_attr_contains(sel, "style", "width:")
        style = self.attr(sel, "style")
        m = re.search(r"width: (\d+)%;", style)
        return int(m.group(1))

    def ignore_ssl_certificate_errors(self, ignore: bool):
        action = "continue" if ignore else "cancel"
        if opts.trace:
            print("-> Setting SSL certificate error policy to %s" % action)
        self.cdp.command(f"setSSLBadCertificateAction('{action}')")

    def grant_permissions(self, *args: str):
        """Grant permissions to the browser"""
        # https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-grantPermissions
        self.cdp.invoke("Browser.grantPermissions",
                        origin="http://%s:%s" % (self.address, self.port),
                        permissions=args)

    def snapshot(self, title: str, label: Optional[str] = None):
        """Take a snapshot of the current screen and save it as a PNG and HTML.

        Arguments:
            title: Used for the filename.
        """
        if self.cdp and self.cdp.valid:
            self.cdp.command("clearExceptions()")

            filename = unique_filename(f"{label or self.label}-{title}", "png")
            if self.body_clip:
                ret = self.cdp.invoke("Page.captureScreenshot", clip=self.body_clip, no_trace=True)
            else:
                ret = self.cdp.invoke("Page.captureScreenshot", no_trace=True)
            if "data" in ret:
                with open(filename, 'wb') as f:
                    f.write(base64.standard_b64decode(ret["data"]))
                attach(filename, move=True)
                print("Wrote screenshot to " + filename)
            else:
                print("Screenshot not available")

            filename = unique_filename(f"{label or self.label}-{title}", "html")
            html = self.cdp.invoke("Runtime.evaluate", expression="document.documentElement.outerHTML",
                                   no_trace=True)["result"]["value"]
            with open(filename, 'wb') as f:
                f.write(html.encode('UTF-8'))
            attach(filename, move=True)
            print("Wrote HTML dump to " + filename)

    def _set_window_size(self, width: int, height: int):
        self.cdp.invoke("Emulation.setDeviceMetricsOverride",
                        width=width, height=height,
                        deviceScaleFactor=0, mobile=False)

    def _set_emulated_media_theme(self, name: str):
        # https://bugzilla.mozilla.org/show_bug.cgi?id=1549434
        if self.cdp.browser.name == "chromium":
            self.cdp.invoke("Emulation.setEmulatedMedia", features=[{'name': 'prefers-color-scheme', 'value': name}])

    def _set_direction(self, direction: str):
        cur_frame = self.cdp.cur_frame
        if self.is_present("#shell-page"):
            self.switch_to_top()
            self.set_attr("#shell-page", "dir", direction)
        self.switch_to_frame(cur_frame)
        self.set_attr("html", "dir", direction)

    def set_layout(self, name: str):
        layout = next(lo for lo in self.layouts if lo["name"] == name)
        if layout != self.current_layout:
            if layout["name"] == "rtl":
                self._set_direction("rtl")
            elif layout["name"] != "rtl" and self.current_layout and self.current_layout["name"] == "rtl":
                self._set_direction("ltr")

            self.current_layout = layout
            size = layout["shell_size"]
            self._set_window_size(size[0], size[1])
            self._adjust_window_for_fixed_content_size()
            self._set_emulated_media_theme(layout["theme"])

    def _adjust_window_for_fixed_content_size(self):
        if self.eval_js("window.name").startswith("cockpit1:"):
            # Adjust the window size further so that the content is
            # exactly the expected size.  This will make sure that
            # pixel tests of the content will not be affected by
            # changes in shell navigation elements around it.  It is
            # important that we do this only after getting the shell
            # into about the right size so that it switches into the
            # right layout mode.
            shell_size = self.current_layout["shell_size"]
            want_size = self.current_layout["content_size"]
            have_size = self.eval_js("[ document.body.offsetWidth, document.body.offsetHeight ]")
            delta = (want_size[0] - have_size[0], want_size[1] - have_size[1])
            if delta[0] != 0 or delta[1] != 0:
                self._set_window_size(shell_size[0] + delta[0], shell_size[1] + delta[1])

    def assert_pixels_in_current_layout(self, selector: str, key: str,
                                        ignore: Optional[List[str]] = None,
                                        mock: Optional[Dict[str, str]] = None,
                                        sit_after_mock: bool = False,
                                        scroll_into_view: Optional[str] = None,
                                        wait_animations: bool = True,
                                        wait_delay: float = 0.5):
        """Compare the given element with its reference in the current layout"""

        if ignore is None:
            ignore = []

        if not (Image and self.pixels_label):
            return

        self._adjust_window_for_fixed_content_size()
        self.call_js_func('ph_scrollIntoViewIfNeeded', scroll_into_view or selector)
        self.call_js_func('ph_blur_active')

        # Wait for all animations to be over.  This is done by
        # counting them all over and over again until there are zero.
        # Calling `.finish()` on all animations would miss those that
        # are created while we wait, and would also fail with an
        # exception if any unlimited animations are present, like
        # spinners.
        #
        # There is another complication with tooltips.  They are shown
        # on top of certain elements, but are not DOM children of
        # these elements. Also, Patternfly sometimes creates tooltips
        # on dialog titles that are too long for the dialog, but only
        # a little bit after the dialog has appeared.
        #
        # We don't want to predict whether tooltips will appear, and
        # thus we can't wait for them to be present before waiting for
        # their fade-in animation to be over.
        #
        # But we know that tooltips fade in within 300ms, so we just
        # wait half a second to and side-step all that complexity.

        if wait_animations:
            time.sleep(wait_delay)
            self.wait_js_cond('ph_count_animations(%s) == 0' % jsquote(selector))

        if mock is not None:
            self.set_mock(mock, base=selector)
            if sit_after_mock:
                sit()

        rect = self.call_js_func('ph_element_clip', selector)

        def relative_clips(sels):
            return [(
                    r['x'] - rect['x'],
                    r['y'] - rect['y'],
                    r['x'] - rect['x'] + r['width'],
                    r['y'] - rect['y'] + r['height'])
                    for r in self.call_js_func('ph_selector_clips', sels)]

        reference_dir = os.path.join(TEST_DIR, 'reference')
        if not os.path.exists(os.path.join(reference_dir, '.git')):
            raise SystemError("Pixel test references are missing, please run: test/common/pixel-tests pull")

        ignore_rects = relative_clips([f"{selector} {item}" for item in ignore])
        base = self.pixels_label + "-" + key
        if self.current_layout != self.layouts[0]:
            base += "-" + self.current_layout["name"]
        filename = base + "-pixels.png"
        ref_filename = os.path.join(reference_dir, filename)
        self.used_pixel_references.add(ref_filename)
        ret = self.cdp.invoke("Page.captureScreenshot", clip=rect, no_trace=True)
        png_now = base64.standard_b64decode(ret["data"])
        png_ref = os.path.exists(ref_filename) and open(ref_filename, "rb").read()
        if not png_ref:
            with open(filename, 'wb') as f:
                f.write(png_now)
            attach(filename, move=True)
            print("New pixel test reference " + filename)
            self.failed_pixel_tests += 1
        else:
            img_now = Image.open(io.BytesIO(png_now)).convert("RGBA")
            img_ref = Image.open(io.BytesIO(png_ref)).convert("RGBA")
            img_delta = Image.new("RGBA",
                                  (max(img_now.size[0], img_ref.size[0]), max(img_now.size[1], img_ref.size[1])),
                                  (255, 0, 0, 255))

            # The current snapshot and the reference don't need to
            # be perfectly identical.  They might differ in the
            # following ways:
            #
            # - A pixel in the reference image might be
            #   transparent.  These pixels are ignored.
            #
            # - The call to assert_pixels specifies a list of
            #   rectangles (via CSS selectors).  Pixels within those
            #   rectangles (and slightly outside) are ignored.  Pixels
            #   just outside the rectangles are also ignored to avoid
            #   issues with rounding coordinates.
            #
            # - The RGB values of pixels can differ by up to 2.
            #
            # - There can be up to 20 different pixels
            #
            # Pixels that are different but have been ignored are
            # marked in the delta image in green.

            def masked(ref):
                return ref[3] != 255

            def ignorable_coord(x, y):
                for (x0, y0, x1, y1) in ignore_rects:
                    if x >= x0 - 2 and x < x1 + 2 and y >= y0 - 2 and y < y1 + 2:
                        return True
                return False

            def ignorable_change(a, b):
                return abs(a[0] - b[0]) <= 2 and abs(a[1] - b[1]) <= 2 and abs(a[1] - b[1]) <= 2

            def img_eq(ref, now, delta):
                # This is slow but exactly what we want.
                # ImageMath might be able to speed this up.
                data_ref = ref.load()
                data_now = now.load()
                data_delta = delta.load()
                result = True
                count = 0
                width, height = delta.size
                for y in range(height):
                    for x in range(width):
                        if x >= ref.size[0] or x >= now.size[0] or y >= ref.size[1] or y >= now.size[1]:
                            result = False
                        elif data_ref[x, y] != data_now[x, y]:
                            if masked(data_ref[x, y]) or ignorable_coord(x, y) or ignorable_change(data_ref[x, y], data_now[x, y]):
                                data_delta[x, y] = (0, 255, 0, 255)
                            else:
                                data_delta[x, y] = (255, 0, 0, 255)
                                count += 1
                                if count > 20:
                                    result = False
                        else:
                            data_delta[x, y] = data_ref[x, y]
                return result

            if not img_eq(img_ref, img_now, img_delta):
                if img_now.size == img_ref.size:
                    # Preserve alpha channel so that the 'now'
                    # image can be used as the new reference image
                    # without further changes
                    img_now.putalpha(img_ref.getchannel("A"))
                img_now.save(filename)
                attach(filename, move=True)
                ref_filename_for_attach = base + "-reference.png"
                img_ref.save(ref_filename_for_attach)
                attach(ref_filename_for_attach, move=True)
                delta_filename = base + "-delta.png"
                img_delta.save(delta_filename)
                attach(delta_filename, move=True)
                print("Differences in pixel test " + base)
                self.failed_pixel_tests += 1

    def assert_pixels(self, selector: str, key: str,
                      ignore: Optional[List[str]] = None,
                      mock: Optional[Dict[str, str]] = None,
                      sit_after_mock: bool = False,
                      skip_layouts: Optional[List[str]] = None,
                      scroll_into_view: Optional[str] = None,
                      wait_animations: bool = True,
                      wait_after_layout_change: bool = False,
                      wait_delay: float = 0.5):
        """Compare the given element with its reference in all layouts"""

        if ignore is None:
            ignore = []

        if skip_layouts is None:
            skip_layouts = []

        if not (Image and self.pixels_label):
            return

        # If the page overflows make sure to not show a scrollbar
        # Don't apply this hack for login and terminal and shell as they don't use PF Page
        if not self.is_present("#shell-page") and not self.is_present("#login-details") and not self.is_present("#system-terminal-page"):
            self.switch_to_frame(self.cdp.cur_frame)
            classes = self.attr("main", "class")
            if "pf-v5-c-page__main" in classes:
                self.set_attr("main.pf-v5-c-page__main", "class", f"{classes} pixel-test")

        if self.current_layout:
            previous_layout = self.current_layout["name"]
            for layout in self.layouts:
                if layout["name"] not in skip_layouts:
                    self.set_layout(layout["name"])
                    if wait_after_layout_change:
                        time.sleep(wait_delay)
                    self.assert_pixels_in_current_layout(selector, key, ignore=ignore,
                                                         mock=mock, sit_after_mock=sit_after_mock,
                                                         scroll_into_view=scroll_into_view,
                                                         wait_animations=wait_animations,
                                                         wait_delay=wait_delay)

            self.set_layout(previous_layout)

    def assert_no_unused_pixel_test_references(self):
        """Check whether all reference images in test/reference have been used."""

        if not (Image and self.pixels_label):
            return

        pixel_references = set(glob.glob(os.path.join(TEST_DIR, "reference", self.pixels_label + "*-pixels.png")))
        unused = pixel_references - self.used_pixel_references
        for u in unused:
            print("Unused reference image " + os.path.basename(u))
            self.failed_pixel_tests += 1

    def get_js_log(self):
        """Return the current javascript log"""

        if self.cdp:
            return self.cdp.get_js_log()
        return []

    def copy_js_log(self, title: str, label: Optional[str] = None):
        """Copy the current javascript log"""

        logs = list(self.get_js_log())
        if logs:
            filename = unique_filename(f"{label or self.label}-{title}", "js.log")
            with open(filename, 'wb') as f:
                f.write('\n'.join(logs).encode('UTF-8'))
            attach(filename, move=True)
            print("Wrote JS log to " + filename)

    def kill(self):
        self.cdp.kill()

    def write_coverage_data(self):
        if self.coverage_label and self.cdp and self.cdp.valid:
            coverage = self.cdp.invoke("Profiler.takePreciseCoverage")
            write_lcov(coverage['result'], self.coverage_label)

    def assert_no_oops(self):
        if self.allow_oops:
            return

        if self.cdp and self.cdp.valid:
            self.switch_to_top()
            if self.is_present("#navbar-oops"):
                assert not self.is_visible("#navbar-oops"), "Cockpit shows an Oops"


class MachineCase(unittest.TestCase):
    image = testvm.DEFAULT_IMAGE
    libexecdir = None
    runner = None
    machine: testvm.Machine
    machines = Dict[str, testvm.Machine]
    machine_class = None
    browser: Browser
    network = None
    journal_start = None

    # provision is a dictionary of dictionaries, one for each additional machine to be created, e.g.:
    # provision = { 'openshift' : { 'image': 'openshift', 'memory_mb': 1024 } }
    # These will be instantiated during setUp, and replaced with machine objects
    provision: Optional[Dict[str, Dict[str, Union[str, int]]]] = None

    global_machine = None

    @classmethod
    def get_global_machine(cls):
        if cls.global_machine:
            return cls.global_machine
        cls.global_machine = cls.new_machine(cls, restrict=True, cleanup=False)
        if opts.trace:
            print(f"Starting global machine {cls.global_machine.label}")
        cls.global_machine.start()
        return cls.global_machine

    @classmethod
    def kill_global_machine(cls):
        if cls.global_machine:
            cls.global_machine.kill()
            cls.global_machine = None

    def label(self):
        return self.__class__.__name__ + '-' + self._testMethodName

    def new_machine(self, image=None, forward=None, restrict=True, cleanup=True, inherit_machine_class=True, **kwargs):
        machine_class = (inherit_machine_class and self.machine_class) or testvm.VirtMachine

        if opts.address:
            if forward:
                raise unittest.SkipTest("Cannot run this test when specific machine address is specified")
            machine = testvm.Machine(address=opts.address, image=image or self.image, verbose=opts.trace, browser=opts.browser)
            if cleanup:
                self.addCleanup(machine.disconnect)
        else:
            if image is None:
                image = os.path.join(TEST_DIR, "images", self.image)
                if not os.path.exists(image):
                    raise FileNotFoundError("Can't run tests without a prepared image; use test/image-prepare")
            if not self.network:
                network = testvm.VirtNetwork(image=image)
                if cleanup:
                    self.addCleanup(network.kill)
                self.network = network
            networking = self.network.host(restrict=restrict, forward=forward or {})
            machine = machine_class(verbose=opts.trace, networking=networking, image=image, **kwargs)
            if opts.fetch and not os.path.exists(machine.image_file):
                machine.pull(machine.image_file)
            if cleanup:
                self.addCleanup(machine.kill)
        return machine

    def new_browser(self, machine=None, coverage=False):
        if machine is None:
            machine = self.machine
        label = self.label() + "-" + machine.label
        pixels_label = None
        if os.environ.get("TEST_BROWSER", "chromium") == "chromium" and not self.is_devel_build():
            try:
                with open(f'{TEST_DIR}/reference-image') as fp:
                    reference_image = fp.read().strip()
            except FileNotFoundError:
                # no "reference-image" file available; this most likely means that
                # there are no pixel tests to execute
                pass
            else:
                if machine.image == reference_image:
                    pixels_label = self.label()
        browser = Browser(machine.web_address,
                          label=label, pixels_label=pixels_label, coverage_label=self.label() if coverage else None,
                          port=machine.web_port, machine=self)
        self.addCleanup(browser.kill)
        return browser

    def getError(self):
        # errors is a list of (method, exception) calls (usually multiple
        # per method); None exception means success
        errors = []
        if hasattr(self._outcome, 'errors'):
            # Python 3.4 - 3.10  (These two methods have no side effects)
            result = self.defaultTestResult()
            errors = result.errors
            self._feedErrorsToResult(result, self._outcome.errors)
        elif hasattr(self._outcome, 'result') and hasattr(self._outcome.result, '_excinfo'):
            # pytest emulating unittest
            return self._outcome.result._excinfo
        else:
            # Python 3.11+ now records errors and failures seperate
            errors = self._outcome.result.errors + self._outcome.result.failures

        try:
            return errors[0][1]
        except IndexError:
            return None

    def is_nondestructive(self):
        test_method = getattr(self.__class__, self._testMethodName)
        return get_decorator(test_method, self.__class__, "nondestructive")

    def is_devel_build(self) -> bool:
        return os.environ.get('NODE_ENV') == 'development'

    def is_pybridge(self) -> bool:
        # some tests start e.g. centos-7 as first machine, bridge may not exist there
        return any('python' in m.execute('head -c 30 /usr/bin/cockpit-bridge || true') for m in self.machines.values())

    def disable_preload(self, *packages, machine=None):
        if machine is None:
            machine = self.machine
        for pkg in packages:
            machine.write(f"/etc/cockpit/{pkg}.override.json", '{ "preload": [ ] }')

    def enable_preload(self, package: str, *pages: str):
        pages_str = ', '.join(f'"{page}"' for page in pages)
        self.machine.write(f"/etc/cockpit/{package}.override.json", f'{{ "preload": [ {pages_str} ] }}')

    def system_before(self, version):
        try:
            v = self.machine.execute("""rpm -q --qf '%{V}' cockpit-system ||
                                        dpkg-query -W -f '${source:Upstream-Version}' cockpit-system ||
                                        (pacman -Q cockpit | cut -f2 -d' ' | cut -f1 -d-)
                                     """).split(".")
        except subprocess.CalledProcessError:
            return False

        return int(v[0]) < version

    def setUp(self, restrict=True):
        self.allowed_messages = self.default_allowed_messages
        self.allowed_console_errors = self.default_allowed_console_errors
        self.allow_core_dumps = False

        if os.getenv("MACHINE"):
            # apply env variable together if MACHINE envvar is set
            opts.address = os.getenv("MACHINE")
            if self.is_nondestructive():
                pass
            elif os.getenv("DESTRUCTIVE") and not self.is_nondestructive():
                print("Run destructive test, be careful, may lead to upredictable state of machine")
            else:
                raise unittest.SkipTest("Skip destructive test by default")
            if os.getenv("BROWSER"):
                opts.browser = os.getenv("BROWSER")
            if os.getenv("TRACE"):
                opts.trace = True
            if os.getenv("SIT"):
                opts.sit = True

        if opts.address and self.provision is not None:
            raise unittest.SkipTest("Cannot provision multiple machines if a specific machine address is specified")

        self.machines = {}
        provision = self.provision or {'machine1': {}}
        self.tmpdir = tempfile.mkdtemp()
        # automatically cleaned up for @nondestructive tests, but you have to create it yourself
        self.vm_tmpdir = "/var/lib/cockpittest"

        if self.is_nondestructive() and not opts.address:
            if self.provision:
                raise unittest.SkipTest("Cannot provision machines if test is marked as nondestructive")
            self.machine = self.machines['machine1'] = MachineCase.get_global_machine()
        else:
            MachineCase.kill_global_machine()
            first_machine = True
            # First create all machines, wait for them later
            for key in sorted(provision.keys()):
                options = provision[key].copy()
                if 'address' in options:
                    del options['address']
                if 'dns' in options:
                    del options['dns']
                if 'dhcp' in options:
                    del options['dhcp']
                if 'restrict' not in options:
                    options['restrict'] = restrict
                machine = self.new_machine(**options)
                self.machines[key] = machine
                if first_machine:
                    first_machine = False
                    self.machine = machine
                if opts.trace:
                    print(f"Starting {key} {machine.label}")
                machine.start()

        self.danger_btn_class = '.pf-m-danger'
        self.primary_btn_class = '.pf-m-primary'
        self.default_btn_class = '.pf-m-secondary'

        # Now wait for the other machines to be up
        for key in self.machines.keys():
            machine = self.machines[key]
            machine.wait_boot()
            address = provision[key].get("address")
            if address is not None:
                machine.set_address(address)
            dns = provision[key].get("dns")
            if address or dns:
                machine.set_dns(dns)
            dhcp = provision[key].get("dhcp", False)
            if dhcp:
                machine.dhcp_server()

        self.journal_start = self.machine.journal_cursor()
        self.browser: Browser = self.new_browser(coverage=opts.coverage)
        # fail tests on criticals
        self.machine.write("/etc/cockpit/cockpit.conf", "[Log]\nFatal = criticals\n")
        if self.is_nondestructive():
            self.nonDestructiveSetup()

        # Pages with debug enabled are huge and loading/executing them is heavy for browsers
        # To make it easier for browsers and thus make tests quicker, disable packagekit and systemd preloads
        if self.is_devel_build():
            self.disable_preload("packagekit", "systemd")

        image = self.machine.image

        if image.startswith(('debian', 'ubuntu')) or image == 'arch':
            self.libexecdir = '/usr/lib/cockpit'
        else:
            self.libexecdir = '/usr/libexec'

        if image.startswith(('debian', 'ubuntu')):
            self.sshd_service = 'ssh.service'
            self.sshd_socket = 'ssh.socket'
        else:
            self.sshd_service = 'sshd.service'
            if image == 'arch':
                self.sshd_socket = None
            else:
                self.sshd_socket = 'sshd.socket'
        self.restart_sshd = f'systemctl try-restart {self.sshd_service}'

    def nonDestructiveSetup(self):
        """generic setUp/tearDown for @nondestructive tests"""

        m = self.machine

        # helps with mapping journal output to particular tests
        name = "%s.%s" % (self.__class__.__name__, self._testMethodName)
        m.execute("logger -p user.info 'COCKPITTEST: start %s'" % name)
        self.addCleanup(m.execute, "logger -p user.info 'COCKPITTEST: end %s'" % name)

        # core dumps get copied per-test, don't clobber subsequent tests with them
        self.addCleanup(m.execute, "find /var/lib/systemd/coredump -type f -delete")

        # temporary directory in the VM
        self.addCleanup(m.execute, f"""
            if [ -d {self.vm_tmpdir} ]; then
                findmnt --list --noheadings --output TARGET | grep ^{self.vm_tmpdir} | xargs -r umount
                rm -r {self.vm_tmpdir}
            fi""")

        # users/groups/home dirs
        self.restore_file("/etc/passwd")
        self.restore_file("/etc/group")
        self.restore_file("/etc/shadow")
        self.restore_file("/etc/gshadow")
        self.restore_file("/etc/subuid")
        self.restore_file("/etc/subgid")
        self.restore_file("/var/log/wtmp")
        home_dirs = m.execute("ls /home").strip().split()

        def cleanup_home_dirs():
            for d in m.execute("ls /home").strip().split():
                if d not in home_dirs:
                    m.execute("rm -r /home/" + d)
        self.addCleanup(cleanup_home_dirs)

        if m.image == "arch":
            # arch configures pam_faillock by default
            self.addCleanup(m.execute, "rm -rf /run/faillock")

        # cockpit configuration
        self.restore_dir("/etc/cockpit")

        if not m.ostree_image:
            # for storage tests
            self.restore_file("/etc/fstab")
            self.restore_file("/etc/crypttab")

            # tests expect cockpit.service to not run at start; also, avoid log leakage into the next test
            self.addCleanup(m.execute, "systemctl stop --quiet cockpit")

        # The sssd daemon seems to get confused when we restore
        # backups of /etc/group etc and stops following updates to it.
        # Let's restart the daemon to reset that condition.
        m.execute("systemctl try-restart sssd || true")

        # reset scsi_debug (see e. g. StorageHelpers.add_ram_disk()
        # this needs to happen very late in the cleanup, so that test cases can clean up the users of that disk first
        # right after unmounting the device is often still busy, so retry a few times
        self.addCleanup(self.machine.execute,
                        "set -e; [ -e /sys/module/scsi_debug ] || exit 0; "
                        "for dev in $(ls /sys/bus/pseudo/drivers/scsi_debug/adapter*/host*/target*/*:*/block); do "
                        "    for s in /sys/block/*/slaves/${dev}*; do [ -e $s ] || break; "
                        "        d=/dev/$(dirname $(dirname ${s#/sys/block/})); "
                        "        while fuser --mount $d --kill; do sleep 0.1; done; "
                        "        umount $d || true; dmsetup remove --force $d || true; "
                        "    done; "
                        "    while fuser --mount /dev/$dev --kill; do sleep 0.1; done; "
                        "    umount /dev/$dev || true; "
                        "    swapon --show=NAME --noheadings | grep $dev | xargs -r swapoff; "
                        "done; until rmmod scsi_debug; do sleep 0.2; done", stdout=None)

        def terminate_sessions():
            # on OSTree we don't get "web console" sessions with the cockpit/ws container; just SSH; but also, some tests start
            # admin sessions without Cockpit
            self.machine.execute("""for u in $(loginctl --no-legend list-users  | awk '{ if ($2 != "root") print $1 }'); do
                                        loginctl terminate-user $u 2>/dev/null || true
                                        loginctl kill-user $u 2>/dev/null || true
                                        pkill -9 -u $u || true
                                        while pgrep -u $u; do sleep 0.2; done
                                        while mountpoint -q /run/user/$u && ! umount /run/user/$u; do sleep 0.2; done
                                        rm -rf /run/user/$u
                                    done""")

            # Terminate all other Cockpit sessions
            sessions = self.machine.execute("loginctl --no-legend list-sessions | awk '/web console/ { print $1 }'").strip().split()
            for s in sessions:
                # Don't insist that terminating works, the session might be gone by now.
                self.machine.execute(f"loginctl kill-session {s} || true; loginctl terminate-session {s} || true")

            # Restart logind to mop up empty "closing" sessions
            self.machine.execute("systemctl stop systemd-logind")

            # Wait for sessions to be gone
            sessions = self.machine.execute("loginctl --no-legend list-sessions | awk '/web console/ { print $1 }'").strip().split()
            for s in sessions:
                try:
                    m.execute(f"while loginctl show-session {s}; do sleep 0.2; done", timeout=30)
                except RuntimeError:
                    # show the status in debug logs, to see what's wrong
                    m.execute(f"loginctl session-status {s}; systemd-cgls", stdout=None)
                    raise

            # terminate all systemd user services for users who are not logged in
            self.machine.execute("systemctl stop user@*.service")

            # Clean up "closing" sessions again, and clean user id cache for non-system users
            self.machine.execute("systemctl stop systemd-logind; cd /run/systemd/users/; "
                                 "for f in $(ls); do [ $f -le 500 ] || rm $f; done")

        self.addCleanup(terminate_sessions)

    def tearDown(self):
        error = self.getError()

        if error:
            print(error, file=sys.stderr)
            try:
                self.snapshot("FAIL")
                self.copy_js_log("FAIL")
                self.copy_journal("FAIL")
                self.copy_cores("FAIL")
            except (OSError, RuntimeError):
                # failures in these debug artifacts should not skip cleanup actions
                sys.stderr.write("Failed to generate debug artifact:\n")
                traceback.print_exc(file=sys.stderr)

            if opts.sit:
                sit(self.machines)

        if self.browser:
            self.browser.write_coverage_data()

        if self.machine.ssh_reachable:
            self.check_journal_messages()
            if not error:
                self.check_browser_errors()
                self.check_pixel_tests()

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def login_and_go(self, path: Optional[str] = None, user: Optional[str] = None, host: Optional[str] = None,
                     superuser: bool = True, urlroot: Optional[str] = None, tls: bool = False,
                     enable_root_login: bool = False):
        if enable_root_login:
            self.enable_root_login()
        self.machine.start_cockpit(tls=tls)
        # first load after starting cockpit tends to take longer, due to on-demand service start
        with self.browser.wait_timeout(30):
            self.browser.login_and_go(path, user=user, host=host, superuser=superuser, urlroot=urlroot, tls=tls)

    def start_machine_troubleshoot(self, new=False, known_host=False, password=None, expect_closed_dialog=True, browser=None):
        b = browser or self.browser

        b.click('#machine-troubleshoot')

        b.wait_visible('#hosts_setup_server_dialog')
        if new:
            b.click('#hosts_setup_server_dialog button:contains(Add)')
            if not known_host:
                b.wait_in_text('#hosts_setup_server_dialog', "You are connecting to")
                b.wait_in_text('#hosts_setup_server_dialog', "for the first time.")
                b.click("#hosts_setup_server_dialog button:contains('Trust and add host')")
        if password:
            b.wait_in_text('#hosts_setup_server_dialog', "Unable to log in")
            b.set_input_text('#login-custom-password', password)
            b.click('#hosts_setup_server_dialog button:contains(Log in)')
        if expect_closed_dialog:
            b.wait_not_present('#hosts_setup_server_dialog')

    def add_machine(self, address, known_host=False, password="foobar", browser=None):
        b = browser or self.browser
        b.switch_to_top()
        b.go(f"/@{address}")
        self.start_machine_troubleshoot(new=True, known_host=known_host, password=password, browser=browser)
        b.enter_page("/system", host=address)

    # List of allowed journal messages during tests; these need to match the *entire* message
    default_allowed_messages = [
        # Reauth stuff
        '.*Reauthorizing unix-user:.*',
        '.*user .* was reauthorized.*',

        # Happens when the user logs out during reauthorization
        "Error executing command as another user: Not authorized",
        "This incident has been reported.",

        # Reboots are ok
        "-- Reboot --",

        # Sometimes D-Bus goes away before us during shutdown
        "Lost the name com.redhat.Cockpit on the session message bus",
        "GLib-GIO:ERROR:gdbusobjectmanagerserver\\.c:.*:g_dbus_object_manager_server_emit_interfaces_.*: assertion failed \\(error == NULL\\): The connection is closed \\(g-io-error-quark, 18\\)",
        "Error sending message: The connection is closed",

        # PAM noise
        "cockpit-session: pam: Creating directory .*",
        "cockpit-session: pam: Changing password for .*",

        # btmp tracking
        "cockpit-session: pam: Last failed login:.*",
        "cockpit-session: pam: There .* failed login attempts? since the last successful login.",

        # pam_lastlog complaints
        ".*/var/log/lastlog: No such file or directory",

        # ssh messages may be dropped when closing
        '10.*: dropping message while waiting for child to exit',

        # pkg/packagekit/autoupdates.jsx backend check often gets interrupted by logout
        "xargs: basename: terminated by signal 13",

        # SELinux messages to ignore
        "(audit: )?type=1403 audit.*",
        "(audit: )?type=1404 audit.*",
        "(audit: )?type=1405 audit.*",

        # apparmor loading
        "(audit: )?type=1400.*apparmor=\"STATUS\".*",

        # apparmor noise
        "(audit: )?type=1400.*apparmor=\"ALLOWED\".*",

        # Messages from systemd libraries when they are in debug mode
        'Successfully loaded SELinux database in.*',
        'calling: info',
        'Sent message type=method_call sender=.*',
        'Got message type=method_return sender=.*',

        # Various operating systems see this from time to time
        "Journal file.*truncated, ignoring file.",

        # our core dump retrieval is not entirely reliable
        "Failed to send coredump datagram:.*",

        # Something crashed, but we don't have more info. Don't fail on that
        "Failed to get (COMM|EXE).*: No such process",

        # several tests change the host name
        "sudo: unable to resolve host.*",

        # The usual sudo finger wagging
        "We trust you have received the usual lecture from the local System",
        "Administrator. It usually boils down to these three things:",
        r"#1\) Respect the privacy of others.",
        r"#2\) Think before you type.",
        r"#3\) With great power comes great responsibility.",
        "For security reasons, the password you type will not be visible",

        # starting out with empty PCP logs and pmlogger not running causes these metrics channel messages
        "(direct|pcp-archive): no such metric: .*: Unknown metric name",
        "(direct|pcp-archive): instance name lookup failed:.*",
        "(direct|pcp-archive): couldn't create pcp archive context for.*",

        # timedatex.service shuts down after timeout, runs into race condition with property watching
        ".*org.freedesktop.timedate1: couldn't get all properties.*Error:org.freedesktop.DBus.Error.NoReply.*",

        # https://github.com/cockpit-project/cockpit/issues/19235
        "invalid non-UTF8 @data passed as text to web_socket_connection_send.*",
    ]

    default_allowed_messages += os.environ.get("TEST_ALLOW_JOURNAL_MESSAGES", "").split(",")

    # List of allowed console.error() messages during tests; these match substrings
    default_allowed_console_errors = [
        # HACK: These should be fixed, but debugging these is not trivial, and the impact is very low
        "Warning: .* setState.*on an unmounted component",
        "Warning: Can't perform a React state update on an unmounted component",
        "Warning: Cannot update a component.*while rendering a different component",
        "Warning: A component is changing an uncontrolled input to be controlled",
        "Warning: A component is changing a controlled input to be uncontrolled",
        "Warning: Can't call.*on a component that is not yet mounted. This is a no-op",
        "Warning: Cannot update during an existing state transition",
        r"Warning: You are calling ReactDOMClient.createRoot\(\) on a container that has already been passed to createRoot",

        # FIXME: PatternFly complains about these, but https://www.a11y-collective.com/blog/the-first-rule-for-using-aria/
        # and https://www.accessibility-developer-guide.com/knowledge/aria/bad-practices/
        "aria-label",

        # PackageKit crashes a lot; let that not be the sole reason for failing a test
        "error: Could not determine kpatch packages:.*PackageKit crashed",
    ]

    if testvm.DEFAULT_IMAGE.startswith('rhel-8') or testvm.DEFAULT_IMAGE.startswith('centos-8'):
        # old occasional bugs in tracer, don't happen in newer versions any more
        default_allowed_console_errors.append('Tracer failed:.*Traceback')

    env_allow = os.environ.get("TEST_ALLOW_BROWSER_ERRORS")
    if env_allow:
        default_allowed_console_errors += env_allow.split(",")

    def allow_journal_messages(self, *patterns: str):
        """Don't fail if the journal contains a entry completely matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_hostkey_messages(self):
        self.allow_journal_messages('.*: .* host key for server is not known: .*',
                                    '.*: refusing to connect to unknown host: .*',
                                    '.*: .* host key for server has changed to: .*',
                                    '.*: host key for this server changed key type: .*',
                                    '.*: failed to retrieve resource: hostkey-unknown')

    def allow_restart_journal_messages(self):
        self.allow_journal_messages(".*Connection reset by peer.*",
                                    "connection unexpectedly closed by peer",
                                    ".*Broken pipe.*",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Underlying GIOStream returned 0 bytes on an async read \\(g-io-error-quark, 0\\). Exiting.",
                                    "cockpit-session: .*timed out.*",
                                    "ignoring failure from session process:.*",
                                    "peer did not close io when expected",
                                    "request timed out, closing",
                                    "PolicyKit daemon disconnected from the bus.",
                                    ".*couldn't create polkit session subject: No session for pid.*",
                                    "We are no longer a registered authentication agent.",
                                    ".*: failed to retrieve resource: terminated",
                                    ".*: external channel failed: (terminated|protocol-error)",
                                    'audit:.*denied.*comm="systemd-user-se".*nologin.*',
                                    ".*No session for cookie",

                                    'localhost: dropping message while waiting for child to exit',
                                    '.*: GDBus.Error:org.freedesktop.PolicyKit1.Error.Failed: .*',
                                    '.*g_dbus_connection_call_finish_internal.*G_IS_DBUS_CONNECTION.*',
                                    '.*Message recipient disconnected from message bus without replying.*',
                                    '.*Unable to shutdown socket: Transport endpoint is not connected.*',

                                    # If restarts or reloads happen really fast, the code in python.js
                                    # that figures out which python to use crashes with SIGPIPE,
                                    # and this is the resulting message
                                    'which: no python in .*'
                                    )

    def check_journal_messages(self, machine=None):
        """Check for unexpected journal entries."""
        machine = machine or self.machine
        # on main machine, only consider journal entries since test case start
        cursor = self.journal_start if machine == self.machine else None

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead.

        matches = [
            "SYSLOG_IDENTIFIER=cockpit-ws",
            "SYSLOG_IDENTIFIER=cockpit-bridge",
            "SYSLOG_IDENTIFIER=cockpit/ssh",
            # also catch GLIB_DOMAIN=<library> which apply to cockpit-ws (but not to -bridge, too much random noise)
            "_COMM=cockpit-ws",
            "GLIB_DOMAIN=cockpit-ws",
            "GLIB_DOMAIN=cockpit-bridge",
            "GLIB_DOMAIN=cockpit-ssh",
            "GLIB_DOMAIN=cockpit-pcp"
        ]

        if not self.allow_core_dumps:
            matches += ["SYSLOG_IDENTIFIER=systemd-coredump"]
            self.allowed_messages.append("Resource limits disable core dumping for process.*")
            # can happen on shutdown when /run/systemd/coredump is gone already
            self.allowed_messages.append("Failed to connect to coredump service: No such file or directory")
            self.allowed_messages.append("Failed to connect to coredump service: Connection refused")

        messages = machine.journal_messages(matches, 6, cursor=cursor)

        if "TEST_AUDIT_NO_SELINUX" not in os.environ:
            messages += machine.audit_messages("14", cursor=cursor)  # 14xx is selinux

        self.allowed_messages += self.machine.allowed_messages()

        all_found = True
        first = None
        for m in messages:
            # remove leading/trailing whitespace
            m = m.strip()
            # Ignore empty lines
            if not m:
                continue
            found = False

            # When coredump could not be generated, we cannot do much with info about there being a coredump
            # Ignore this message and all subsequent core dumps
            # If there is more than just one line about coredump, it will fail and show this messages
            if m.startswith("Failed to generate stack trace"):
                self.allowed_messages.append("Process .* of user .* dumped core.*")
                continue

            for p in self.allowed_messages:
                match = re.match(p, m)
                if match and match.group(0) == m:
                    found = True
                    break
            if not found:
                all_found = False
                if not first:
                    first = m
                print(m)
        if not all_found:
            self.copy_js_log("FAIL")
            self.copy_journal("FAIL")
            self.copy_cores("FAIL")
            if not self.getError():
                # fail test on the unexpected messages
                raise Error(UNEXPECTED_MESSAGE + "journal messages:\n" + first)

    def allow_browser_errors(self, *patterns):
        """Don't fail if the test caused a console error contains the given regexp"""
        for p in patterns:
            self.allowed_console_errors.append(p)

    def check_browser_errors(self):
        if not self.browser:
            return
        for log in self.browser.get_js_log():
            if not log.startswith("error: "):
                continue
            # errors are fatal in general; they need to be explicitly whitelisted
            for p in self.allowed_console_errors:
                if re.search(p, log):
                    break
            else:
                raise Error(UNEXPECTED_MESSAGE + "browser errors:\n" + log)

        self.browser.assert_no_oops()

    def check_pixel_tests(self):
        if self.browser:
            self.browser.assert_no_unused_pixel_test_references()
            if self.browser.failed_pixel_tests > 0:
                raise Error(PIXEL_TEST_MESSAGE)

    def snapshot(self, title: str, label: Optional[str] = None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.browser is not None:
            try:
                self.browser.snapshot(title, label)
            except RuntimeError:
                # this usually runs in exception handlers; raising an exception here skips cleanup handlers, so don't
                sys.stderr.write("Unexpected exception in snapshot():\n")
                sys.stderr.write(traceback.format_exc())

    def copy_js_log(self, title, label=None):
        if self.browser is not None:
            try:
                self.browser.copy_js_log(title, label)
            except RuntimeError:
                # this usually runs in exception handlers; raising an exception here skips cleanup handlers, so don't
                sys.stderr.write("Unexpected exception in copy_js_log():\n")
                sys.stderr.write(traceback.format_exc())

    def copy_journal(self, title: str, label: Optional[str] = None):
        for _, m in self.machines.items():
            if m.ssh_reachable:
                log = unique_filename("%s-%s-%s" % (label or self.label(), m.label, title), "log.gz")
                with open(log, "w") as fp:
                    m.execute("journalctl|gzip", stdout=fp)
                    print("Journal extracted to %s" % (log))
                    attach(log, move=True)

    def copy_cores(self, title: str, label: Optional[str] = None):
        if self.allow_core_dumps:
            return
        for _, m in self.machines.items():
            if m.ssh_reachable:
                directory = "%s-%s-%s.core" % (label or self.label(), m.label, title)
                dest = os.path.abspath(directory)
                # overwrite core dumps from previous retries
                if os.path.exists(dest):
                    shutil.rmtree(dest)
                m.download_dir("/var/lib/systemd/coredump", dest)
                try:
                    os.rmdir(dest)
                except OSError as ex:
                    if ex.errno == errno.ENOTEMPTY:
                        print("Core dumps downloaded to %s" % (dest))
                        # Enable this to temporarily(!) create artifacts for core dumps, if a crash is hard to reproduce
                        # attach(dest, move=True)

    def settle_cpu(self):
        """Wait until CPU usage in the VM settles down

        Wait until the process with the highest CPU usage drops below 20%
        usage. Wait for up to a minute, then return. There is no error if the
        CPU stays busy, as usually a test then should just try to run anyway.
        """
        for _ in range(20):
            # get the CPU percentage of the most busy process
            busy_proc = self.machine.execute("ps --no-headers -eo pcpu,pid,args | sort -k 1 -n -r | head -n1")
            if float(busy_proc.split()[0]) < 20.0:
                break
            time.sleep(3)

    def sed_file(self, expr: str, path: str, apply_change_action: Optional[str] = None):
        """sed a file on primary machine

        This is safe for @nondestructive tests, the file will be restored during cleanup.

        The optional apply_change_action will be run both after sedding and after restoring the file.
        """
        m = self.machine
        m.execute(f"sed -i.cockpittest '{expr}' {path}")
        if apply_change_action:
            m.execute(apply_change_action)

        if self.is_nondestructive():
            if apply_change_action:
                self.addCleanup(m.execute, apply_change_action)
            self.addCleanup(m.execute, f"mv {path}.cockpittest {path}")

    def file_exists(self, path: str) -> bool:
        """Check if file exists on test machine"""

        return self.machine.execute(f"if test -e {path}; then echo yes; fi").strip() != ""

    def restore_dir(self, path: str, post_restore_action: Optional[str] = None, reboot_safe: bool = False,
                    restart_unit: Optional[str] = None):
        """Backup/restore a directory for a nondestructive test

        This takes care to not ever touch the original content on disk, but uses transient overlays.
        As this uses a bind mount, it does not work for files that get changed atomically (with mv);
        use restore_file() for these.

        `restart_unit` will be stopped before restoring path, and restarted afterwards if it was running.
        The optional post_restore_action will run after restoring the original content.

        If the directory needs to survive reboot, `reboot_safe=True` needs to be specified; then this
        will just backup/restore the directory instead of bind-mounting, which is less robust.
        """
        if not self.is_nondestructive() and not self.machine.ostree_image:
            return  # skip for efficiency reasons

        exe = self.machine.execute

        if not self.file_exists(path):
            self.addCleanup(exe, f"rm -rf '{path}'")
            return

        backup = os.path.join(self.vm_tmpdir, path.replace('/', '_'))
        exe(f"mkdir -p {self.vm_tmpdir}; cp -a {path}/ {backup}/")

        if not reboot_safe:
            exe(f"mount -o bind {backup} {path}")

        if restart_unit:
            restart_stamp = f"/run/cockpit_restart_{restart_unit}"
            self.addCleanup(
                exe,
                f"if [ -e {restart_stamp} ]; then systemctl start {restart_unit}; rm {restart_stamp}; fi"
            )

        if post_restore_action:
            self.addCleanup(exe, post_restore_action)

        if reboot_safe:
            self.addCleanup(exe, f"rm -rf {path}; mv {backup} {path}")
        else:
            # HACK: a lot of tests call this on /home/...; that restoration happens before killing all user
            # processes in nonDestructiveSetup(), so we have to do it lazily
            if path.startswith("/home"):
                cmd = f"umount -lf {path}"
            else:
                cmd = f"umount {path} || {{ fuser -uvk {path} {path}/* >&2 || true; sleep 1; umount {path}; }}"
            self.addCleanup(exe, cmd)

        if restart_unit:
            self.addCleanup(exe, f"if systemctl --quiet is-active {restart_unit}; then touch {restart_stamp}; fi; "
                            f"systemctl stop {restart_unit}")

    def restore_file(self, path: str, post_restore_action: Optional[str] = None):
        """Backup/restore a file for a nondestructive test

        This is less robust than restore_dir(), but works for files that need to get changed atomically.

        If path does not currently exist, it will be removed again on cleanup.
        """
        if not self.is_nondestructive():
            return  # skip for efficiency reasons

        if post_restore_action:
            self.addCleanup(self.machine.execute, post_restore_action)

        if self.file_exists(path):
            backup = os.path.join(self.vm_tmpdir, path.replace('/', '_'))
            self.machine.execute(f"mkdir -p {self.vm_tmpdir}; cp -a {path} {backup}")
            self.addCleanup(self.machine.execute, f"mv {backup} {path}")
        else:
            self.addCleanup(self.machine.execute, f"rm -f {path}")

    def write_file(self, path: str, content: str, append: bool = False, owner: Optional[str] = None, perm: Optional[str] = None,
                   post_restore_action: Optional[str] = None):
        """Write a file on primary machine

        This is safe for @nondestructive tests, the file will be removed during cleanup.

        If @append is True, append to existing file instead of replacing it.
        @owner is the desired file owner as chown shell string (e.g. "admin:nogroup")
        @perm is the desired file permission as chmod shell string (e.g. "0600")
        """
        m = self.machine
        self.restore_file(path, post_restore_action=post_restore_action)
        m.write(path, content, append=append, owner=owner, perm=perm)

    def enable_root_login(self):
        """Enable root login

        By default root login is disabled in cockpit, removing the root entry of /etc/cockpit/disallowed-users allows root to login.
        """

        # fedora-coreos runs cockpit-ws in a containter so does not install cockpit-ws on the host
        disallowed_conf = '/etc/cockpit/disallowed-users'
        if not self.machine.ostree_image and self.file_exists(disallowed_conf):
            self.sed_file('/root/d', disallowed_conf)

    def setup_provisioned_hosts(self, disable_preload: bool = False):
        """Setup provisioned hosts for testing

        This sets the hostname of all machines to the name given in the
        provision dictionary and optionally disabled preload.
        """
        for name, m in self.machines.items():
            m.execute(f"hostnamectl set-hostname {name}")
            if disable_preload:
                self.disable_preload("packagekit", "playground", "systemd", machine=m)

    def authorize_pubkey(self, machine, account, pubkey):
        machine.execute(f"a={account} d=/home/$a/.ssh; mkdir -p $d; chown $a:$a $d; chmod 700 $d")
        machine.write(f"/home/{account}/.ssh/authorized_keys", pubkey)
        machine.execute(f"a={account}; chown $a:$a /home/$a/.ssh/authorized_keys")

    def get_pubkey(self, machine, account):
        return machine.execute(f"cat /home/{account}/.ssh/id_rsa.pub")

    def setup_ssh_auth(self):
        self.machine.execute("d=/home/admin/.ssh; mkdir -p $d; chown admin:admin $d; chmod 700 $d")
        self.machine.execute("test -f /home/admin/.ssh/id_rsa || ssh-keygen -f /home/admin/.ssh/id_rsa -t rsa -N ''")
        self.machine.execute("chown admin:admin /home/admin/.ssh/id_rsa*")
        pubkey = self.get_pubkey(self.machine, "admin")

        for m in self.machines:
            self.authorize_pubkey(self.machines[m], "admin", pubkey)


###########################
# Global helper functions
#


def jsquote(js: str) -> str:
    return json.dumps(js)


def get_decorator(method, _class, name, default=None):
    """Get decorator value of a test method or its class

    Return None if the decorator was not set.
    """
    attr = "_testlib__" + name
    return getattr(method, attr, getattr(_class, attr, default))


###########################
# Test decorators
#

def skipBrowser(reason: str, *browsers: str):
    """Decorator for skipping a test on given browser(s)

    Skips a test for provided *reason* on *browsers*.
    """
    browser = os.environ.get("TEST_BROWSER", "chromium")
    if browser in browsers:
        return unittest.skip(f"{browser}: {reason}")
    return lambda testEntity: testEntity


def skipImage(reason: str, *images: str):
    """Decorator for skipping a test for given image(s)

    Skip a test for a provided *reason* for given *images*. These
    support Unix shell style patterns via fnmatch.fnmatch.

    Example: @skipImage("no btrfs support on RHEL", "rhel-*")
    """
    if any(fnmatch.fnmatch(testvm.DEFAULT_IMAGE, img) for img in images):
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def onlyImage(reason: str, *images: str):
    """Decorator to only run a test on given image(s)

    Only run this test on provided *images* for *reason*. These
    support Unix shell style patterns via fnmatch.fnmatch.
    """
    if not any(fnmatch.fnmatch(testvm.DEFAULT_IMAGE, arg) for arg in images):
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def skipOstree(reason: str):
    """Decorator for skipping a test on OSTree images

    Skip test for *reason* on OSTree images defined in OSTREE_IMAGES in bots/lib/constants.py.
    """
    if testvm.DEFAULT_IMAGE in OSTREE_IMAGES:
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def skipDistroPackage():
    """For tests which apply to BaseOS packages

    With that, tests can evolve with latest code, without constantly breaking them when
    running against older package versions in the -distropkg tests.
    """
    if 'distropkg' in testvm.DEFAULT_IMAGE:
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: Do not test BaseOS packages")
    return lambda testEntity: testEntity


def nondestructive(testEntity):
    """Tests decorated as nondestructive will all run against the same VM

    Can be used on test classes and individual test methods.
    """
    setattr(testEntity, '_testlib__nondestructive', True)
    return testEntity


def no_retry_when_changed(testEntity):
    """Tests decorated with no_retry_when_changed will only run once if they've been changed

    Tests that have been changed are expected to succeed 3 times, if the test
    takes a long time, this prevents timeouts. Can be used on test classes and
    individual methods.
    """
    setattr(testEntity, '_testlib__no_retry_when_changed', True)
    return testEntity


def todo(reason: str = ''):
    """Tests decorated with @todo are expected to fail.

    An optional reason can be given, and will appear in the TAP output if run
    via run-tests.
    """
    def wrapper(testEntity):
        setattr(testEntity, '_testlib__todo', reason)
        return testEntity
    return wrapper


def todoPybridge(reason: Optional[str] = None):
    if not reason:
        reason = 'still fails with python bridge'

    def wrap(test_method):
        @functools.wraps(test_method)
        def wrapped_test(self):
            is_pybridge = self.is_pybridge()
            try:
                test_method(self)
                if is_pybridge:
                    return self.fail(reason)
                return None
            # only accept our testlib Errors, plus RuntimeError for TestSuperuserDashboardOldMachine
            except (Error, RuntimeError):
                if is_pybridge:
                    traceback.print_exc()
                    return self.skipTest(reason)
                raise

        return wrapped_test

    return wrap


def todoPybridgeRHEL8(reason: Optional[str] = None):
    if testvm.DEFAULT_IMAGE.startswith('rhel-8') or testvm.DEFAULT_IMAGE.startswith('centos-8'):
        return todoPybridge(reason or 'known fail on el8 with python bridge')
    return lambda testEntity: testEntity


def timeout(seconds: int):
    """Change default test timeout of 600s, for long running tests

    Can be applied to an individual test method or the entire class. This only
    applies to test/common/run-tests, not to calling check-* directly.
    """
    def wrapper(testEntity):
        setattr(testEntity, '_testlib__timeout', seconds)
        return testEntity
    return wrapper


class TapRunner:
    def __init__(self, verbosity=1):
        self.verbosity = verbosity

    def runOne(self, test):
        result = unittest.TestResult()
        print('# ----------------------------------------------------------------------')
        print('#', test)
        try:
            unittest.TestSuite([test]).run(result)
        except KeyboardInterrupt:
            result.addError(test, sys.exc_info())
            return result
        except Exception:
            result.addError(test, sys.exc_info())
            sys.stderr.write(f"Unexpected exception while running {test}\n")
            sys.stderr.write(traceback.format_exc())
            return result
        else:
            result.printErrors()

        if result.skipped:
            print(f"# Result {test} skipped: {result.skipped[0][1]}")
        elif result.wasSuccessful():
            print(f"# Result {test} succeeded")
        else:
            for failure in result.failures:
                print(failure[1])
            for error in result.errors:
                print(error[1])
            print(f"# Result {test} failed")
        return result

    def run(self, testable):
        tests = []

        # The things to test
        def collapse(test, tests):
            if isinstance(test, unittest.TestCase):
                tests.append(test)
            else:
                for t in test:
                    collapse(t, tests)
        collapse(testable, tests)
        test_count = len(tests)

        # For statistics
        start = time.time()
        failures = 0
        skips = []
        while tests:
            # The next test to test
            test = tests.pop(0)
            result = self.runOne(test)
            if not result.wasSuccessful():
                failures += 1
            skips += result.skipped

        # Report on the results
        duration = int(time.time() - start)
        hostname = socket.gethostname().split(".")[0]
        details = f"[{duration}s on {hostname}]"

        MachineCase.kill_global_machine()

        # Return 77 if all tests were skipped
        if len(skips) == test_count:
            skips = ", ".join([f"{s[0]!s} {s[1]}" for s in skips])
            sys.stdout.write(f"# SKIP {skips}\n")
            return 77
        if failures:
            plural = "S" if failures > 1 else ""
            sys.stdout.write(f"# {failures} TEST{plural} FAILED {details}\n")
            return 1
        else:
            plural = "S" if test_count > 1 else ""
            sys.stdout.write(f"# {test_count} TEST{plural} PASSED {details}\n")
            return 0


def print_tests(tests):
    for test in tests:
        if isinstance(test, unittest.TestSuite):
            print_tests(test)
        elif isinstance(test, unittest.loader._FailedTest):
            name = test.id().replace("unittest.loader._FailedTest.", "")
            print(f"Error: '{name}' does not match a test", file=sys.stderr)
        else:
            print(test.id().replace("__main__.", ""))


def arg_parser(enable_sit=True):
    parser = argparse.ArgumentParser(description='Run Cockpit test(s)')
    parser.add_argument('-v', '--verbose', dest="verbosity", action='store_const',
                        const=2, help='Verbose output')
    parser.add_argument('-t', "--trace", dest='trace', action='store_true',
                        help='Trace machine boot and commands')
    parser.add_argument('-q', '--quiet', dest='verbosity', action='store_const',
                        const=0, help='Quiet output')
    if enable_sit:
        parser.add_argument('-s', "--sit", dest='sit', action='store_true',
                            help="Sit and wait after test failure")
    parser.add_argument('--nonet', dest="fetch", action="store_false",
                        help="Don't go online to download images or data")
    parser.add_argument('--enable-network', dest='enable_network', action='store_true',
                        help="Enable network access for tests")
    parser.add_argument('--coverage', action='store_true',
                        help="Collect code coverage data")
    parser.add_argument("-l", "--list", action="store_true", help="Print the list of tests that would be executed")
    # TMT compatibility, pass testnames as whitespace separated list
    parser.add_argument('tests', nargs='*', default=os.getenv("TEST_NAMES").split() if os.getenv("TEST_NAMES") else [])

    parser.set_defaults(verbosity=1, fetch=True)
    return parser


def test_main(options=None, suite=None, attachments=None, **kwargs):
    """
    Run all test cases, as indicated by arguments.

    If no arguments are given on the command line, all test cases are
    executed.  Otherwise only the given test cases are run.
    """

    global opts

    # Turn off python stdout buffering
    buf_arg = 0
    os.environ['PYTHONUNBUFFERED'] = '1'
    buf_arg = 1
    sys.stdout.flush()
    sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buf_arg)

    standalone = options is None
    parser = arg_parser()
    parser.add_argument('--machine', metavar="hostname[:port]", dest="address",
                        default=None, help="Run this test against an already running machine")
    parser.add_argument('--browser', metavar="hostname[:port]", dest="browser",
                        default=None, help="When using --machine, use this cockpit web address")

    if standalone:
        options = parser.parse_args()

    # Sit should always imply verbose
    if options.sit:
        options.verbosity = 2

    # Have to copy into opts due to python globals across modules
    for (key, value) in vars(options).items():
        setattr(opts, key, value)

    opts.address = getattr(opts, "address", None)
    opts.browser = getattr(opts, "browser", None)
    opts.attachments = os.environ.get("TEST_ATTACHMENTS", attachments)
    if opts.attachments:
        os.makedirs(opts.attachments, exist_ok=True)

    import __main__
    if len(opts.tests) > 0:
        if suite:
            parser.error("tests may not be specified when running a predefined test suite")
        suite = unittest.TestLoader().loadTestsFromNames(opts.tests, module=__main__)
    elif not suite:
        suite = unittest.TestLoader().loadTestsFromModule(__main__)

    if options.list:
        print_tests(suite)
        return 0

    attach(os.path.join(TEST_DIR, "common/pixeldiff.html"))
    attach(os.path.join(TEST_DIR, "common/link-patterns.json"))

    runner = TapRunner(verbosity=opts.verbosity)
    ret = runner.run(suite)
    if not standalone:
        return ret
    sys.exit(ret)


class Error(Exception):
    def __init__(self, msg):
        self.msg = msg

    def __str__(self):
        return self.msg


def wait(func: Callable, msg: Optional[str] = None, delay: int = 1, tries: int = 60):
    """Wait for FUNC to return something truthy, and return that.

    FUNC is called repeatedly until it returns a true value or until a
    timeout occurs.  In the latter case, a exception is raised that
    describes the situation.  The exception is either the last one
    thrown by FUNC, or includes MSG, or a default message.

    :param func: The function to call
    :param msg: A error message to use when the timeout occurs. Defaults
                to a generic message.
    :param delay: How long to wait between calls to FUNC, in seconds. (default 1)
    :param tries: How often to call FUNC.  (defaults 60)
    :raises Error: When a timeout occurs.
    """

    t = 0
    while t < tries:
        try:
            val = func()
            if val:
                return val
        except Exception:
            if t == tries - 1:
                raise
            else:
                pass
        t = t + 1
        sleep(delay)
    raise Error(msg or "Condition did not become true.")


def sit(machines=None):
    """
    Wait until the user confirms to continue.

    The current test case is suspended so that the user can inspect
    the browser.
    """

    for (_, machine) in (machines or {}).items():
        sys.stderr.write(machine.diagnose())
    print("Press RET to continue...")
    sys.stdin.readline()
