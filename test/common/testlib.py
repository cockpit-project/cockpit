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
# along with Cockpit; If not, see <https://www.gnu.org/licenses/>.

"""Tools for writing Cockpit test cases."""

import argparse
import asyncio
import base64
import contextlib
import errno
import fnmatch
import glob
import io
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import unittest
from collections.abc import Collection, Container, Coroutine, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any, Callable, ClassVar, Literal, TypedDict, TypeVar

import webdriver_bidi
from lcov import write_lcov
from lib.constants import OSTREE_IMAGES
from machine import testvm
from PIL import Image

_T = TypeVar('_T')
_FT = TypeVar("_FT", bound=Callable[..., Any])

JsonObject = dict[str, Any]

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
    'destructive',
    'no_retry_when_changed',
    'nondestructive',
    'onlyImage',
    'opts',
    'sit',
    'skipBrowser',
    'skipImage',
    'skipOstree',
    'test_main',
    'timeout',
    'todo',
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


# https://w3c.github.io/webdriver/#keyboard-actions for encoding key names
WEBDRIVER_KEYS = {
    "Backspace": "\uE003",
    "Tab": "\uE004",
    "Return": "\uE006",
    "Enter": "\uE007",
    "Shift": "\uE008",
    "Control": "\uE009",
    "Alt": "\uE00A",
    "Escape": "\uE00C",
    "Space": "\uE00D",
    "PageUp": "\uE00E",
    "PageDown": "\uE00F",
    "End": "\uE010",
    "Home": "\uE011",
    "ArrowLeft": "\uE012",
    "ArrowUp": "\uE013",
    "ArrowRight": "\uE014",
    "ArrowDown": "\uE015",
    "Insert": "\uE016",
    "Delete": "\uE017",
    "Meta": "\uE03D",
    "F2": "\uE032",
}


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

class BrowserLayout(TypedDict):
    name: str
    theme: Literal["light"] | Literal["dark"]
    shell_size: tuple[int, int]
    content_size: tuple[int, int]


default_layouts: Sequence[BrowserLayout] = (
    {
        "name": "desktop",
        "theme": "light",
        "shell_size": (1920, 1200),
        "content_size": (1680, 1130)
    },
    {
        "name": "medium",
        "theme": "light",
        "shell_size": (1280, 768),
        "content_size": (1040, 698)
    },
    {
        "name": "mobile",
        "theme": "light",
        "shell_size": (414, 1920),
        "content_size": (414, 1856)
    },
    {
        "name": "dark",
        "theme": "dark",
        "shell_size": (1920, 1200),
        "content_size": (1680, 1130)
    },
    {
        "name": "rtl",
        "theme": "light",
        "shell_size": (1920, 1200),
        "content_size": (1680, 1130)
    },
)


def attach(filename: str, move: bool = False) -> None:
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


def unique_filename(base: str, ext: str) -> str:
    for i in range(20):
        if i == 0:
            f = f"{base}.{ext}"
        else:
            f = f"{base}-{i}.{ext}"
        if not os.path.exists(f):
            return f
    return f"{base}.{ext}"


class Browser:
    driver: webdriver_bidi.WebdriverBidi
    browser: str
    layouts: Sequence[BrowserLayout]
    current_layout: BrowserLayout | None
    port: str | int

    def __init__(
        self,
        address: str,
        label: str,
        machine: 'MachineCase',
        pixels_label: str | None = None,
        coverage_label: str | None = None,
        port: int | str | None = None
    ) -> None:
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
        self.used_pixel_references = set[str]()
        self.coverage_label = coverage_label
        self.machine = machine

        # HACK: Tests which don't yet get along with real mouse clicks in Chromium
        # can opt into falling back to the old MouseEvent emulation; this is cheating, but fixing
        # all the tests at once is too much work. Remove this once all tests in all our projects
        # got fixed.
        self.chromium_fake_mouse = False

        headless = os.environ.get("TEST_SHOW_BROWSER", '0') == '0'
        self.browser = os.environ.get("TEST_BROWSER", "chromium")
        if self.browser == "chromium":
            self.driver = webdriver_bidi.ChromiumBidi(headless=headless)
        elif self.browser == "firefox":
            self.driver = webdriver_bidi.FirefoxBidi(headless=headless)
        else:
            raise ValueError(f"unknown browser {self.browser}")
        self.loop = asyncio.new_event_loop()
        self.bidi_thread = threading.Thread(target=self.asyncio_loop_thread, args=(self.loop,))
        self.bidi_thread.start()

        self.run_async(self.driver.start_session())

        if opts.trace:
            logging.basicConfig(level=logging.INFO)
            webdriver_bidi.log_command.setLevel(logging.INFO if opts.trace else logging.WARNING)
            # not appropriate for --trace, just enable for debugging low-level protocol with browser
            # webdriver_bidi.log_proto.setLevel(logging.DEBUG)

        test_functions = (Path(__file__).parent / "test-functions.js").read_text()
        # Don't redefine globals, this confuses Firefox
        test_functions = "if (window.ph_select) return; " + test_functions
        self.bidi("script.addPreloadScript", quiet=True, functionDeclaration=f"() => {{ {test_functions} }}")

        try:
            sizzle_js = (Path(__file__).parent.parent.parent / "node_modules/sizzle/dist/sizzle.js").read_text()
            # HACK: injecting sizzle fails on missing `document` in assert()
            sizzle_js = sizzle_js.replace('function assert( fn ) {',
                                          'function assert( fn ) { if (true) return true; else ')
            # HACK: sizzle tracks document and when we switch frames, it sees the old document
            # although we execute it in different context.
            sizzle_js = sizzle_js.replace('context = context || document;', 'context = context || window.document;')
            self.bidi("script.addPreloadScript", quiet=True, functionDeclaration=f"() => {{ {sizzle_js} }}")
        except FileNotFoundError:
            pass

        if coverage_label:
            self.cdp_command("Profiler.enable")
            self.cdp_command("Profiler.startPreciseCoverage", callCount=False, detailed=True)

        self.password = "foobar"
        self.timeout_factor = int(os.getenv("TEST_TIMEOUT_FACTOR", "1"))
        self.timeout = 15
        self.failed_pixel_tests = 0
        self.allow_oops = False
        try:
            with open(f'{TEST_DIR}/browser-layouts.json') as fp:
                self.layouts = json.load(fp)
        except FileNotFoundError:
            self.layouts = default_layouts
        self.current_layout = None

    def _is_running(self) -> bool:
        """True initially, false after calling .kill()"""

        return self.driver is not None and self.driver.bidi_session is not None

    def have_test_api(self) -> bool:
        """Check if the browser is running and has a Cockpit page

        I.e. are our test-functions.js available? This is only true after
        opening cockpit, not for the initial blank page (before login_and_go)
        or other URLs like Grafana.
        """
        if not self._is_running():
            return False
        return self.eval_js("!!window.ph_find")

    def run_async(self, coro: Coroutine[Any, Any, Any]) -> JsonObject:
        """Run coro in main loop in our BiDi thread

        Wait for the result and return it.
        """
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result()

    @staticmethod
    def asyncio_loop_thread(loop: asyncio.AbstractEventLoop) -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    def kill(self) -> None:
        if not self._is_running():
            return
        self.run_async(self.driver.close())
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.bidi_thread.join()

    def bidi(self, method: str, **params: Any) -> webdriver_bidi.JsonObject:
        """Send a Webdriver BiDi command and return the JSON response"""

        try:
            return self.run_async(self.driver.bidi(method, **params))
        except webdriver_bidi.WebdriverError as e:
            raise Error(str(e)) from None

    def cdp_command(self, method: str, **params: Any) -> webdriver_bidi.JsonObject:
        """Send a Chrome DevTools Protocol command and return the JSON response"""

        if self.browser == "chromium":
            assert isinstance(self.driver, webdriver_bidi.ChromiumBidi)
            reply = self.run_async(self.driver.cdp(method, **params))
            if 'error' in reply:
                raise Error(str(reply['error'])) from None
            return reply['result']
        else:
            raise webdriver_bidi.WebdriverError("CDP is only supported in Chromium")

    def open(self, href: str, cookie: Mapping[str, str] | None = None, tls: bool = False) -> None:
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
            c = {**cookie, "value": {"type": "string", "value": cookie["value"]}}
            self.bidi("storage.setCookie", cookie=c)

        self.switch_to_top()
        # Some browsers optimize this away if the current URL is already href
        # (e.g. in TestKeys.testAuthorizedKeys). Load the blank page first to always
        # force a load.
        self.bidi("browsingContext.navigate", context=self.driver.context, url="about:blank", wait="complete")
        self.bidi("browsingContext.navigate", context=self.driver.context, url=href, wait="complete")

    def set_user_agent(self, ua: str) -> None:
        """Set the user agent of the browser

        :param ua: user agent string
        :type ua: str
        """
        if self.browser == "chromium":
            self.cdp_command("Emulation.setUserAgentOverride", userAgent=ua)
        else:
            raise NotImplementedError

    def reload(self, ignore_cache: bool = False) -> None:
        """Reload the current page

        :param ignore_cache: if true browser cache is ignored (default False)
        :type ignore_cache: bool
        """

        self.switch_to_top()
        self.wait_js_cond("ph_select('iframe.container-frame').every(e => e.getAttribute('data-loaded'))")
        if self.browser == "firefox":
            if ignore_cache:
                webdriver_bidi.log_command.warning(
                    "Browser.reload(): ignore_cache==True not yet supported with Firefox, ignoring")
            self.bidi("browsingContext.reload", context=self.driver.context, wait="complete")
        else:
            self.bidi("browsingContext.reload", context=self.driver.context, ignoreCache=ignore_cache,
                      wait="complete")

        self.machine.allow_restart_journal_messages()

    def switch_to_frame(self, name: str | None) -> None:
        """Switch to frame in browser tab

        Each page has a main frame and can have multiple subframes, usually
        iframes.

        :param name: frame name
        """
        if name is None:
            self.switch_to_top()
        else:
            self.run_async(self.driver.switch_to_frame(name))

    def switch_to_top(self) -> None:
        """Switch to the main frame

        Switch to the main frame from for example an iframe.
        """
        self.driver.switch_to_top()

    def allow_download(self) -> None:
        """Allow browser downloads"""
        # this is only necessary for headless chromium
        if self.browser == "chromium":
            self.cdp_command("Browser.setDownloadBehavior", behavior="allow",
                             downloadPath=str(self.driver.download_dir))

    def upload_files(self, selector: str, files: Sequence[str]) -> None:
        """Upload a local file to the browser

        The selector should select the <input type="file"/> element.
        Files is a list of absolute paths to files which should be uploaded.
        """
        element = self.eval_js(f"ph_find({jsquote(selector)})")
        self.bidi("input.setFiles", context=self.driver.context, element=element, files=files)

    def eval_js(self, code: str, no_trace: bool = False) -> Any:
        """Execute JS code that returns something

        :param code: a string containing JavaScript code
        :param no_trace: do not print information about unknown return values (default False)
        """
        return self.bidi("script.evaluate", expression=code, quiet=no_trace,
                         awaitPromise=True, target={"context": self.driver.context})["result"]

    def call_js_func(self, func: str, *args: object) -> Any:
        """Call a JavaScript function

        :param func: JavaScript function to call
        :param args: arguments for the JavaScript function
        """
        return self.eval_js("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def set_mock(self, mock: Mapping[str, str], base: str = "") -> None:
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

    def cookie(self, name: str) -> Mapping[str, object] | None:
        """Retrieve a browser cookie by name

        :param name: the name of the cookie
        :type name: str
        """
        cookies = self.bidi("storage.getCookies", filter={"name": name})["cookies"]
        if len(cookies) > 0:
            c = cookies[0]
            # if we ever need to handle "base64", add that
            assert c["value"]["type"] == "string"
            c["value"] = c["value"]["value"]
            return c
        return None

    def go(self, url_hash: str) -> None:
        self.call_js_func('ph_go', url_hash)

    def mouse(
        self,
        selector: str,
        event: str,
        x: int | None = None,
        y: int | None = None,
        btn: int = 0,
        *,
        ctrlKey: bool = False,
        shiftKey: bool = False,
        altKey: bool = False,
        metaKey: bool = False,
        scrollVisible: bool = True,
    ) -> None:
        """Do a mouse event in the browser.

        :param selector: the element to interact with
        :param type: click, dblclick, mousemove; you can also use "mouseenter" (alias for mousemove) or "mouseleave"
               (but this is just a heuristic by moving the mouse 500x500 pixels away; prefer moving to an explicit
               target)
        :param x, y: coordinates; when not given, default to center of element
        :param btn: mouse button to click https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
        :param crtlKey: press the ctrl key
        :param shiftKey: press the shift key
        :param altKey: press the alt key
        :param metaKey: press the meta key
        :param scrollVisible: set to False in rare cases where scrolling an element into view triggers side effects
        """
        self.wait_visible(selector)

        # TODO: x and y are not currently implemented: webdriver (0, 0) is the element's center, not top left corner
        # in these cases, use the old MouseEvent emulation
        if x is not None or y is not None or (self.browser == "chromium" and self.chromium_fake_mouse):
            self.call_js_func('ph_mouse', selector, event, x or 0, y or 0, btn, ctrlKey, shiftKey, altKey, metaKey)
            return

        # in the general case, use the BiDi API, which is more realistic -- it doesn't sidestep the browser
        ev_id = f"pointer-{self.driver.last_id}"

        def key(type_: str, name: str) -> JsonObject:
            return {"type": "key", "id": ev_id + type_, "actions": [{"type": type_, "value": WEBDRIVER_KEYS[name]}]}

        for _retry in range(3):
            element = self.call_js_func('ph_find_scroll_into_view' if scrollVisible else 'ph_find', selector)

            actions: list[JsonObject] = [
                {"type": "pointerMove", "x": 0, "y": 0, "origin": {"type": "element", "element": element}}
            ]
            down = {"type": "pointerDown", "button": btn}
            up = {"type": "pointerUp", "button": btn}
            if event == "click":
                actions.extend([down, up])
            elif event == "dblclick":
                actions.extend([down, up, down, up])
            elif event in ["mousemove", "mouseenter"]:
                pass
            elif event == "mouseleave":
                # move the mouse someplace else
                actions = [{"type": "pointerMove", "x": 500, "y": 500, "origin": "pointer"}]
            else:
                raise NotImplementedError(f"unknown event {event}")

            # modifier keys
            keys_pre: list[JsonObject] = []
            keys_post: list[JsonObject] = []

            if altKey:
                keys_pre.append(key("keyDown", "Alt"))
                keys_post.append(key("keyUp", "Alt"))
            if ctrlKey:
                keys_pre.append(key("keyDown", "Control"))
                keys_post.append(key("keyUp", "Control"))
            if shiftKey:
                keys_pre.append(key("keyDown", "Shift"))
                keys_post.append(key("keyUp", "Shift"))
            if metaKey:
                keys_pre.append(key("keyDown", "Meta"))
                keys_post.append(key("keyUp", "Meta"))

            # the actual mouse event
            actions = [{
                "id": ev_id,
                "type": "pointer",
                "parameters": {"pointerType": "mouse"},
                "actions": actions,
            }]

            try:
                self.bidi("input.performActions", context=self.driver.context, actions=keys_pre + actions + keys_post)
                break
            except Error as e:
                # race condition: if the page re-renders after the wait_visible() but before the mouse event,
                # the element might not be present anymore; retry then
                if "no such element" in str(e):
                    webdriver_bidi.log_command.warning(
                        "Browser.mouse(%r, %r): retrying after %s", selector, event, e.msg)
                    # retry, but don't scroll again
                    scrollVisible = False
                else:
                    raise

    def click(self, selector: str) -> None:
        """Click on a ui element

        :param selector: the selector to click on
        """
        self.mouse(selector + ":not([disabled]):not([aria-disabled=true])", "click")

    def val(self, selector: str) -> Any:
        """Get the value attribute of a selector.

        :param selector: the selector to get the value of
        """
        self.wait_visible(selector)
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector: str, val: object) -> None:
        """Set the value attribute of a non disabled DOM element.

        This also emits a change DOM change event.

        :param selector: the selector to set the value of
        :param val: the value to set
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector: str) -> str:
        """Get an element's textContent value.

        :param selector: the selector to get the value of
        """
        self.wait_visible(selector)
        return self.call_js_func('ph_text', selector) or ''

    def attr(self, selector: str, attr: str) -> Any:
        """Get the value of a given attribute of an element.

        :param selector: the selector to get the attribute of
        :param attr: the DOM element attribute
        """
        self._wait_present(selector)
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector: str, attr: str, val: object) -> None:
        """Set an attribute value of an element.

        :param selector: the selector
        :param attr: the element attribute
        :param val: the value of the attribute
        """
        self._wait_present(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_attr', selector, attr, val)

    def get_checked(self, selector: str) -> bool:
        """Get checked state of a given selector.

        :param selector: the selector
        :return: the checked state
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        return self.call_js_func('ph_get_checked', selector)

    def set_checked(self, selector: str, val: bool) -> None:
        """Set checked state of a given selector.

        :param selector: the selector
        :param val: boolean value to enable or disable checkbox
        """
        # avoid ph_set_checked, that doesn't use proper mouse emulation
        checked = self.get_checked(selector)
        if checked != val:
            self.click(selector)

    def focus(self, selector: str) -> None:
        """Set focus on selected element.

        :param selector: the selector
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_focus', selector)

    def blur(self, selector: str) -> None:
        """Remove keyboard focus from selected element.

        :param selector: the selector
        """
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_blur', selector)

    def input_text(self, text: str) -> None:
        actions: list[JsonObject] = []
        for c in text:
            # quality-of-life special case
            if c == '\n':
                c = WEBDRIVER_KEYS["Enter"]
            actions.append({"type": "keyDown", "value": c})
            actions.append({"type": "keyUp", "value": c})
        self.bidi("input.performActions", context=self.driver.context, actions=[
            {"type": "key", "id": "key-0", "actions": actions}])

    def key(self, name: str, repeat: int = 1, modifiers: list[str] | None = None) -> None:
        """Press and release a named keyboard key.

        Use this function to input special characters or modifiers.

        :param name: ASCII value or key name like "Enter", "Delete", or "ArrowLeft" (entry in WEBDRIVER_KEYS)
        :param repeat: number of times to repeat this key (default 1)
        :param modifiers: "Shift", "Control", "Alt"
        """
        actions: list[JsonObject] = []
        actions_pre: list[JsonObject] = []
        actions_post: list[JsonObject] = []
        keycode = WEBDRIVER_KEYS.get(name, name)

        for m in (modifiers or []):
            actions_pre.append({"type": "keyDown", "value": WEBDRIVER_KEYS[m]})
            actions_post.append({"type": "keyUp", "value": WEBDRIVER_KEYS[m]})

        for _ in range(repeat):
            actions.append({"type": "keyDown", "value": keycode})
            actions.append({"type": "keyUp", "value": keycode})

        self.bidi("input.performActions", context=self.driver.context, actions=[
            {"type": "key", "id": "key-0", "actions": actions_pre + actions + actions_post}])

    def select_from_dropdown(self, selector: str, value: object) -> None:
        """For an actual <select> HTML component"""

        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        text_selector = f"{selector} option[value='{value}']"
        self._wait_present(text_selector)
        self.set_val(selector, value)
        self.wait_val(selector, value)

    def select_PF(self, selector: str, value: str, menu_class: str = ".pf-v6-c-menu") -> None:
        """For a PatternFly Select-like component

        For things like <Select> or <TimePicker>. Unfortunately none of them render as an actual <select>, but a
        <button> or <div> with a detached menu div (which can even be in the parent).

        For similar components like the deprecated <Select> you can specify a different menu class.
        """
        self.click(selector)
        # SelectOption's value does not render to an actual "value" attribute, just a <li> text
        self.click(f"{menu_class} button:contains('{value}')")
        self.wait_not_present(menu_class)

    def click_button(self, compid: str, prefix: str = "", component: str = "PF6/Button") -> None:
        """Click on a button identified by its OUIA component id."""
        self.click(f'{prefix} [data-ouia-component-type="{component}"][data-ouia-component-id="{compid}"]')

    def set_input_text(
        self, selector: str, val: str, append: bool = False, value_check: bool = True, blur: bool = True
    ) -> None:
        self.focus(selector)
        if not append:
            self.key("a", modifiers=["Control"])
        if val == "":
            self.key("Backspace")
        else:
            self.input_text(val)
        if blur:
            self.blur(selector)

        if value_check:
            self.wait_val(selector, val)

    def set_file_autocomplete_val(self, group_identifier: str, location: str) -> None:
        self.set_input_text(f"{group_identifier} .pf-v6-c-menu-toggle input", location)
        # select the file
        self.wait_text(".pf-v6-c-menu ul li:nth-child(1) button", location)
        self.click(".pf-v6-c-menu ul li:nth-child(1) button")
        self.wait_not_present(".pf-v6-c-menu")
        self.wait_val(f"{group_identifier} .pf-v6-c-menu-toggle input", location)

    @contextlib.contextmanager
    def wait_timeout(self, timeout: int) -> Iterator[None]:
        old_timeout = self.timeout
        self.timeout = timeout
        yield
        self.timeout = old_timeout

    def wait(self, predicate: Callable[[], _T | None]) -> _T:
        for _ in range(self.timeout * self.timeout_factor * 5):
            val = predicate()
            if val:
                return val
            time.sleep(0.2)
        raise Error('timed out waiting for predicate to become true')

    def wait_js_cond(self, cond: str, error_description: str = "null") -> None:
        timeout = self.timeout * self.timeout_factor
        start = time.time()
        last_error = None
        for _retry in range(5):
            try:
                self.bidi("script.evaluate",
                          expression=f"ph_wait_cond(() => {cond}, {timeout * 1000}, {error_description})",
                          awaitPromise=True, timeout=timeout + 5, target={"context": self.driver.context})

                duration = time.time() - start
                percent = int(duration / timeout * 100)
                if percent >= 50:
                    print(f"WARNING: Waiting for {cond} took {duration:.1f} seconds, "
                          f"which is {percent}% of the timeout.")
                return
            except Error as e:
                last_error = e

                # can happen when waiting across page reloads
                if any(pattern in str(e) for pattern in [
                    # during page loading
                    "is not a function",
                    # chromium
                    "Execution context was destroyed",
                    "Cannot find context",
                    # firefox
                    "MessageHandlerFrame' destroyed",
                    # page helpers not yet loaded
                    "ph_wait_cond is not defined",
                   ]):
                    if time.time() - start < timeout:
                        webdriver_bidi.log_command.info("wait_js_cond: Ignoring/retrying %r", e)
                        time.sleep(1)
                        continue

                break

        assert last_error
        # rewrite exception to have more context, also for compatibility with existing naughties
        raise Error(f"timeout\nwait_js_cond({cond}): {last_error.msg}") from None

    def wait_js_func(self, func: str, *args: object) -> None:
        self.wait_js_cond("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def is_present(self, selector: str) -> bool:
        return self.call_js_func('ph_is_present', selector)

    def _wait_present(self, selector: str) -> None:
        self.wait_js_func('ph_is_present', selector)

    def wait_not_present(self, selector: str) -> None:
        self.wait_js_func('!ph_is_present', selector)

    def is_visible(self, selector: str) -> bool:
        return self.call_js_func('ph_is_visible', selector)

    def wait_visible(self, selector: str) -> None:
        self._wait_present(selector)
        self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector: str, val: object) -> None:
        self.wait_visible(selector)
        self.wait_js_func('ph_has_val', selector, val)

    def wait_not_val(self, selector: str, val: str) -> None:
        self.wait_visible(selector)
        self.wait_js_func('!ph_has_val', selector, val)

    def wait_attr(self, selector: str, attr: str, val: object) -> None:
        self._wait_present(selector)
        self.wait_js_func('ph_has_attr', selector, attr, val)

    def wait_attr_contains(self, selector: str, attr: str, val: str) -> None:
        self._wait_present(selector)
        self.wait_js_func('ph_attr_contains', selector, attr, val)

    def wait_attr_not_contains(self, selector: str, attr: str, val: object) -> None:
        self._wait_present(selector)
        self.wait_js_func('!ph_attr_contains', selector, attr, val)

    def wait_not_attr(self, selector: str, attr: str, val: object) -> None:
        self._wait_present(selector)
        self.wait_js_func('!ph_has_attr', selector, attr, val)

    def wait_not_visible(self, selector: str) -> None:
        self.wait_js_func('!ph_is_visible', selector)

    def wait_in_text(self, selector: str, text: str) -> None:
        self.wait_visible(selector)
        self.wait_js_cond("ph_in_text(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_not_in_text(self, selector: str, text: str) -> None:
        self.wait_visible(selector)
        self.wait_js_func('!ph_in_text', selector, text)

    def wait_collected_text(self, selector: str, text: str) -> None:
        self.wait_js_func('ph_collected_text_is', selector, text)

    def wait_text(self, selector: str, text: str) -> None:
        self.wait_visible(selector)
        self.wait_js_cond("ph_text_is(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_text_not(self, selector: str, text: str) -> None:
        self.wait_visible(selector)
        self.wait_js_func('!ph_text_is', selector, text)

    def wait_text_matches(self, selector: str, pattern: str) -> None:
        self.wait_visible(selector)
        self.wait_js_func('ph_text_matches', selector, pattern)

    def wait_popup(self, elem_id: str) -> None:
        """Wait for a popup to open.

        :param id: the 'id' attribute of the popup.
        """
        self.wait_visible('#' + elem_id)

    def wait_language(self, lang: str) -> None:
        parts = lang.split("-")
        code_1 = parts[0]
        code_2 = parts[0]
        if len(parts) > 1:
            code_2 += "_" + parts[1].upper()
        self.wait_js_cond("cockpit.language == '%s' || cockpit.language == '%s'" % (code_1, code_2))

    def dialog_cancel(self, sel: str, button: str = "button[data-dismiss='modal']") -> None:
        self.click(sel + " " + button)
        self.wait_not_visible(sel)

    def enter_page(self, path: str, host: str | None = None, reconnect: bool = True) -> None:
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

        def wait_no_curtain() -> None:
            # Older shells make the curtain invisible, newer shells
            # remove it entirely. Let's cater to both.
            self.wait_js_cond('!ph_is_present(".curtains-ct") || !ph_is_visible(".curtains-ct")')

        while True:
            try:
                self._wait_present("iframe.container-frame[name='%s'][data-loaded]" % frame)
                wait_no_curtain()
                self.wait_visible("iframe.container-frame[name='%s']" % frame)
                break
            except Error as ex:
                if reconnect and ex.msg.startswith('timeout'):
                    reconnect = False
                    if self.is_present("#machine-reconnect"):
                        self.click("#machine-reconnect")
                        wait_no_curtain()
                        continue
                raise

        self.switch_to_frame(frame)
        self.wait_visible("body")

    def leave_page(self) -> None:
        self.switch_to_top()

    def try_login(
        self,
        user: str | None = None,
        password: str | None = None,
        *,
        superuser: bool | None = True,
        legacy_authorized: bool | None = None
    ) -> None:
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

    def login_and_go(
        self,
        path: str | None = None,
        *,
        user: str | None = None,
        host: str | None = None,
        superuser: bool | None = True,
        urlroot: str | None = None,
        tls: bool = False,
        password: str | None = None,
        legacy_authorized: bool | None = None
    ) -> None:
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

        self.try_login(user=user, password=password, superuser=superuser, legacy_authorized=legacy_authorized)

        self.wait_visible('#content')
        if path:
            self.enter_page(path.split("#")[0], host=host)

    def logout(self) -> None:
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
                # HACK: scrolling into view sometimes triggers TopNav's handleClickOutside() hack
                # we don't need it here, if the session menu is visible then so is the dropdown
                self.mouse('#logout', "click", scrollVisible=False)
            except RuntimeError as e:
                # logging out does destroy the current frame context, it races with the driver finishing the command
                if "Execution context was destroyed" not in str(e):
                    raise
        self.wait_visible('#login')

        self.machine.allow_restart_journal_messages()

    def relogin(
        self,
        path: str | None = None,
        user: str | None = None,
        *,
        password: str | None = None,
        superuser: bool | None = None,
        wait_remote_session_machine: testvm.Machine | None = None
    ) -> None:
        self.logout()
        if wait_remote_session_machine:
            wait_remote_session_machine.execute("while pgrep -af '[c]ockpit.beiboot'; do sleep 1; done")
        self.try_login(user=user, password=password, superuser=superuser)
        self.wait_visible('#content')
        if path:
            if path.startswith("/@"):
                host = path[2:].split("/")[0]
            else:
                host = None
            self.enter_page(path.split("#")[0], host=host)

    def open_session_menu(self) -> None:
        self.wait_visible("#toggle-menu")
        if (self.attr("#toggle-menu", "aria-expanded") != "true"):
            self.click("#toggle-menu")
            # Replace with "#toggle-menu-menu" when all our images have Cockpit > 317
            self.wait_visible("button.display-language-menu")

    def layout_is_mobile(self) -> bool:
        if not self.current_layout:
            return False
        return self.current_layout["shell_size"][0] < 420

    def open_superuser_dialog(self) -> None:
        if self.layout_is_mobile():
            self.open_session_menu()
            self.click("#super-user-indicator-mobile button")
        else:
            self.click("#super-user-indicator button")

    def check_superuser_indicator(self, expected: str) -> None:
        if self.layout_is_mobile():
            self.open_session_menu()
            self.wait_text("#super-user-indicator-mobile", expected)
            self.click("#toggle-menu")
        else:
            self.wait_text("#super-user-indicator", expected)

    def become_superuser(
        self,
        user: str | None = None,
        password: str | None = None,
        passwordless: bool | None = False
    ) -> None:
        with self.driver.restore_context():
            self.switch_to_top()
            self.open_superuser_dialog()

            # In (open)SUSE images, superuser access always requires the root password
            if user is None:
                user = "root" if "suse" in self.machine.image else "admin"

            if passwordless:
                self.wait_in_text("div[role=dialog]", "Administrative access")
                self.wait_in_text("div[role=dialog] .pf-v6-c-modal-box__body", "You now have administrative access.")
                # there should be only one ("Close") button
                self.click("div[role=dialog] .pf-v6-c-modal-box__footer button")
            else:
                self.wait_in_text("div[role=dialog]", "Switch to administrative access")
                self.wait_in_text("div[role=dialog]", f"Password for {user}:")
                self.set_input_text("div[role=dialog] input", password or "foobar")
                self.click("div[role=dialog] button.pf-m-primary")

            self.wait_not_present("div[role=dialog]")

            self.check_superuser_indicator("Administrative access")

    def drop_superuser(self) -> None:
        with self.driver.restore_context():
            self.switch_to_top()
            self.open_superuser_dialog()
            self.wait_in_text("div[role=dialog]", "Switch to limited access")
            self.click("div[role=dialog] button.pf-m-primary")
            self.wait_not_present("div[role=dialog]")
            self.check_superuser_indicator("Limited access")

    def click_system_menu(self, path: str, enter: bool = True) -> None:
        """Click on a "System" menu entry with given URL path

        Enters the given target frame afterwards, unless enter=False is given
        (useful for remote hosts).
        """
        self.switch_to_top()
        self.click(f"#host-apps a[href='{path}']")
        if enter:
            # strip off parameters after hash
            self.enter_page(path.split('#')[0].rstrip('/'))

    def get_pf_progress_value(self, progress_bar_sel: str) -> int:
        """Get numeric value of a PatternFly <ProgressBar> component"""
        sel = progress_bar_sel + " .pf-v6-c-progress__indicator"
        self.wait_visible(sel)
        self.wait_attr_contains(sel, "style", "width:")
        style = self.attr(sel, "style")
        m = re.search(r"width: (\d+)%;", style)
        assert m is not None
        return int(m.group(1))

    def start_machine_troubleshoot(
        self,
        new: bool = False,
        known_host: bool = False,
        password: str | None = None,
        expect_closed_dialog: bool = True,
        expect_warning: bool = True,
        expect_curtain: bool = True
    ) -> None:
        if expect_curtain:
            self.click('#machine-troubleshoot')

        if not new and expect_warning:
            self.wait_visible('#hosts_connect_server_dialog')
            self.click("#hosts_connect_server_dialog button.pf-m-warning")

        self.wait_visible('#hosts_setup_server_dialog')
        if new:
            self.wait_text("#hosts_setup_server_dialog button.pf-m-primary", "Add")
            self.click("#hosts_setup_server_dialog button.pf-m-primary")
            if expect_warning:
                self.wait_visible('#hosts_connect_server_dialog')
                self.click("#hosts_connect_server_dialog button.pf-m-warning")
            if not known_host:
                self.wait_in_text('#hosts_setup_server_dialog', "You are connecting to")
                self.wait_in_text('#hosts_setup_server_dialog', "for the first time.")
                self.wait_text("#hosts_setup_server_dialog button.pf-m-primary", "Trust and add host")
                self.click("#hosts_setup_server_dialog button.pf-m-primary")
        if password:
            self.wait_in_text('#hosts_setup_server_dialog', "Unable to log in")
            self.set_input_text('#login-custom-password', password)
            self.wait_text("#hosts_setup_server_dialog button.pf-m-primary", "Log in")
            self.click("#hosts_setup_server_dialog button.pf-m-primary")
        if expect_closed_dialog:
            self.wait_not_present('#hosts_setup_server_dialog')

    def add_machine(self, address: str, known_host: bool = False, password: str | None = "foobar",
                    expect_warning: bool = True) -> None:
        self.switch_to_top()
        self.go(f"/@{address}")
        self.start_machine_troubleshoot(new=True,
                                        known_host=known_host,
                                        password=password,
                                        expect_warning=expect_warning)
        self.enter_page("/system", host=address)

    def grant_permissions(self, *args: str) -> None:
        """Grant permissions to the browser"""

        # BiDi permission extension:
        # https://www.w3.org/TR/permissions/#automation-webdriver-bidi
        for perm in args:
            self.bidi("permissions.setPermission", descriptor={"name": perm}, state="granted",
                      origin=f"http://{self.address}:{self.port}")

    def snapshot(self, title: str, label: str | None = None) -> None:
        """Take a snapshot of the current screen and save it as a PNG and HTML.

        Arguments:
            title: Used for the filename.
        """
        if self._is_running():
            filename = unique_filename(f"{label or self.label}-{title}", "png")
            try:
                ret = self.bidi("browsingContext.captureScreenshot", quiet=True,
                                context=self.driver.top_context, origin="document")
                with open(filename, 'wb') as f:
                    f.write(base64.standard_b64decode(ret["data"]))
                attach(filename, move=True)
                print("Wrote screenshot to " + filename)
            except Error as e:
                print("Screenshot not available:", e)

            filename = unique_filename(f"{label or self.label}-{title}", "html")
            try:
                html = self.eval_js("document.documentElement.outerHTML", no_trace=True)
                with open(filename, 'wb') as f:
                    f.write(html.encode())
                attach(filename, move=True)
                print("Wrote HTML dump to " + filename)
            except Error as e:
                print("HTML dump not available:", e)

    def _set_window_size(self, width: int, height: int) -> None:
        self.bidi("browsingContext.setViewport", context=self.driver.top_context,
                  viewport={"width": width, "height": height})

    def _set_emulated_media_theme(self, name: str) -> None:
        # https://bugzilla.mozilla.org/show_bug.cgi?id=1549434
        if self.browser == "chromium":
            self.cdp_command("Emulation.setEmulatedMedia", features=[{'name': 'prefers-color-scheme', 'value': name}])

    def _set_direction(self, direction: str) -> None:
        with self.driver.restore_context():
            if self.is_present("#shell-page"):
                self.switch_to_top()
                self.set_attr("#shell-page", "dir", direction)
        self.set_attr("html", "dir", direction)

    def set_layout(self, name: str) -> None:
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

    def _adjust_window_for_fixed_content_size(self) -> None:
        assert self.current_layout is not None

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

    def assert_pixels_in_current_layout(
        self,
        selector: str,
        key: str,
        *,
        ignore: Collection[str] = (),
        mock: Mapping[str, str] | None = None,
        sit_after_mock: bool = False,
        scroll_into_view: str | None = None,
        wait_animations: bool = True,
        wait_delay: float = 0.5,
        chrome_hack_double_shots: bool = False,
        abs_tolerance: float = 20
    ) -> None:
        """Compare the given element with its reference in the current layout"""

        if not (Image and self.pixels_label):
            return

        assert self.current_layout is not None
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

        def relative_clips(sels: Collection[str]) -> Collection[tuple[int, int, int, int]]:
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
        rect["type"] = "box"
        ret = self.bidi("browsingContext.captureScreenshot", quiet=True,
                        context=self.driver.top_context,
                        clip=rect)
        if chrome_hack_double_shots:
            # HACK - https://github.com/cockpit-project/cockpit/issues/21577
            #
            # There is some really evil Chromium bug that often hides the
            # primary button in dialog screenshots.  But funnily, calling
            # captureScreenshot a second time will give us the correct
            # rendering, every time.
            #
            # This doesn't seem to be a race between the page changing and
            # us taking screenshots. No amount of waiting here helps
            # fully. The second call to captureScreenshot seems to indeed
            # trigger something that renders the page again, and correctly
            # this time.
            #
            ret1 = ret
            ret = self.bidi("browsingContext.captureScreenshot", quiet=True,
                            context=self.driver.top_context,
                            clip=rect)
            if ret1["data"] != ret["data"]:
                print("WARNING: Inconsistent screenshots for", base)
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

            def masked(ref: tuple[int, ...]) -> bool:
                return ref[3] != 255

            def ignorable_coord(x: int, y: int) -> bool:
                for (x0, y0, x1, y1) in ignore_rects:
                    if x >= x0 - 2 and x < x1 + 2 and y >= y0 - 2 and y < y1 + 2:
                        return True
                return False

            def ignorable_change(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
                return abs(a[0] - b[0]) <= 2 and abs(a[1] - b[1]) <= 2 and abs(a[2] - b[2]) <= 2

            def img_eq(ref: Image.Image, now: Image.Image, delta: Image.Image) -> bool:
                # This is slow but exactly what we want.
                # ImageMath might be able to speed this up.
                # no-untyped-call: see https://github.com/python-pillow/Pillow/issues/8029
                data_ref = ref.load()
                data_now = now.load()
                data_delta = delta.load()
                assert data_ref
                assert data_now
                assert data_delta
                result = True
                count = 0
                width, height = delta.size
                for y in range(height):
                    for x in range(width):
                        if x >= ref.size[0] or x >= now.size[0] or y >= ref.size[1] or y >= now.size[1]:
                            result = False
                        else:
                            # we only support RGBA
                            ref_pixel = data_ref[x, y]
                            now_pixel = data_now[x, y]
                            # we only support RGBA, not single-channel float (grayscale)
                            assert isinstance(ref_pixel, tuple)
                            assert isinstance(now_pixel, tuple)

                            if ref_pixel != now_pixel:
                                if (
                                        masked(ref_pixel) or
                                        ignorable_coord(x, y) or
                                        ignorable_change(ref_pixel, now_pixel)
                                ):
                                    data_delta[x, y] = (0, 255, 0, 255)
                                else:
                                    data_delta[x, y] = (255, 0, 0, 255)
                                    count += 1
                                    if count > abs_tolerance:
                                        result = False
                            else:
                                data_delta[x, y] = ref_pixel
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

    def assert_pixels(
        self,
        selector: str,
        key: str,
        *,
        ignore: Collection[str] = (),
        mock: Mapping[str, str] | None = None,
        sit_after_mock: bool = False,
        skip_layouts: Container[str] = (),
        scroll_into_view: str | None = None,
        wait_animations: bool = True,
        wait_after_layout_change: bool = False,
        wait_delay: float = 0.5,
        layout_change_hook: Callable[[], None] | None = None,
        chrome_hack_double_shots: bool = False,
        abs_tolerance: float = 20
    ) -> None:
        """Compare the given element with its reference in all layouts"""

        if ignore is None:
            ignore = []

        if not (Image and self.pixels_label):
            return

        # If the page overflows make sure to not show a scrollbar
        # Don't apply this hack for login and terminal and shell as they don't use PF Page
        if not self.is_present("#shell-page") and not self.is_present("#login-details") and not self.is_present("#system-terminal-page"):
            classes = self.attr("body", "class")
            self.set_attr("body", "class", f"{classes} pixel-test")

        # move the mouse to a harmless place where it doesn't accidentally focus anything (as that changes UI)
        self.bidi("input.performActions", context=self.driver.context, actions=[{
            "id": "move-away",
            "type": "pointer",
            "parameters": {"pointerType": "mouse"},
            "actions": [{"type": "pointerMove", "x": 2000, "y": 0, "origin": "viewport"}]
        }])

        if self.current_layout:
            previous_layout = self.current_layout["name"]
            for layout in self.layouts:
                if layout["name"] not in skip_layouts:
                    self.set_layout(layout["name"])
                    if wait_after_layout_change:
                        time.sleep(wait_delay)
                    if layout_change_hook:
                        layout_change_hook()
                    self.assert_pixels_in_current_layout(selector, key, ignore=ignore,
                                                         mock=mock, sit_after_mock=sit_after_mock,
                                                         scroll_into_view=scroll_into_view,
                                                         wait_animations=wait_animations,
                                                         wait_delay=wait_delay,
                                                         chrome_hack_double_shots=chrome_hack_double_shots,
                                                         abs_tolerance=abs_tolerance)

            self.set_layout(previous_layout)

    def assert_no_unused_pixel_test_references(self) -> None:
        """Check whether all reference images in test/reference have been used."""

        if not (Image and self.pixels_label):
            return

        pixel_references = set(glob.glob(os.path.join(TEST_DIR, "reference", self.pixels_label + "*-pixels.png")))
        unused = pixel_references - self.used_pixel_references
        for u in unused:
            print("Unused reference image " + os.path.basename(u))
            self.failed_pixel_tests += 1

    def get_js_log(self) -> Sequence[str]:
        """Return the current javascript log"""

        if self._is_running():
            return [str(log) for log in self.driver.logs]
        return []

    def copy_js_log(self, title: str, label: str | None = None) -> None:
        """Copy the current javascript log"""

        logs = self.get_js_log()
        if logs:
            filename = unique_filename(f"{label or self.label}-{title}", "js.log")
            with open(filename, 'wb') as f:
                f.write('\n'.join(logs).encode())
            attach(filename, move=True)
            print("Wrote JS log to " + filename)

    def write_coverage_data(self) -> None:
        if self.coverage_label and self._is_running():
            coverage = self.cdp_command("Profiler.takePreciseCoverage")
            write_lcov(coverage['result'], self.coverage_label)

    def assert_no_oops(self) -> None:
        if self.allow_oops:
            return

        if self.have_test_api():
            self.switch_to_top()
            if self.eval_js("!!document.getElementById('navbar-oops')"):
                assert not self.is_visible("#navbar-oops"), "Cockpit shows an Oops"


class MachineCase(unittest.TestCase):
    image = testvm.DEFAULT_IMAGE
    libexecdir: str | None = None
    sshd_socket: str | None = None
    runner = None
    machine: testvm.Machine
    machines: Mapping[str, testvm.Machine]
    machine_class: type | None = None
    browser: Browser
    network = None
    journal_start: str | None = None

    # provision is a dictionary of dictionaries, one for each additional machine to be created, e.g.:
    # provision = { 'openshift' : { 'image': 'openshift', 'memory_mb': 1024 } }
    # These will be instantiated during setUp, and replaced with machine objects
    provision: ClassVar[Mapping[str, Mapping[str, Any]] | None] = None

    global_machine = None

    @classmethod
    def get_global_machine(cls) -> testvm.Machine:
        if cls.global_machine:
            return cls.global_machine
        cls.global_machine = cls().new_machine(restrict=True, cleanup=False)
        if opts.trace:
            print(f"Starting global machine {cls.global_machine.label}")
        cls.global_machine.start()
        return cls.global_machine

    @classmethod
    def kill_global_machine(cls) -> None:
        if cls.global_machine:
            cls.global_machine.kill()
            cls.global_machine = None

    def label(self) -> str:
        return self.__class__.__name__ + '-' + self._testMethodName

    def new_machine(
        self,
        image: str | None = None,
        forward: Mapping[str, int] | None = None,
        restrict: bool = True,
        cleanup: bool = True,
        inherit_machine_class: bool = True,
        **kwargs: Any
    ) -> testvm.Machine:
        machine_class = (inherit_machine_class and self.machine_class) or testvm.VirtMachine

        if opts.address:
            if forward:
                raise unittest.SkipTest("Cannot run this test when specific machine address is specified")
            machine = testvm.Machine(address=opts.address, image=image or self.image,
                                     verbose=opts.trace, browser=opts.browser)
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
            image_file = machine.image_file
            if opts.fetch and not os.path.exists(image_file):
                machine.pull(image_file)
            if cleanup:
                self.addCleanup(machine.kill)
        return machine

    def new_browser(self, machine: testvm.Machine | None = None, coverage: bool = False) -> Browser:
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

    def getError(self) -> str | None:
        # errors is a list of (method, exception) calls (usually multiple
        # per method); None exception means success
        errors = []
        assert hasattr(self, '_outcome')
        if hasattr(self._outcome, 'errors'):
            assert hasattr(self, '_feedErrorsToResult')
            # Python 3.4 - 3.10  (These two methods have no side effects)
            result = self.defaultTestResult()
            errors = result.errors
            self._feedErrorsToResult(result, self._outcome.errors)
        elif hasattr(self._outcome, 'result') and hasattr(self._outcome.result, '_excinfo'):
            # pytest emulating unittest
            assert isinstance(self._outcome.result._excinfo, str)
            return self._outcome.result._excinfo
        else:
            # Python 3.11+ now records errors and failures seperate
            errors = self._outcome.result.errors + self._outcome.result.failures

        try:
            return errors[0][1]
        except IndexError:
            return None

    def is_nondestructive(self) -> bool:
        test_method = getattr(self.__class__, self._testMethodName)
        return get_decorator(test_method, self.__class__, "nondestructive")

    def is_devel_build(self) -> bool:
        return os.environ.get('NODE_ENV') == 'development'

    def disable_preload(self, *packages: str, machine: testvm.Machine | None = None) -> None:
        if machine is None:
            machine = self.machine
        for pkg in packages:
            machine.write(f"/etc/cockpit/{pkg}.override.json", '{ "preload": [ ] }')

    def enable_preload(self, package: str, *pages: str) -> None:
        pages_str = ', '.join(f'"{page}"' for page in pages)
        self.machine.write(f"/etc/cockpit/{package}.override.json", f'{{ "preload": [ {pages_str} ] }}')

    def system_before(self, version: int) -> bool:
        try:
            v = self.machine.execute("""rpm -q --qf '%{V}' cockpit-system ||
                                        dpkg-query -W -f '${source:Upstream-Version}' cockpit-system ||
                                        (pacman -Q cockpit | cut -f2 -d' ' | cut -f1 -d-)
                                     """).split(".")
        except subprocess.CalledProcessError:
            return False

        return int(v[0]) < version

    def setUp(self) -> None:
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
                options = dict(provision[key])
                options.pop('address', None)
                options.pop('dns', None)
                options.pop('dhcp', None)
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

        m = self.machine
        self.journal_start = m.journal_cursor()
        self.browser = self.new_browser(coverage=opts.coverage)
        # fail tests on criticals
        m.write("/etc/cockpit/cockpit.conf", "[Log]\nFatal = criticals\n")
        if self.is_nondestructive():
            self.nonDestructiveSetup()

        # Pages with debug enabled are huge and loading/executing them is heavy for browsers
        # To make it easier for browsers and thus make tests quicker, disable packagekit and systemd preloads
        if self.is_devel_build():
            self.disable_preload("packagekit", "systemd")

        image = m.image

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

        # only enabled by default on released OSes; see pkg/shell/manifest.json
        self.multihost_enabled = image.startswith(("rhel-9", "centos-9")) or image in [
                "ubuntu-2204", "ubuntu-2404", "debian-stable"]
        # Transitional code while we move ubuntu-stable from 24.04 to 24.10
        if image == "ubuntu-stable" and m.execute(". /etc/os-release; echo $VERSION_ID").strip() == "24.04":
            self.multihost_enabled = True

    def nonDestructiveSetup(self) -> None:
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

        def get_home_dirs() -> Sequence[str]:
            return m.execute("if [ -d /home ]; then ls /home; fi").strip().split()

        initial_home_dirs = get_home_dirs()

        def cleanup_home_dirs() -> None:
            for d in get_home_dirs():
                if d not in initial_home_dirs:
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

            if not m.ws_container:
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

    def _terminate_sessions(self) -> None:
        m = self.machine

        # on OSTree we don't get "web console" sessions with the cockpit/ws container; just SSH; but also, some tests start
        # admin sessions without Cockpit
        m.execute("""for u in $(loginctl --no-legend list-users  | awk '{ if ($2 != "root") print $1 }'); do
                         loginctl terminate-user $u 2>/dev/null || true
                         loginctl kill-user $u 2>/dev/null || true
                         pkill -9 -u $u || true
                         while pgrep -u $u; do sleep 0.2; done
                         while mountpoint -q /run/user/$u && ! umount /run/user/$u; do sleep 0.2; done
                         rm -rf /run/user/$u
                     done""")

        # Terminate all other Cockpit sessions
        sessions = m.execute("loginctl --no-legend list-sessions | awk '/web console/ { print $1 }'").strip().split()
        for s in sessions:
            # Don't insist that terminating works, the session might be gone by now.
            m.execute(f"loginctl kill-session {s} || true; loginctl terminate-session {s} || true")

        # Restart logind to mop up empty "closing" sessions; https://github.com/systemd/systemd/issues/26744
        m.execute("systemctl stop systemd-logind")

        # Wait for sessions to be gone
        sessions = m.execute("loginctl --no-legend list-sessions | awk '/web console/ { print $1 }'").strip().split()
        for s in sessions:
            try:
                m.execute(f"while loginctl show-session {s}; do sleep 0.2; done", timeout=30)
            except RuntimeError:
                # show the status in debug logs, to see what's wrong
                m.execute(f"loginctl session-status {s}; systemd-cgls", stdout=None)
                raise

        # terminate all systemd user services for users who are not logged in
        # since systemd 256 we stop user@*.service now also stops the root session (uid 0)
        m.execute("cd /run/systemd/users/; "
                  "for f in $(ls); do [ $f -le 500 ] || systemctl stop user@$f; done")

        # Clean up "closing" sessions again, and clean user id cache for non-system users
        m.execute("systemctl stop systemd-logind; cd /run/systemd/users/; "
                  "for f in $(ls); do [ $f -le 500 ] || rm $f; done")

    def tearDown(self) -> None:
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

        if self.is_nondestructive():
            self._terminate_sessions()

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def enable_multihost(self, machine: testvm.Machine) -> None:
        if isBeibootLogin():
            raise NotImplementedError("multi-host config change not currently implemented for beiboot scenario")
        if not self.multihost_enabled:
            machine.write("/etc/cockpit/cockpit.conf",
                          '[WebService]\nAllowMultiHost=yes\n')
            machine.restart_cockpit()

    def login_and_go(
        self,
        path: str | None = None,
        *,
        user: str | None = None,
        password: str | None = None,
        host: str | None = None,
        superuser: bool = True,
        urlroot: str | None = None,
        tls: bool = False,
        enable_root_login: bool = False
    ) -> None:
        if enable_root_login:
            self.enable_root_login()
        self.machine.start_cockpit(tls=tls)
        # first load after starting cockpit tends to take longer, due to on-demand service start
        with self.browser.wait_timeout(30):
            self.browser.login_and_go(path, user=user, password=password, host=host, superuser=superuser,
                                      urlroot=urlroot, tls=tls)

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
        "cockpit-session: pam: Last login: .*",
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

        # PCP Python bridge
        "cockpit.channels.pcp-ERROR: no such metric: .*",

        # timedatex.service shuts down after timeout, runs into race condition with property watching
        ".*org.freedesktop.timedate1: couldn't get all properties.*Error:org.freedesktop.DBus.Error.NoReply.*",
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

    env_allow = os.environ.get("TEST_ALLOW_BROWSER_ERRORS")
    if env_allow:
        default_allowed_console_errors += env_allow.split(",")

    def allow_journal_messages(self, *patterns: str) -> None:
        """Don't fail if the journal contains a entry completely matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_hostkey_messages(self) -> None:
        self.allow_journal_messages('.*: .* host key for server is not known: .*',
                                    '.*: refusing to connect to unknown host: .*',
                                    '.*: .* host key for server has changed to: .*',
                                    '.*: host key for this server changed key type: .*',
                                    '.*: failed to retrieve resource: hostkey-unknown')

    def allow_restart_journal_messages(self) -> None:
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
                                    ".*: external channel failed:.*",
                                    ".*: truncated data in external channel",
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

        # happens when logging out quickly while tracer is running
        self.allow_browser_errors("Tracer failed:.*internal-error")

    def check_journal_messages(self, machine: testvm.Machine | None = None) -> None:
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
            assert first is not None
            self.copy_js_log("FAIL")
            self.copy_journal("FAIL")
            self.copy_cores("FAIL")
            if not self.getError():
                # fail test on the unexpected messages
                raise Error(UNEXPECTED_MESSAGE + "journal messages:\n" + first)

    def allow_browser_errors(self, *patterns: str) -> None:
        """Don't fail if the test caused a console error contains the given regexp"""
        for p in patterns:
            self.allowed_console_errors.append(p)

    def check_browser_errors(self) -> None:
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

    def check_pixel_tests(self) -> None:
        if self.browser:
            self.browser.assert_no_unused_pixel_test_references()
            if self.browser.failed_pixel_tests > 0:
                raise Error(PIXEL_TEST_MESSAGE)

    def snapshot(self, title: str, label: str | None = None) -> None:
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.browser is not None:
            try:
                self.browser.snapshot(title, label)
            except Error:
                # this usually runs in exception handlers; raising an exception here skips cleanup handlers, so don't
                sys.stderr.write("Unexpected exception in snapshot():\n")
                sys.stderr.write(traceback.format_exc())

    def copy_js_log(self, title: str, label: str | None = None) -> None:
        if self.browser is not None:
            try:
                self.browser.copy_js_log(title, label)
            except RuntimeError:
                # this usually runs in exception handlers; raising an exception here skips cleanup handlers, so don't
                sys.stderr.write("Unexpected exception in copy_js_log():\n")
                sys.stderr.write(traceback.format_exc())

    def copy_journal(self, title: str, label: str | None = None) -> None:
        for _, m in self.machines.items():
            if m.ssh_reachable:
                log = unique_filename("%s-%s-%s" % (label or self.label(), m.label, title), "log.gz")
                with open(log, "w") as fp:
                    m.execute("journalctl|gzip", stdout=fp)
                    print("Journal extracted to %s" % (log))
                    attach(log, move=True)

    def copy_cores(self, title: str, label: str | None = None) -> None:
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

    def settle_cpu(self) -> None:
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

    def sed_file(self, expr: str, path: str, apply_change_action: str | None = None) -> None:
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

    def restore_dir(
        self,
        path: str,
        post_restore_action: str | None = None,
        reboot_safe: bool = False,
        restart_unit: str | None = None
    ) -> None:
        """Backup/restore a directory for a nondestructive test

        This takes care to not ever touch the original content on disk, but uses transient overlays.
        As this uses a bind mount, it does not work for files that get changed atomically (with mv);
        use restore_file() for these.

        `restart_unit` will be stopped before restoring path, and restarted afterwards if it was running.
        The optional post_restore_action will run after restoring the original content.

        If the directory needs to survive reboot, `reboot_safe=True` needs to be specified; then this
        will just backup/restore the directory instead of bind-mounting, which is less robust.
        """
        if not self.is_nondestructive():
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

    def restore_file(self, path: str, post_restore_action: str | None = None) -> None:
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

    def write_file(
        self,
        path: str,
        content: str,
        append: bool = False,
        owner: str | None = None,
        perm: str | None = None,
        post_restore_action: str | None = None
    ) -> None:
        """Write a file on primary machine

        This is safe for @nondestructive tests, the file will be removed during cleanup.

        If @append is True, append to existing file instead of replacing it.
        @owner is the desired file owner as chown shell string (e.g. "admin:nogroup")
        @perm is the desired file permission as chmod shell string (e.g. "0600")
        """
        m = self.machine
        self.restore_file(path, post_restore_action=post_restore_action)
        m.write(path, content, append=append, owner=owner, perm=perm)

    def enable_root_login(self) -> None:
        """Enable root login

        By default root login is disabled in cockpit, removing the root entry of
        /etc/cockpit/disallowed-users allows root to login.
        """

        disallowed_conf = '/etc/cockpit/disallowed-users'
        if not self.machine.ws_container and self.file_exists(disallowed_conf):
            self.sed_file('/root/d', disallowed_conf)

    def reboot(self, timeout_sec: int | None = None) -> None:
        self.allow_restart_journal_messages()
        if timeout_sec is None:
            self.machine.reboot()
        else:
            self.machine.reboot(timeout_sec=timeout_sec)

    def wait_reboot(self, timeout_sec: int | None = None) -> None:
        self.allow_restart_journal_messages()
        if timeout_sec is None:
            self.machine.wait_reboot()
        else:
            self.machine.wait_reboot(timeout_sec=timeout_sec)

    def setup_provisioned_hosts(self, disable_preload: bool = False) -> None:
        """Setup provisioned hosts for testing

        This sets the hostname of all machines to the name given in the
        provision dictionary and optionally disabled preload.
        """
        for name, m in self.machines.items():
            m.execute(f"hostnamectl set-hostname {name}")
            if disable_preload:
                self.disable_preload("packagekit", "playground", "systemd", machine=m)

    @staticmethod
    def authorize_pubkey(machine: testvm.Machine, account: str, pubkey: str) -> None:
        machine.execute(f"a={account} d=/home/$a/.ssh; mkdir -p $d; chown $a:$a $d; chmod 700 $d")
        machine.write(f"/home/{account}/.ssh/authorized_keys", pubkey)
        machine.execute(f"a={account}; chown $a:$a /home/$a/.ssh/authorized_keys")

    @staticmethod
    def get_pubkey(machine: testvm.Machine, account: str) -> str:
        return machine.execute(f"cat /home/{account}/.ssh/id_rsa.pub")

    def setup_ssh_auth(self) -> None:
        self.machine.execute("d=/home/admin/.ssh; mkdir -p $d; chown admin:admin $d; chmod 700 $d")
        self.machine.execute("test -f /home/admin/.ssh/id_rsa || ssh-keygen -f /home/admin/.ssh/id_rsa -t rsa -N ''")
        self.machine.execute("chown admin:admin /home/admin/.ssh/id_rsa*")
        pubkey = self.get_pubkey(self.machine, "admin")

        for m in self.machines:
            self.authorize_pubkey(self.machines[m], "admin", pubkey)


###########################
# Global helper functions
#


def jsquote(js: object) -> str:
    return json.dumps(js)


def get_decorator(method: object, class_: object, name: str, default: Any = None) -> Any:
    """Get decorator value of a test method or its class

    Return None if the decorator was not set.
    """
    attr = "_testlib__" + name
    return getattr(method, attr, getattr(class_, attr, default))


###########################
# Test decorators
#


def skipBrowser(reason: str, *browsers: str) -> Callable[[_FT], _FT]:
    """Decorator for skipping a test on given browser(s)

    Skips a test for provided *reason* on *browsers*.
    """
    browser = os.environ.get("TEST_BROWSER", "chromium")
    if browser in browsers:
        return unittest.skip(f"{browser}: {reason}")
    return lambda testEntity: testEntity


def skipImage(reason: str, *images: str) -> Callable[[_FT], _FT]:
    """Decorator for skipping a test for given image(s)

    Skip a test for a provided *reason* for given *images*. These
    support Unix shell style patterns via fnmatch.fnmatch.

    Example: @skipImage("no btrfs support on RHEL", "rhel-*")
    """
    if any(fnmatch.fnmatch(testvm.DEFAULT_IMAGE, img) for img in images):
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def onlyImage(reason: str, *images: str) -> Callable[[_FT], _FT]:
    """Decorator to only run a test on given image(s)

    Only run this test on provided *images* for *reason*. These
    support Unix shell style patterns via fnmatch.fnmatch.
    """
    if not any(fnmatch.fnmatch(testvm.DEFAULT_IMAGE, arg) for arg in images):
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def skipOstree(reason: str) -> Callable[[_FT], _FT]:
    """Decorator for skipping a test on OSTree images

    Skip test for *reason* on OSTree images defined in OSTREE_IMAGES in bots/lib/constants.py.
    """
    if testvm.DEFAULT_IMAGE in OSTREE_IMAGES:
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def isBeibootLogin() -> bool:
    return "ws-container" in os.getenv("TEST_SCENARIO", "")


def skipWsContainer(reason: str) -> Callable[[_FT], _FT]:
    """Decorator for skipping a test with cockpit/ws"""
    if testvm.DEFAULT_IMAGE in OSTREE_IMAGES or isBeibootLogin():
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def skipBeiboot(reason: str) -> Callable[[_FT], _FT]:
    """Decorator for skipping a test with cockpit/ws in beiboot mode"""
    if isBeibootLogin():
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: {reason}")
    return lambda testEntity: testEntity


def nondestructive(testEntity: _T) -> _T:
    """Tests decorated as nondestructive will all run against the same VM

    Can be used on test classes and individual test methods.
    """
    setattr(testEntity, '_testlib__nondestructive', True)
    return testEntity


def destructive(testEntity: _T) -> _T:
    """Tests decorated as destructive will get their own VM

    Can be used on test classes and individual test methods.
    """
    setattr(testEntity, '_testlib__nondestructive', False)
    return testEntity


def no_retry_when_changed(testEntity: _T) -> _T:
    """Tests decorated with no_retry_when_changed will only run once if they've been changed

    Tests that have been changed are expected to succeed 3 times, if the test
    takes a long time, this prevents timeouts. Can be used on test classes and
    individual methods.
    """
    setattr(testEntity, '_testlib__no_retry_when_changed', True)
    return testEntity


def todo(reason: str = '') -> Callable[[_T], _T]:
    """Tests decorated with @todo are expected to fail.

    An optional reason can be given, and will appear in the TAP output if run
    via run-tests.
    """
    def wrapper(testEntity: _T) -> _T:
        setattr(testEntity, '_testlib__todo', reason)
        return testEntity
    return wrapper


def timeout(seconds: int) -> Callable[[_T], _T]:
    """Change default test timeout of 600s, for long running tests

    Can be applied to an individual test method or the entire class. This only
    applies to test/common/run-tests, not to calling check-* directly.
    """
    def wrapper(testEntity: _T) -> _T:
        setattr(testEntity, '_testlib__timeout', seconds)
        return testEntity
    return wrapper


class TapRunner:
    def __init__(self, verbosity: int = 1):
        self.verbosity = verbosity

    def runOne(self, test: unittest.TestCase) -> unittest.TestResult:
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

    def run(self, testable: unittest.TestSuite) -> int:
        tests: list[unittest.TestCase] = []

        # The things to test
        def collapse(test: unittest.TestCase | unittest.TestSuite, tests: list[unittest.TestCase]) -> None:
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
            skipstr = ", ".join([f"{s[0]!s} {s[1]}" for s in skips])
            sys.stdout.write(f"# SKIP {skipstr}\n")
            return 77
        if failures:
            plural = "S" if failures > 1 else ""
            sys.stdout.write(f"# {failures} TEST{plural} FAILED {details}\n")
            return 1
        else:
            plural = "S" if test_count > 1 else ""
            sys.stdout.write(f"# {test_count} TEST{plural} PASSED {details}\n")
            return 0


def print_tests(tests: unittest.TestSuite | Collection[unittest.TestSuite | unittest.TestCase]) -> None:
    assert hasattr(unittest.loader, '_FailedTest')
    for test in tests:
        if isinstance(test, unittest.TestSuite):
            print_tests(test)
        elif isinstance(test, unittest.loader._FailedTest):
            name = test.id().replace("unittest.loader._FailedTest.", "")
            print(f"Error: '{name}' does not match a test", file=sys.stderr)
        else:
            print(test.id().replace("__main__.", ""))


def arg_parser(enable_sit: bool = True) -> argparse.ArgumentParser:
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
    parser.add_argument('tests', nargs='*', default=os.getenv("TEST_NAMES", '').split())

    parser.set_defaults(verbosity=1, fetch=True)
    return parser


def test_main(
     options: argparse.Namespace | None = None,  # noqa: PT028
     suite: unittest.TestSuite | None = None,  # noqa: PT028
     attachments: str | None = None,  # noqa: PT028
    ) -> int:
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

    parser = arg_parser()
    parser.add_argument('--machine', metavar="hostname[:port]", dest="address",
                        default=None, help="Run this test against an already running machine")
    parser.add_argument('--browser', metavar="hostname[:port]", dest="browser",
                        default=None, help="When using --machine, use this cockpit web address")

    if options is None:
        options = parser.parse_args()
        standalone = True
    else:
        standalone = False

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
    def __init__(self, msg: str) -> None:
        self.msg = msg

    def __str__(self) -> str:
        return self.msg


def wait(func: Callable[[], _T | None], msg: str | None = None, delay: int = 1, tries: int = 60) -> _T:
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
        t = t + 1
        time.sleep(delay)
    raise Error(msg or "Condition did not become true.")


def sit(machines: Mapping[str, testvm.Machine] = {}) -> None:
    """
    Wait until the user confirms to continue.

    The current test case is suspended so that the user can inspect
    the browser.
    """

    for machine in machines.values():
        sys.stderr.write(machine.diagnose())
    print("Press RET to continue...")
    sys.stdin.readline()
