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

"""
Tools for writing Cockpit test cases.
"""

from time import sleep

import argparse
import base64
import errno
import os
import shutil
import socket
import sys
import traceback
import subprocess
import re
import json
import tempfile
import time
import unittest
import gzip
import inspect

import testvm
import cdp
from fmf_metadata.base import set_obj_attribute, is_test_function, generic_metadata_setter

try:
    from PIL import Image
    import io
except ImportError:
    Image = None

BASE_DIR = os.path.realpath(f'{__file__}/../../..')
TEST_DIR = f'{BASE_DIR}/test'
BOTS_DIR = f'{BASE_DIR}/bots'

os.environ["PATH"] = "{0}:{1}:{2}".format(os.environ.get("PATH"), BOTS_DIR, TEST_DIR)

# Be careful when changing this string, check in cockpit-project/bots where it is being used
UNEXPECTED_MESSAGE = "FAIL: Test completed, but found unexpected "

__all__ = (
    # Test definitions
    'test_main',
    'arg_parser',
    'Browser',
    'MachineCase',
    'nondestructive',
    'no_retry_when_changed',
    'skipImage',
    'skipDistroPackage',
    'skipMobile',
    'skipBrowser',
    'skipPackage',
    'enableAxe',
    'timeout',
    'Error',

    'sit',
    'wait',
    'opts',
    'TEST_DIR',
    'UNEXPECTED_MESSAGE',
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


def attach(filename, move=False):
    '''Put a file into the attachments directory

    By default the file gets copied. You can set move=True for dynamically generated
    files which are not touched by parallel tests.
    '''
    if not opts.attachments:
        return
    dest = os.path.join(opts.attachments, os.path.basename(filename))
    if os.path.exists(filename) and not os.path.exists(dest):
        if move:
            shutil.move(filename, dest)
        else:
            shutil.copy(filename, dest)


class Browser:
    def __init__(self, address, label, pixels_label=None, port=None):
        if ":" in address:
            (self.address, unused, self.port) = address.rpartition(":")
        else:
            self.address = address
            self.port = 9090
        if port is not None:
            self.port = port
        self.default_user = "admin"
        self.label = label
        self.pixels_label = pixels_label
        path = os.path.dirname(__file__)
        self.cdp = cdp.CDP("C.utf8", verbose=opts.trace, trace=opts.trace,
                           inject_helpers=[os.path.join(path, "test-functions.js"), os.path.join(path, "sizzle.js")])
        self.password = "foobar"
        self.timeout_factor = int(os.getenv("TEST_TIMEOUT_FACTOR", "1"))
        self.failed_pixel_tests = 0

    def title(self):
        return self.cdp.eval('document.title')

    def open(self, href, cookie=None, tls=False):
        """
        Load a page into the browser.

        Arguments:
          href: The path of the Cockpit page to load, such as "/users".

        Either PAGE or URL needs to be given.

        Raises:
          Error: When a timeout occurs waiting for the page to load.
        """
        if href.startswith("/"):
            schema = tls and "https" or "http"
            href = "%s://%s:%s%s" % (schema, self.address, self.port, href)

        if cookie:
            self.cdp.invoke("Network.setCookie", **cookie)
        self.switch_to_top()
        self.cdp.invoke("Page.navigate", url=href)
        self.expect_load()

    def set_user_agent(self, ua):
        self.cdp.invoke("Emulation.setUserAgentOverride", userAgent=ua)

    def reload(self, ignore_cache=False):
        self.switch_to_top()
        self.wait_js_cond("ph_select('iframe.container-frame').every(function (e) { return e.getAttribute('data-loaded'); })")
        self.cdp.invoke("Page.reload", ignoreCache=ignore_cache)
        self.expect_load()

    def expect_load(self):
        if opts.trace:
            print("-> expect_load")
        self.cdp.command('expectLoad(%i)' % (self.cdp.timeout * self.timeout_factor * 1000))
        if opts.trace:
            print("<- expect_load done")

    def expect_load_frame(self, name):
        if opts.trace:
            print("-> expect_load_frame " + name)
        self.cdp.command('expectLoadFrame(%s, %i)' % (jsquote(name), self.cdp.timeout * self.timeout_factor * 1000))
        if opts.trace:
            print("<- expect_load_frame %s done" % name)

    def switch_to_frame(self, name):
        self.cdp.set_frame(name)

    def switch_to_top(self):
        self.cdp.set_frame(None)

    def upload_file(self, selector, file):
        r = self.cdp.invoke("Runtime.evaluate", expression='document.querySelector(%s)' % jsquote(selector))
        objectId = r["result"]["objectId"]
        self.cdp.invoke("DOM.setFileInputFiles", files=[file], objectId=objectId)

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

    # Execute js code that does not return anything
    def inject_js(self, code):
        self.cdp.invoke("Runtime.evaluate", expression=code, trace=code,
                        silent=False, awaitPromise=True, returnByValue=False, no_trace=True)

    # Execute js code that returns something
    def eval_js(self, code, no_trace=False):
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

    def call_js_func(self, func, *args):
        return self.eval_js("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def cookie(self, name):
        cookies = self.cdp.invoke("Network.getCookies")
        for c in cookies["cookies"]:
            if c["name"] == name:
                return c
        return None

    def go(self, hash, host="localhost"):
        # if not hash.startswith("/@"):
        #    hash = "/@" + host + hash
        self.call_js_func('ph_go', hash)

    def mouse(self, selector, type, x=0, y=0, btn=0, ctrlKey=False, shiftKey=False, altKey=False, metaKey=False):
        self.wait_visible(selector)
        self.call_js_func('ph_mouse', selector, type, x, y, btn, ctrlKey, shiftKey, altKey, metaKey)

    def click(self, selector):
        self.mouse(selector + ":not([disabled]):not([aria-disabled=true])", "click", 0, 0, 0)

    def mousedown(self, selector):
        self.mouse(selector + ":not([disabled]):not([aria-disabled=true])", "mousedown", 0, 0, 0)

    def val(self, selector):
        self.wait_visible(selector)
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector, val):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector):
        self.wait_visible(selector)
        return self.call_js_func('ph_text', selector)

    def attr(self, selector, attr):
        self._wait_present(selector)
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector, attr, val):
        self._wait_present(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_attr', selector, attr, val and 'true' or 'false')

    def get_checked(self, selector):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        return self.call_js_func('ph_get_checked', selector)

    def set_checked(self, selector, val):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_set_checked', selector, val)

    def focus(self, selector):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_focus', selector)

    def blur(self, selector):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        self.call_js_func('ph_blur', selector)

    # TODO: Unify them so we can have only one
    def key_press(self, keys, modifiers=0, use_ord=False):
        if self.cdp.browser.name == "chromium":
            self.key_press_chromium(keys, modifiers, use_ord)
        else:
            self.key_press_firefox(keys, modifiers, use_ord)

    def key_press_chromium(self, keys, modifiers=0, use_ord=False):
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

    def key_press_firefox(self, keys, modifiers=0, use_ord=False):
        # https://github.com/GoogleChrome/puppeteer/blob/master/lib/USKeyboardLayout.js
        keyMap = {
            8: "Backspace",   # Backspace key
            9: "Tab",         # Tab key
            13: "Enter",      # Enter key
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

    def select_from_dropdown(self, selector, value):
        self.wait_visible(selector + ':not([disabled]):not([aria-disabled=true])')
        text_selector = "{0} option[value='{1}']".format(selector, value)
        self._wait_present(text_selector)
        self.set_val(selector, value)
        self.wait_val(selector, value)

    def select_PF4(self, selector, value):
        self.click(f"{selector}:not([disabled]):not([aria-disabled=true])")
        select_entry = f"{selector} + ul button:contains('{value}')"
        self.click(select_entry)
        if self.is_present(f"{selector}.pf-m-typeahead"):
            self.wait_val(f"{selector} > div input[type=text]", value)
        else:
            self.wait_text(f"{selector} .pf-c-select__toggle-text", value)

    def set_input_text(self, selector, val, append=False, value_check=True, blur=True):
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

    def set_file_autocomplete_val(self, group_identifier, location):
        file_item_selector_template = "{0} li button:contains({1})"

        path = ''
        index = 0
        for path_part in filter(None, location.split('/')):
            self.click("{0} > div .pf-c-select__toggle-button".format(group_identifier))
            self._wait_present(group_identifier + " .pf-c-select__menu")
            path += '/' + path_part
            file_item_selector = file_item_selector_template.format(group_identifier, path)
            self.click(file_item_selector)
            if index != len(list(filter(None, location.split('/')))) - 1 or location[-1] == '/':
                self.wait_val("{0} > div input[type=text]".format(group_identifier), path + '/')
            else:
                self.wait_val("{0} > div input[type=text]".format(group_identifier), path)
            index += 1

        self.wait_val("{0} > div input[type=text]".format(group_identifier), location)

    def wait_timeout(self, timeout):
        browser = self

        class WaitParamsRestorer():
            def __init__(self, timeout):
                self.timeout = timeout

            def __enter__(self):
                pass

            def __exit__(self, type, value, traceback):
                browser.cdp.timeout = self.timeout
        r = WaitParamsRestorer(self.cdp.timeout)
        self.cdp.timeout = timeout
        return r

    def wait(self, predicate):
        for _ in range(self.cdp.timeout * self.timeout_factor * 5):
            val = predicate()
            if val:
                return val
            time.sleep(0.2)
        raise Error('timed out waiting for predicate to become true')

    def wait_js_cond(self, cond, error_description="null"):
        result = self.cdp.invoke("Runtime.evaluate",
                                 expression="ph_wait_cond(() => %s, %i, %s)" % (cond, self.cdp.timeout * self.timeout_factor * 1000, error_description),
                                 silent=False, awaitPromise=True, trace="wait: " + cond)
        if "exceptionDetails" in result:
            trailer = "\n".join(self.cdp.get_js_log())
            self.raise_cdp_exception("timeout\nwait_js_cond", cond, result["exceptionDetails"], trailer)

    def wait_js_func(self, func, *args):
        self.wait_js_cond("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def is_present(self, selector):
        return self.call_js_func('ph_is_present', selector)

    def _wait_present(self, selector):
        self.wait_js_func('ph_is_present', selector)

    def wait_not_present(self, selector):
        self.wait_js_func('!ph_is_present', selector)

    def is_visible(self, selector):
        return self.call_js_func('ph_is_visible', selector)

    def wait_visible(self, selector):
        self._wait_present(selector)
        self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector, val):
        self.wait_visible(selector)
        self.wait_js_func('ph_has_val', selector, val)

    def wait_not_val(self, selector, val):
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

    def wait_not_visible(self, selector):
        self.wait_js_func('!ph_is_visible', selector)

    def wait_in_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_cond("ph_in_text(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_not_in_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('!ph_in_text', selector, text)

    def wait_collected_text(self, selector, text):
        self.wait_js_func('ph_collected_text_is', selector, text)

    def wait_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_cond("ph_text_is(%s,%s)" % (jsquote(selector), jsquote(text)),
                          error_description="() => 'actual text: ' + ph_text(%s)" % jsquote(selector))

    def wait_text_not(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('!ph_text_is', selector, text)

    def wait_text_matches(self, selector, pattern):
        self.wait_visible(selector)
        self.wait_js_func('ph_text_matches', selector, pattern)

    def wait_popup(self, id):
        """Wait for a popup to open.

        Arguments:
          id: The 'id' attribute of the popup.
        """
        self.wait_visible('#' + id)

    def wait_popdown(self, id):
        """Wait for a popup to close.

        Arguments:
            id: The 'id' attribute of the popup.
        """
        self.wait_not_visible('#' + id)

    def dialog_complete(self, sel, button=".pf-m-primary", result="hide"):
        self.click(sel + " " + button)
        self.wait_not_present(sel + " .dialog-wait-ct")

        dialog_visible = self.call_js_func('ph_is_visible', sel)
        if result == "hide":
            if dialog_visible:
                raise AssertionError(sel + " dialog did not complete and close")
        elif result == "fail":
            if not dialog_visible:
                raise AssertionError(sel + " dialog is closed no failures present")
            dialog_error = self.call_js_func('ph_is_present', sel + " .dialog-error")
            if not dialog_error:
                raise AssertionError(sel + " dialog has no errors")
        else:
            raise Error("invalid dialog result argument: " + result)

    def dialog_cancel(self, sel, button="button[data-dismiss='modal']"):
        self.click(sel + " " + button)
        self.wait_not_visible(sel)

    def enter_page(self, path, host=None, reconnect=True):
        """Wait for a page to become current.

        Arguments:

            id: The identifier the page.  This is a string starting with "/"
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

    def wait_action_btn(self, sel, entry):
        self.wait_text(sel + ' button:first-child', entry)

    def click_action_btn(self, sel, entry=None):
        # We don't need to open the menu, it's enough to simulate a
        # click on the invisible button.
        if entry:
            self.click(sel + ' a:contains("%s")' % entry)
        else:
            self.click(sel + ' button:first-child')

    def try_login(self, user=None, password=None, superuser=True, legacy_authorized=None):
        """Fills in the login dialog and clicks the button.

        This differs from login_and_go() by not expecting any particular result.

        The "superuser" parameter determines wether the new session
        will try to get Administrative Access.

        The "legacy_authorized" parameter is or old versions of the
        login dialog that still have the "[ ] Reuse my password for
        magic things" checkbox.  Such a dialog is encountered when
        testing against old bastion hosts, for example.
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

    def login_and_go(self, path=None, user=None, host=None, superuser=True, urlroot=None, tls=False, password=None,
                     legacy_authorized=None):
        href = path
        if not href:
            href = "/"
        if urlroot:
            href = urlroot + href
        if host:
            href = "/@" + host + href
        self.open(href, tls=tls)

        self.try_login(user, password, superuser=superuser, legacy_authorized=legacy_authorized)

        self.expect_load()
        self._wait_present('#content')
        self.wait_visible('#content')
        if path:
            self.enter_page(path.split("#")[0], host=host)

    def logout(self):
        self.switch_to_top()
        self._wait_present("#navbar-dropdown")
        self.wait_visible("#navbar-dropdown")
        if self.is_visible("button#machine-reconnect"):
            # happens when shutting down cockpit or rebooting machine
            self.click("button#machine-reconnect")
        else:
            # happens when cockpit is still running
            self.click("#navbar-dropdown")
            self.click('#go-logout')
        self.expect_load()

    def relogin(self, path=None, user=None, superuser=None, wait_remote_session_machine=None):
        self.logout()
        if wait_remote_session_machine:
            wait_remote_session_machine.execute("while pgrep -a cockpit-ssh; do sleep 1; done")
        self.try_login(user, superuser=superuser)
        self.expect_load()
        self._wait_present('#content')
        self.wait_visible('#content')
        if path:
            if path.startswith("/@"):
                host = path[2:].split("/")[0]
            else:
                host = None
            self.enter_page(path.split("#")[0], host=host)

    def open_superuser_dialog(self):
        if self.cdp.mobile:
            self.click("#navbar-dropdown")
            self.click("#super-user-indicator-mobile button")
        else:
            self.click("#super-user-indicator button")

    def check_superuser_indicator(self, expected):
        if self.cdp.mobile:
            self.click("#navbar-dropdown")
            self.wait_text("#super-user-indicator-mobile", expected)
            self.click("#navbar-dropdown")
        else:
            self.wait_text("#super-user-indicator", expected)

    def become_superuser(self, user=None, password=None):
        cur_frame = self.cdp.cur_frame
        self.switch_to_top()

        self.open_superuser_dialog()
        self.wait_in_text(".pf-c-modal-box:contains('Switch to administrative access')", f"Password for {user or 'admin'}:")
        self.set_input_text(".pf-c-modal-box:contains('Switch to administrative access') input", password or "foobar")
        self.click(".pf-c-modal-box button:contains('Authenticate')")
        self.wait_not_present(".pf-c-modal-box:contains('Switch to administrative access')")
        self.check_superuser_indicator("Administrative access")

        self.switch_to_frame(cur_frame)

    def drop_superuser(self):
        cur_frame = self.cdp.cur_frame
        self.switch_to_top()

        self.open_superuser_dialog()
        self.click(".pf-c-modal-box:contains('Switch to limited access') button:contains('Limit access')")
        self.wait_not_present(".pf-c-modal-box:contains('Switch to limited access')")
        self.check_superuser_indicator("Limited access")

        self.switch_to_frame(cur_frame)

    def click_system_menu(self, path, enter=True):
        '''Click on a "System" menu entry with given URL path

        Enters the given target frame afterwards, unless enter=False is given
        (useful for remote hosts).
        '''
        self.switch_to_top()
        if self.cdp.mobile:
            self.click("#nav-system-item")
        self.click(f"#host-apps a[href='{path}']")
        if enter:
            # strip off parameters after hash
            self.enter_page(path.split('#')[0].rstrip('/'))

    def ignore_ssl_certificate_errors(self, ignore):
        action = ignore and "continue" or "cancel"
        if opts.trace:
            print("-> Setting SSL certificate error policy to %s" % action)
        self.cdp.command("new Promise((resolve, _) => { ssl_bad_certificate_action = '%s'; resolve() })" % action)

    def grant_permissions(self, *args):
        """Grant permissions to the browser"""
        # https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-grantPermissions
        self.cdp.invoke("Browser.grantPermissions",
                        origin="http://%s:%s" % (self.address, self.port),
                        permissions=args)

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG and HTML.

        Arguments:
            title: Used for the filename.
        """
        if self.cdp and self.cdp.valid:
            self.cdp.command("clearExceptions()")

            filename = "{0}-{1}.png".format(label or self.label, title)
            ret = self.cdp.invoke("Page.captureScreenshot", no_trace=True)
            if "data" in ret:
                with open(filename, 'wb') as f:
                    f.write(base64.standard_b64decode(ret["data"]))
                attach(filename, move=True)
                print("Wrote screenshot to " + filename)
            else:
                print("Screenshot not available")

            filename = "{0}-{1}.html".format(label or self.label, title)
            html = self.cdp.invoke("Runtime.evaluate", expression="document.documentElement.outerHTML",
                                   no_trace=True)["result"]["value"]
            with open(filename, 'wb') as f:
                f.write(html.encode('UTF-8'))
            attach(filename, move=True)
            print("Wrote HTML dump to " + filename)

    def assert_pixels(self, selector, key, ignore=[]):
        """Compare the given element with its reference"""

        if not (Image and self.pixels_label and self.cdp and self.cdp.valid):
            return

        self.call_js_func('ph_scrollIntoViewIfNeeded', selector)

        rect = self.call_js_func('ph_element_clip', selector)

        def relative_clip(sel):
            r = self.call_js_func('ph_element_clip', sel)
            return (r['x'] - rect['x'],
                    r['y'] - rect['y'],
                    r['x'] - rect['x'] + r['width'],
                    r['y'] - rect['y'] + r['height'])

        reference_dir = os.path.join(TEST_DIR, 'reference')
        if not os.path.exists(os.path.join(reference_dir, '.git')):
            subprocess.check_call([f'{TEST_DIR}/common/pixel-tests', 'pull'])

        ignore_rects = list(map(relative_clip, map(lambda item: selector + " " + item, ignore)))
        base = self.pixels_label + "-" + key
        if self.cdp.mobile:
            base += "-mobile"
        filename = base + "-pixels.png"
        ref_filename = os.path.join(reference_dir, filename)
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
            img_delta = img_ref.copy()

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
                if ref.size != now.size:
                    return False
                data_ref = ref.load()
                data_now = now.load()
                data_delta = delta.load()
                result = True
                width, height = ref.size
                for y in range(height):
                    for x in range(width):
                        if data_ref[x, y] != data_now[x, y]:
                            if masked(data_ref[x, y]) or ignorable_coord(x, y) or ignorable_change(data_ref[x, y], data_now[x, y]):
                                data_delta[x, y] = (0, 255, 0, 255)
                            else:
                                data_delta[x, y] = (255, 0, 0, 255)
                                result = False
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

    def get_js_log(self):
        """Return the current javascript log"""

        if self.cdp:
            return self.cdp.get_js_log()
        return []

    def copy_js_log(self, title, label=None):
        """Copy the current javascript log"""

        logs = list(self.get_js_log())
        if logs:
            filename = "{0}-{1}.js.log".format(label or self.label, title)
            with open(filename, 'wb') as f:
                f.write('\n'.join(logs).encode('UTF-8'))
            attach(filename, move=True)
            print("Wrote JS log to " + filename)

    def kill(self):
        self.cdp.kill()


class _DebugOutcome(unittest.case._Outcome):
    '''Run debug actions after test methods

    This will do screenshots, HTML dumps, and sitting before cleanup handlers run.
    '''

    def testPartExecutor(self, test_case, isTest=False):
        # we want to do the debug actions after the test function got called (isTest==True), but before
        # TestCase.run() calls tearDown(); thus remember whether we are after isTest and already ran
        if isTest:
            self.ran_debug = False
        else:
            if getattr(self, "ran_debug", None) is False:
                self.ran_debug = True
                if self.errors:
                    (err_case, exc_info) = self.errors[-1]
                    if exc_info and isinstance(test_case, MachineCase):
                        assert err_case == test_case
                        # strip off the two topmost frames for testPartExecutor and TestCase.run(); uninteresting and breaks naughties
                        traceback.print_exception(exc_info[0], exc_info[1], exc_info[2].tb_next.tb_next)
                        try:
                            test_case.snapshot("FAIL")
                            test_case.copy_js_log("FAIL")
                            test_case.copy_journal("FAIL")
                            test_case.copy_cores("FAIL")
                        except (OSError, RuntimeError):
                            # failures in these debug artifacts should not skip cleanup actions
                            sys.stderr.write("Failed to generate debug artifact:\n")
                            traceback.print_exc(file=sys.stderr)

                        if opts.sit:
                            sit(test_case.machines)

        return super().testPartExecutor(test_case, isTest)


unittest.case._Outcome = _DebugOutcome


class MachineCase(unittest.TestCase):
    image = testvm.DEFAULT_IMAGE
    libexecdir = None
    runner = None
    machine = None
    machines = {}
    machine_class = None
    browser = None
    network = None
    journal_start = None

    # provision is a dictionary of dictionaries, one for each additional machine to be created, e.g.:
    # provision = { 'openshift' : { 'image': 'openshift', 'memory_mb': 1024 } }
    # These will be instantiated during setUp, and replaced with machine objects
    provision = None

    global_machine = None

    @classmethod
    def get_global_machine(klass):
        if klass.global_machine:
            return klass.global_machine
        klass.global_machine = klass.new_machine(klass, restrict=True, cleanup=False)
        if opts.trace:
            print("Starting global machine {0}".format(klass.global_machine.label))
        klass.global_machine.start()
        return klass.global_machine

    @classmethod
    def kill_global_machine(klass):
        if klass.global_machine:
            klass.global_machine.kill()

    def label(self):
        (unused, sep, label) = self.id().partition(".")
        return label.replace(".", "-")

    def new_machine(self, image=None, forward={}, restrict=True, cleanup=True, **kwargs):
        machine_class = self.machine_class
        if opts.address:
            if machine_class or forward:
                raise unittest.SkipTest("Cannot run this test when specific machine address is specified")
            machine = testvm.Machine(address=opts.address, image=image or self.image, verbose=opts.trace, browser=opts.browser)
            if cleanup:
                self.addCleanup(machine.disconnect)
        else:
            if image is None:
                image = os.path.join(TEST_DIR, "images", self.image)
                if not os.path.exists(image):
                    raise FileNotFoundError("Can't run tests without a prepared image; use test/image-prepare")
            if not machine_class:
                machine_class = testvm.VirtMachine
            if not self.network:
                network = testvm.VirtNetwork(image=image)
                if cleanup:
                    self.addCleanup(network.kill)
                self.network = network
            networking = self.network.host(restrict=restrict, forward=forward)
            machine = machine_class(verbose=opts.trace, networking=networking, image=image, **kwargs)
            if opts.fetch and not os.path.exists(machine.image_file):
                machine.pull(machine.image_file)
            if cleanup:
                self.addCleanup(machine.kill)
        return machine

    def new_browser(self, machine=None):
        if machine is None:
            machine = self.machine
        label = self.label() + "-" + machine.label
        pixels_label = None
        if machine.image == testvm.TEST_OS_DEFAULT and os.environ.get("TEST_BROWSER", "chromium") == "chromium" and not self.is_devel_build():
            pixels_label = self.label()
        browser = Browser(machine.web_address, label=label, pixels_label=pixels_label, port=machine.web_port)
        self.addCleanup(browser.kill)
        return browser

    def checkSuccess(self):
        # errors is a list of (method, exception) calls (usually multiple
        # per method); None exception means success
        return not any(e[1] for e in self._outcome.errors)

    def is_nondestructive(self):
        test_method = getattr(self.__class__, self._testMethodName)
        return getattr(test_method, "_testlib__non_destructive", False)

    def is_devel_build(self):
        return os.environ.get('NODE_ENV') == 'development'

    def disable_preload(self, *packages):
        for pkg in packages:
            path = "/usr/share/cockpit/%s" % pkg
            if self.machine.execute("if test -e %s; then echo yes; fi" % path):
                if self.machine.ostree_image:
                    # get a writable directory
                    self.restore_dir(path)
                self.write_file("%s/override.json" % path, '{ "preload": [ ] }')

    def enable_preload(self, package, *pages):
        path = "/usr/share/cockpit/%s" % package
        if self.machine.execute("if test -e %s; then echo yes; fi" % path):
            self.write_file(path + '/override.json', '{ "preload": [%s]}' % ', '.join('"{0}"'.format(page) for page in pages))

    def system_before(self, version):
        try:
            v = self.machine.execute("""rpm -q --qf '%{V}' cockpit-system ||
                                        dpkg-query -W -f '${source:Upstream-Version}' cockpit-system
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

        self.browser = None
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
            self.machine = None
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
                if not self.machine:
                    self.machine = machine
                if opts.trace:
                    print("Starting {0} {1}".format(key, machine.label))
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

        if self.machine:
            self.journal_start = self.machine.journal_cursor()
            self.browser = self.new_browser()
            # fail tests on criticals
            self.machine.write("/etc/cockpit/cockpit.conf", "[Log]\nFatal = criticals\n")
            if self.is_nondestructive():
                self.nonDestructiveSetup()

            # Pages with debug enabled are huge and loading/executing them is heavy for browsers
            # To make it easier for browsers and thus make tests quicker, disable packagekit and systemd preloads
            if self.is_devel_build():
                self.disable_preload("packagekit", "systemd")

            if self.machine.image.startswith('debian') or self.machine.image.startswith('ubuntu'):
                self.libexecdir = '/usr/lib/cockpit'
            else:
                self.libexecdir = '/usr/libexec'

    def nonDestructiveSetup(self):
        '''generic setUp/tearDown for @nondestructive tests'''

        m = self.machine

        # helps with mapping journal output to particular tests
        name = "%s.%s" % (self.__class__.__name__, self._testMethodName)
        m.execute("logger -p user.info 'COCKPITTEST: start %s'" % name)
        self.addCleanup(m.execute, "logger -p user.info 'COCKPITTEST: end %s'" % name)

        # core dumps get copied per-test, don't clobber subsequent tests with them
        self.addCleanup(m.execute, "find /var/lib/systemd/coredump -type f -delete")

        # temporary directory in the VM
        self.addCleanup(m.execute, "if [ -d {0} ]; then findmnt --list --noheadings --output TARGET | grep ^{0} | xargs -r umount && rm -r {0}; fi".format(self.vm_tmpdir))

        # users/groups/home dirs
        self.restore_file("/etc/passwd")
        self.restore_file("/etc/group")
        self.restore_file("/etc/shadow")
        self.restore_file("/etc/gshadow")
        self.restore_file("/etc/subuid")
        self.restore_file("/etc/subgid")
        home_dirs = m.execute("ls /home").strip().split()

        def cleanup_home_dirs():
            for d in m.execute("ls /home").strip().split():
                if d not in home_dirs:
                    m.execute("rm -rf /home/" + d)
        self.addCleanup(cleanup_home_dirs)

        # cockpit configuration
        self.addCleanup(m.execute, "rm -f /etc/cockpit/cockpit.conf")
        self.addCleanup(m.execute, "rm -f /etc/cockpit/machines.d/*")

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
                        "        umount $d || true; dmsetup remove --force $d || true; "
                        "    done; "
                        "    umount /dev/$dev 2>/dev/null || true; "
                        "done; until rmmod scsi_debug; do sleep 1; done")

        # Terminate all lingering Cockpit sessions
        def terminate_sessions():
            sessions = self.machine.execute("loginctl --no-legend list-sessions | awk '/web console/ { print $1 }'").strip().split()
            for s in sessions:
                # Don't insist that terminating works, the session might be gone by now.
                self.machine.execute("loginctl terminate-session %s || true" % s)
                # Wait for it to be no longer active. Sometimes
                # sessions are permanently stuck in state "closing",
                # but that's fine since they won't do any harm.
                m.execute("while loginctl show-session %s | grep -q 'State=active'; do sleep 1; done" % s)

        self.addCleanup(terminate_sessions)

    def tearDown(self):
        if self.checkSuccess() and self.machine.ssh_reachable:
            self.check_journal_messages()
            self.check_browser_errors()
            self.check_pixel_tests()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def login_and_go(self, path=None, user=None, host=None, superuser=True, urlroot=None, tls=False):
        self.machine.start_cockpit(host, tls=tls)
        self.browser.login_and_go(path, user=user, host=host, superuser=superuser, urlroot=urlroot, tls=tls)

    # List of allowed journal messages during tests; these need to match the *entire* message
    default_allowed_messages = [
        # This is a failed login, which happens every time
        "Returning error-response 401 with reason `Sorry'",

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

        # starting out with empty PCP logs and pmlogger not running causes these metrics channel messages
        "pcp-archive: no such metric: kernel.all.cpu.nice: Unknown metric name",
        "pcp-archive: instance name lookup failed:.*",
        "pcp-archive: couldn't create pcp archive context for.*",
    ]

    default_allowed_messages += os.environ.get("TEST_ALLOW_JOURNAL_MESSAGES", "").split(",")

    # List of allowed console.error() messages during tests; these match substrings
    default_allowed_console_errors = [
        # HACK: These should be fixed, but debugging these is not trivial, and the impact is very low
        "Warning: .* setState.*on an unmounted component",
        "Warning: Can't perform a React state update on an unmounted component."
    ]

    default_allowed_console_errors += os.environ.get("TEST_ALLOW_BROWSER_ERRORS", "").split(",")

    def allow_journal_messages(self, *patterns):
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
                                    ".*Broken pipe.*",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Underlying GIOStream returned 0 bytes on an async read \\(g-io-error-quark, 0\\). Exiting.",
                                    "connection unexpectedly closed by peer",
                                    "cockpit-session: .*timed out.*",
                                    "ignoring failure from session process:.*",
                                    "peer did not close io when expected",
                                    "request timed out, closing",
                                    "PolicyKit daemon disconnected from the bus.",
                                    ".*couldn't create polkit session subject: No session for pid.*",
                                    "We are no longer a registered authentication agent.",
                                    ".*: failed to retrieve resource: terminated",
                                    ".*: external channel failed: terminated",
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
        cursor = (machine == self.machine) and self.journal_start or None

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead.

        matches = [
            "SYSLOG_IDENTIFIER=cockpit-ws",
            "SYSLOG_IDENTIFIER=cockpit-bridge",
            "SYSLOG_IDENTIFIER=cockpit/ssh",
            "GLIB_DOMAIN=cockpit-ws",
            "GLIB_DOMAIN=cockpit-bridge",
            "GLIB_DOMAIN=cockpit-ssh",
            "GLIB_DOMAIN=cockpit-pcp"
        ]

        if not self.allow_core_dumps:
            matches += ["SYSLOG_IDENTIFIER=systemd-coredump"]
            self.allowed_messages.append("Resource limits disable core dumping for process.*")

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

    def check_pixel_tests(self):
        if self.browser and self.browser.failed_pixel_tests > 0:
            raise Error("Some pixel tests have failed")

    def check_axe(self, label=None, suffix=""):
        """Run aXe check on the currently active frame

        The report gets written into an attachment
        "<label>-axe-{violations,incomplete}.json". If you specify a suffix, it
        will be appended to the file name, which is useful if you call this
        more than once within one test.
        """

        # Only test Axe on chromium browsers
        if self.browser.cdp.browser.name != "chromium":
            return

        if not checkRunAxe():
            return

        report = self.browser.eval_js("axe.run()", no_trace=True)

        # trim the report
        def delkeys(dict, *keys):
            for key in keys:
                try:
                    del dict[key]
                except KeyError:
                    pass
        delkeys(report, "passes", "inapplicable", "timestamp")

        for outcome in ["violations", "incomplete"]:
            for test in report[outcome]:
                delkeys(test, "tags", "help", "impact")

                # failureSummary in nodes is highly repetitive and long, so summarize it on violation level
                summaries = set()
                for result in test["nodes"]:
                    if "failureSummary" in result:
                        summaries.add(result["failureSummary"])
                    delkeys(result, "all", "any", "none", "impact", "failureSummary")

                    # trim containing iframes from targets
                    if result.get("target", []):
                        result["target"] = result["target"][-1]

                if summaries:
                    test["failureSummaries"] = list(summaries)

        # write the report
        if suffix:
            suffix = "-" + suffix
        filename = "{0}{1}-axe.json.gz".format(label or self.label(), suffix)
        with gzip.open(filename, "wb") as f:
            f.write(json.dumps(report).encode('UTF-8'))
        print("Wrote accessibility report to " + filename)
        attach(filename, move=True)

        # aXe triggers that *shrug*
        self.allow_journal_messages("received invalid message without channel prefix")

    def snapshot(self, title, label=None):
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

    def copy_journal(self, title, label=None):
        for name, m in self.machines.items():
            if m.ssh_reachable:
                log = "%s-%s-%s.log.gz" % (label or self.label(), m.label, title)
                with open(log, "w") as fp:
                    m.execute("journalctl|gzip", stdout=fp)
                    print("Journal extracted to %s" % (log))
                    attach(log, move=True)

    def copy_cores(self, title, label=None):
        if self.allow_core_dumps:
            return
        for name, m in self.machines.items():
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
        '''Wait until CPU usage in the VM settles down

        Wait until the process with the highest CPU usage drops below 20%
        usage. Wait for up to a minute, then return. There is no error if the
        CPU stays busy, as usually a test then should just try to run anyway.
        '''
        for retry in range(20):
            # get the CPU percentage of the most busy process
            busy_proc = self.machine.execute("ps --no-headers -eo pcpu,pid,args | sort -k 1 -n -r | head -n1")
            if float(busy_proc.split()[0]) < 20.0:
                break
            time.sleep(3)

    def sed_file(self, expr, path, apply_change_action=None):
        '''sed a file on primary machine

        This is safe for @nondestructive tests, the file will be restored during cleanup.

        The optional apply_change_action will be run both after sedding and after restoring the file.
        '''
        m = self.machine
        m.execute("sed -i.cockpittest '{0}' {1}".format(expr, path))
        if apply_change_action:
            m.execute(apply_change_action)

        if self.is_nondestructive():
            if apply_change_action:
                self.addCleanup(m.execute, apply_change_action)
            self.addCleanup(m.execute, "mv {0}.cockpittest {0}".format(path))

    def restore_dir(self, path, post_restore_action=None, reboot_safe=False):
        '''Backup/restore a directory for a nondestructive test

        This takes care to not ever touch the original content on disk, but uses transient overlays.
        As this uses a bind mount, it does not work for files that get changed atomically (with mv);
        use restore_file() for these.

        The optional post_restore_action will run after restoring the original content.

        If the directory needs to survive reboot, `reboot_safe=True` needs to be specified; then this
        will just backup/restore the directory instead of bind-mounting, which is less robust.
        '''
        if not self.is_nondestructive() and not self.machine.ostree_image:
            return  # skip for efficiency reasons

        exists = self.machine.execute("if test -e %s; then echo yes; fi" % path).strip() != ""
        if not exists:
            self.addCleanup(self.machine.execute, "rm -rf {0}".format(path))
            return

        backup = os.path.join(self.vm_tmpdir, path.replace('/', '_'))
        self.machine.execute("mkdir -p %(vm_tmpdir)s && cp -a %(path)s/ %(backup)s/" % {
            "vm_tmpdir": self.vm_tmpdir, "path": path, "backup": backup})

        if not reboot_safe:
            self.machine.execute("mount -o bind %(backup)s %(path)s" % {
                "path": path, "backup": backup})

        if post_restore_action:
            self.addCleanup(self.machine.execute, post_restore_action)

        if reboot_safe:
            self.addCleanup(self.machine.execute, "rm -rf {0} && mv {1} {0}".format(path, backup))
        else:
            self.addCleanup(self.machine.execute, "umount -lf " + path)

    def restore_file(self, path, post_restore_action=None):
        '''Backup/restore a file for a nondestructive test

        This is less robust than restore_dir(), but works for files that need to get changed atomically.

        If path does not currently exist, it will be removed again on cleanup.
        '''
        if not self.is_nondestructive():
            return  # skip for efficiency reasons

        exists = self.machine.execute("if test -e %s; then echo yes; fi" % path).strip() != ""
        if exists:
            backup = os.path.join(self.vm_tmpdir, path.replace('/', '_'))
            self.machine.execute("mkdir -p %(vm_tmpdir)s && cp -a %(path)s %(backup)s" % {
                "vm_tmpdir": self.vm_tmpdir, "path": path, "backup": backup})
            if post_restore_action:
                self.addCleanup(self.machine.execute, post_restore_action)
            self.addCleanup(self.machine.execute, "mv %(backup)s %(path)s" % {"path": path, "backup": backup})
        else:
            self.addCleanup(self.machine.execute, "rm -rf %s" % path)

    def write_file(self, path, content, append=False, owner=None, perm=None):
        '''Write a file on primary machine

        This is safe for @nondestructive tests, the file will be removed during cleanup.

        If @append is True, append to existing file instead of replacing it.
        @owner is the desired file owner as chown shell string (e.g. "admin:nogroup")
        @perm is the desired file permission as chmod shell string (e.g. "0600")
        '''
        m = self.machine
        self.restore_file(path)
        m.write(path, content, append=append, owner=owner, perm=perm)


def jsquote(str):
    return json.dumps(str)


def skipBrowser(reason, *args):
    browser = os.environ.get("TEST_BROWSER", "chromium")
    if browser in args:
        return unittest.skip("{0}: {1}".format(browser, reason))
    return generic_metadata_setter("_testlib__skipBrowser", args)


def skipImage(reason, *args):
    if testvm.DEFAULT_IMAGE in args:
        return unittest.skip("{0}: {1}".format(testvm.DEFAULT_IMAGE, reason))
    return generic_metadata_setter("_testlib__skipImage", args)


def skipMobile():
    if bool(os.environ.get("TEST_MOBILE", "")):
        return unittest.skip("mobile: This test breaks on small screen sizes")
    return generic_metadata_setter("_testlib__skipMobile", None)


def skipDistroPackage():
    '''For tests which apply to BaseOS packages

    With that, tests can evolve with latest code, without constantly breaking them when
    running against older package versions in the -distropkg tests.
    '''
    if 'distropkg' in testvm.DEFAULT_IMAGE:
        return unittest.skip(f"{testvm.DEFAULT_IMAGE}: Do not test BaseOS packages")
    return lambda testEntity: set_obj_attribute(testEntity, "_testlib__skipImage", (testvm.DEFAULT_IMAGE, ))


def skipPackage(*args):
    packages_env = os.environ.get("TEST_SKIP_PACKAGES", "").split()
    for package in args:
        if package in packages_env:
            return unittest.skip("{0} is excluded in $TEST_SKIP_PACKAGES".format(package))
    return generic_metadata_setter("_testlib__skipPackage", args)


def nondestructive(testEntity):
    """Tests decorated as nondestructive will all run against the same VM

    Can be used on test classes and individual test methods.
    """
    return set_obj_attribute(testEntity, "_testlib__non_destructive", True, raise_text="The nondestructive decorator can only be used on test classes and test methods", base_class=MachineCase)


def no_retry_when_changed(testEntity):
    """Tests decorated with no_retry_when_changed will only run once if they've been changed

    Tests that have been changed are expected to succeed 3 times, if the test
    takes a long time, this prevents timeouts. Can be used on test classes and
    individual methods.
    """

    if inspect.isclass(testEntity) and issubclass(testEntity, unittest.TestCase):
        for test_function in inspect.getmembers(testEntity, is_test_function):
            test_function[1]._testlib__retry_when_affected = False
    elif is_test_function(testEntity):
        testEntity._testlib__retry_when_affected = False
    else:
        raise Error("The no_retry_when_changed decorator can only be used on test classes and test methods")
    return testEntity


def checkRunAxe():
    # only run this on the default OS test, that's enough
    if os.getenv("TEST_OS") not in [None, testvm.TEST_OS_DEFAULT]:
        return False

    # when running from release tarballs, module is not available
    if not os.path.exists(f'{BASE_DIR}/node_modules/axe-core/axe.js'):
        sys.stderr.write('# enableAxe: axe is not installed, skipping\n')
        return False

    return True


def enableAxe(method):
    """Enable aXe accessibility test code injection for this test case"""

    if not checkRunAxe():
        return method

    def wrapper(*args):
        with open(f'{BASE_DIR}/node_modules/axe-core/axe.js') as f:
            script = f.read()
        # first method argument is "self", a MachineCase instance
        args[0].browser.cdp.invoke("Page.addScriptToEvaluateOnNewDocument", source=script, no_trace=True)
        return method(*args)

    return wrapper


def timeout(seconds):
    """Change default test timeout of 600s, for long running tests

    Can be applied to an individual test method or the entire class. This only
    applies to test/common/run-tests, not to calling check-* directly.
    """
    def wrapper(testEntity):
        testEntity.__timeout = seconds
        return testEntity

    return wrapper


class TapRunner:

    def __init__(self, verbosity=1):
        self.stream = unittest.runner._WritelnDecorator(sys.stderr)
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
            sys.stderr.write("Unexpected exception while running {0}\n".format(test))
            sys.stderr.write(traceback.format_exc())
            return result
        else:
            result.printErrors()

        if result.skipped:
            print("# Result {0} skipped: {1}".format(test, result.skipped[0][1]))
        elif result.wasSuccessful():
            print("# Result {0} succeeded".format(test))
        else:
            for failure in result.failures:
                print(failure[1])
            for error in result.errors:
                print(error[1])
            print("# Result {0} failed".format(test))
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
        details = "[{0}s on {1}]".format(duration, hostname)

        MachineCase.kill_global_machine()

        # Return 77 if all tests were skipped
        if len(skips) == test_count:
            sys.stdout.write("# SKIP {0}\n".format(", ".join(["{0} {1}".format(str(s[0]), s[1]) for s in skips])))
            return 77
        if failures:
            sys.stdout.write("# {0} TEST{1} FAILED {2}\n".format(failures, "S" if failures > 1 else "", details))
            return 1
        else:
            sys.stdout.write("# {0} TEST{1} PASSED {2}\n".format(test_count, "S" if test_count > 1 else "", details))
            return 0


def print_tests(tests):
    for test in tests:
        if isinstance(test, unittest.TestSuite):
            print_tests(test)
        elif isinstance(test, unittest.loader._FailedTest):
            name = test.id().replace("unittest.loader._FailedTest.", "")
            print("Error: '{0}' does not match a test".format(name), file=sys.stderr)
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


def wait(func, msg=None, delay=1, tries=60):
    """
    Wait for FUNC to return something truthy, and return that.

    FUNC is called repeatedly until it returns a true value or until a
    timeout occurs.  In the latter case, a exception is raised that
    describes the situation.  The exception is either the last one
    thrown by FUNC, or includes MSG, or a default message.

    Arguments:
      func: The function to call.
      msg: A error message to use when the timeout occurs.  Defaults
        to a generic message.
      delay: How long to wait between calls to FUNC, in seconds.
        Defaults to 1.
      tries: How often to call FUNC.  Defaults to 60.

    Raises:
      Error: When a timeout occurs.
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


def sit(machines={}):
    """
    Wait until the user confirms to continue.

    The current test case is suspended so that the user can inspect
    the browser.
    """
    for (name, machine) in machines.items():
        sys.stderr.write(machine.diagnose())
    print("Press RET to continue...")
    sys.stdin.readline()
