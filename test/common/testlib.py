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
import subprocess
import os
import select
import shutil
import socket
import sys
import traceback
import random
import re
import json
import tempfile
import time
import unittest
import gzip
import itertools

import tap
import testvm
import cdp

TEST_DIR = os.path.normpath(os.path.dirname(os.path.realpath(os.path.join(__file__, ".."))))
BOTS_DIR = os.path.normpath(os.path.join(TEST_DIR, "..", "bots"))

os.environ["PATH"] = "{0}:{1}:{2}".format(os.environ.get("PATH"), BOTS_DIR, TEST_DIR)

__all__ = (
    # Test definitions
    'test_main',
    'arg_parser',
    'Browser',
    'MachineCase',
    'PersistentMachineCase',
    'skipImage',
    'skipBrowser',
    'allowImage',
    'skipPackage',
    'enableAxe',
    'Error',

    'sit',
    'wait',
    'opts',
    'TEST_DIR',
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


def attach(filename):
    if not opts.attachments:
        return
    dest = os.path.join(opts.attachments, os.path.basename(filename))
    if os.path.exists(filename) and not os.path.exists(dest):
        shutil.move(filename, dest)


class Browser:
    def __init__(self, address, label, port=None):
        if ":" in address:
            (self.address, unused, self.port) = address.rpartition(":")
        else:
            self.address = address
            self.port = 9090
        if port is not None:
            self.port = port
        self.default_user = "admin"
        self.label = label
        path = os.path.dirname(__file__)
        self.cdp = cdp.CDP("C.utf8", verbose=opts.trace, trace=opts.trace,
                           inject_helpers=[os.path.join(path, "test-functions.js"), os.path.join(path, "sizzle.js")])
        self.password = "foobar"

    def title(self):
        return self.cdp.eval('document.title')

    def open(self, href, cookie=None, tls=False):
        """
        Load a page into the browser.

        Arguments:
          href: The path of the Cockpit page to load, such as "/dashboard".

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
        self.cdp.command('expectLoad(%i)' % (self.cdp.timeout * 1000))
        if opts.trace:
            print("<- expect_load done")

    def expect_load_frame(self, name):
        if opts.trace:
            print("-> expect_load_frame " + name)
        self.cdp.command('expectLoadFrame(%s, %i)' % (jsquote(name), self.cdp.timeout * 1000))
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
        else:
            msg = str(details)
        if trailer:
            msg += "\n" + trailer
        raise Error("%s(%s): %s" % (func, arg, msg))

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
        self.mouse(selector + ":not([disabled])", "click", 0, 0, 0)

    def mousedown(self, selector):
        self.mouse(selector + ":not([disabled])", "mousedown", 0, 0, 0)

    def val(self, selector):
        self.wait_visible(selector)
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector, val):
        self.wait_visible(selector + ':not([disabled])')
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector):
        self.wait_visible(selector)
        return self.call_js_func('ph_text', selector)

    def attr(self, selector, attr):
        self.wait_present(selector)
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector, attr, val):
        self.wait_present(selector + ':not([disabled])')
        self.call_js_func('ph_set_attr', selector, attr, val and 'true' or 'false')

    def get_checked(self, selector):
        self.wait_visible(selector + ':not([disabled])')
        return self.call_js_func('ph_get_checked', selector)

    def set_checked(self, selector, val):
        self.wait_visible(selector + ':not([disabled])')
        self.call_js_func('ph_set_checked', selector, val)

    def focus(self, selector):
        self.wait_visible(selector + ':not([disabled])')
        self.call_js_func('ph_focus', selector)

    def blur(self, selector):
        self.wait_visible(selector + ':not([disabled])')
        self.call_js_func('ph_blur', selector)

    # TODO: Unify them so we can have only one
    def key_press(self, keys, modifiers=0, use_ord=False):
        if self.cdp.browser == "chromium":
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
            8: "Backspace",  # Backspace key
            9: "Tab",        # Tab key
            13: "Enter",     # Enter key
            27: "Escape",    # Escape key
            40: "ArrowDown", # Arrow key down
            45: "Insert",    # Insert key
        }
        for key in keys:
            args = {"type": "keyDown", "modifiers": modifiers}

            args["key"] = key
            if ord(key) < 32 or use_ord:
                args["key"] = keyMap[ord(key)]

            self.cdp.invoke("Input.dispatchKeyEvent", **args)
            args["type"] = "keyUp"
            self.cdp.invoke("Input.dispatchKeyEvent", **args)

    def select_from_dropdown(self, selector, value, substring=False):
        # This is a backwards compat helper method; new code should use .set_val()

        self.wait_visible(selector + ':not([disabled])')

        # translate text value into <option value=".."> ID
        text_selector = "{0} option[data-value{1}='{2}']".format(selector, substring and "*" or "", value)
        self.wait_present(text_selector)
        value_id = self.attr(text_selector, "value")
        self.set_val(selector, value_id)
        self.wait_val(selector, value_id)

    def set_input_text(self, selector, val, append=False, value_check=True):
        self.focus(selector)
        if not append:
            self.key_press("a", 2) # Ctrl + a
        if val == "":
            self.key_press("\b") # Backspace
        else:
            self.key_press(val)

        if value_check:
            self.wait_val(selector, val)

    def set_file_autocomplete_val(self, identifier, location):
        file_item_selector_template = "#{0} li a:contains({1})"

        path = ''
        index = 0
        for path_part in filter(None, location.split('/')):
            path += '/' + path_part
            file_item_selector = file_item_selector_template.format(identifier, path_part)
            self.click("label[for={0}] + div input[type=text]".format(identifier))
            self.click(file_item_selector)
            if index != len(list(filter(None, location.split('/')))) - 1 or location[-1] == '/':
                self.wait_val("label[for={0}] + div input[type=text]".format(identifier), path + '/')
            else:
                self.wait_val("label[for={0}] + div input[type=text]".format(identifier), path)
            index += 1

        self.wait_val("label[for={0}] + div input[type=text]".format(identifier), location)

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
        for _ in range(self.cdp.timeout * 5):
            val = predicate()
            if val:
                return val
            time.sleep(0.2)
        raise Error('timed out waiting for predicate to become true')

    def wait_js_cond(self, cond):
        result = self.cdp.invoke("Runtime.evaluate",
                                 expression="ph_wait_cond(() => %s, %i)" % (cond, self.cdp.timeout * 1000),
                                 silent=False, awaitPromise=True, trace="wait: " + cond)
        if "exceptionDetails" in result:
            trailer = "\n".join(self.cdp.get_js_log())
            self.raise_cdp_exception("timeout\nwait_js_cond", cond, result["exceptionDetails"], trailer)

    def wait_js_func(self, func, *args):
        self.wait_js_cond("%s(%s)" % (func, ','.join(map(jsquote, args))))

    def is_present(self, selector):
        return self.call_js_func('ph_is_present', selector)

    def wait_present(self, selector):
        self.wait_js_func('ph_is_present', selector)

    def wait_not_present(self, selector):
        self.wait_js_func('!ph_is_present', selector)

    def is_visible(self, selector):
        return self.call_js_func('ph_is_visible', selector)

    def wait_visible(self, selector):
        self.wait_present(selector)
        self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector, val):
        self.wait_visible(selector)
        self.wait_js_func('ph_has_val', selector, val)

    def wait_not_val(self, selector, val):
        self.wait_visible(selector)
        self.wait_js_func('!ph_has_val', selector, val)

    def wait_attr(self, selector, attr, val):
        self.wait_present(selector)
        self.wait_js_func('ph_has_attr', selector, attr, val)

    def wait_attr_contains(self, selector, attr, val):
        self.wait_present(selector)
        self.wait_js_func('ph_attr_contains', selector, attr, val)

    def wait_attr_not_contains(self, selector, attr, val):
        self.wait_present(selector)
        self.wait_js_func('!ph_attr_contains', selector, attr, val)

    def wait_not_attr(self, selector, attr, val):
        self.wait_present(selector)
        self.wait_js_func('!ph_has_attr', selector, attr, val)

    def wait_not_visible(self, selector):
        self.wait_js_func('!ph_is_visible', selector)

    def wait_in_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('ph_in_text', selector, text)

    def wait_not_in_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('!ph_in_text', selector, text)

    def wait_collected_text(self, selector, text):
        self.wait_js_func('ph_collected_text_is', selector, text)

    def wait_text(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('ph_text_is', selector, text)

    def wait_text_not(self, selector, text):
        self.wait_visible(selector)
        self.wait_js_func('!ph_text_is', selector, text)

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

    def dialog_complete(self, sel, button=".btn-primary", result="hide"):
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

    def dialog_cancel(self, sel, button=".btn[data-dismiss='modal']"):
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
                self.wait_present("iframe.container-frame[name='%s'][data-loaded]" % frame)
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
        self.wait_present("body")
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

    def login_and_go(self, path=None, user=None, host=None, authorized=True, urlroot=None, tls=False):
        if user is None:
            user = self.default_user
        href = path
        if not href:
            href = "/"
        if urlroot:
            href = urlroot + href
        if host:
            href = "/@" + host + href
        self.open(href, tls=tls)
        self.wait_visible("#login")
        self.set_val('#login-user-input', user)
        self.set_val('#login-password-input', self.password)
        self.set_checked('#authorized-input', authorized)

        self.click('#login-button')
        self.expect_load()
        self.wait_present('#content')
        self.wait_visible('#content')
        if path:
            self.enter_page(path.split("#")[0], host=host)

    def logout(self):
        self.switch_to_top()
        self.wait_present("#navbar-dropdown")
        self.wait_visible("#navbar-dropdown")
        if self.is_visible("button#machine-reconnect"):
            # happens when shutting down cockpit or rebooting machine
            self.click("button#machine-reconnect")
        else:
            # happens when cockpit is still running
            self.click("#navbar-dropdown")
            self.click('#go-logout')
        self.expect_load()

    def relogin(self, path=None, user=None, authorized=None):
        if user is None:
            user = self.default_user
        self.logout()
        self.wait_visible("#login")
        self.set_val("#login-user-input", user)
        self.set_val("#login-password-input", self.password)
        if authorized is not None:
            self.set_checked('#authorized-input', authorized)
        self.click('#login-button')
        self.expect_load()
        self.wait_present('#content')
        self.wait_visible('#content')
        if path:
            if path.startswith("/@"):
                host = path[2:].split("/")[0]
            else:
                host = None
            self.enter_page(path.split("#")[0], host=host)

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
            if self.cdp.browser == "chromium":
                ret = self.cdp.invoke("Page.captureScreenshot", no_trace=True)
                if "data" in ret:
                    with open(filename, 'wb') as f:
                        f.write(base64.standard_b64decode(ret["data"]))
                    attach(filename)
                    print("Wrote screenshot to " + filename)
                else:
                    print("Screenshot not available")
            elif self.cdp.browser == "firefox":
                # API not yet supported
                # https://bugzilla.mozilla.org/show_bug.cgi?id=1549466
                # TODO: Possible workaround could be something like:
                # Runtime.execute(':screenshot --file <path>)
                pass

            filename = "{0}-{1}.html".format(label or self.label, title)
            html = self.cdp.invoke("Runtime.evaluate", expression="document.documentElement.outerHTML",
                                   no_trace=True)["result"]["value"]
            with open(filename, 'wb') as f:
                f.write(html.encode('UTF-8'))
            attach(filename)
            print("Wrote HTML dump to " + filename)

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
            attach(filename)
            print("Wrote JS log to " + filename)

    def kill(self):
        self.cdp.kill()


class BaseCase(unittest.TestCase):
    image = testvm.DEFAULT_IMAGE
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

    def label(self):
        (unused, sep, label) = self.id().partition(".")
        return label.replace(".", "-")

    def new_machine(self, image=None, forward={}, restrict=True, cleanup=True, **kwargs):
        machine_class = self.machine_class
        if image is None:
            image = self.image
        if opts.address:
            if machine_class or forward:
                raise unittest.SkipTest("Cannot run this test when specific machine address is specified")
            machine = testvm.Machine(address=opts.address, image=image, verbose=opts.trace, browser=opts.browser)
            if cleanup:
                self.addCleanup(lambda: machine.disconnect())
        else:
            if not machine_class:
                machine_class = testvm.VirtMachine
            if not self.network:
                network = testvm.VirtNetwork(image=image)
                if cleanup:
                    self.addCleanup(lambda: network.kill())
                self.network = network
            networking = self.network.host(restrict=restrict, forward=forward)
            machine = machine_class(verbose=opts.trace, networking=networking, image=image, **kwargs)
            if opts.fetch and not os.path.exists(machine.image_file):
                machine.pull(machine.image_file)
            if cleanup:
                self.addCleanup(lambda: machine.kill())
        return machine

    def new_browser(self, machine=None):
        if machine is None:
            machine = self.machine
        label = self.label() + "-" + machine.label
        browser = Browser(machine.web_address, label=label, port=machine.web_port)
        self.addCleanup(lambda: browser.kill())
        return browser

    def checkSuccess(self):
        if self._outcome:
            # errors is a list of (method, exception) calls (usually multiple
            # per method); None exception means success
            return not any(e[1] for e in self._outcome.errors)

        if not self.currentResult:
            return False
        for error in self.currentResult.errors:
            if self == error[0]:
                return False
        for failure in self.currentResult.failures:
            if self == failure[0]:
                return False
        for success in self.currentResult.unexpectedSuccesses:
            if self == success:
                return False
        for skipped in self.currentResult.skipped:
            if self == skipped[0]:
                return False
        return True

    def run(self, result=None):
        self.currentResult = result

        # Here's the loop to actually retry running the test. It's an awkward
        # place for this loop, since it only applies to MachineCase based
        # TestCases. However for the time being there is no better place for it.
        #
        # Policy actually dictates retries.  The number here is an upper bound to
        # prevent endless retries if Policy.check_retry is buggy.
        max_retry_hard_limit = 10
        for retry in range(0, max_retry_hard_limit):
            try:
                super().run(result)
            except RetryError as ex:
                assert retry < max_retry_hard_limit
                sys.stderr.write("{0}\n".format(ex))
                sleep(retry * 10)
            else:
                break

        self.currentResult = None

    def setUp(self):
        if self.machine:
            self.journal_start = self.machine.journal_cursor()
            self.browser = self.new_browser()

        def sitter():
            if opts.sit and not self.checkSuccess():
                if self._outcome:
                    [traceback.print_exception(*e[1]) for e in self._outcome.errors if e[1]]
                else:
                    self.currentResult.printErrors()
                sit(self.machines)
        self.addCleanup(sitter)

        def intercept():
            if not self.checkSuccess():
                self.snapshot("FAIL")
                self.copy_js_log("FAIL")
                self.copy_journal("FAIL")
                self.copy_cores("FAIL")
        self.addCleanup(intercept)

    def tearDown(self):
        if self.checkSuccess() and self.machine.ssh_reachable:
            self.check_journal_messages()
            self.check_browser_errors()

    def login_and_go(self, path=None, user=None, host=None, authorized=True, urlroot=None, tls=False):
        self.machine.start_cockpit(host, tls=tls)
        self.browser.login_and_go(path, user=user, host=host, authorized=authorized, urlroot=urlroot, tls=tls)

    allow_core_dumps = False

    # Whitelist of allowed journal messages during tests; these need to match the *entire* message
    allowed_messages = [
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

        # Will go away with glib 2.43.2
        ".*: couldn't write web output: Error sending data: Connection reset by peer",

        # pam_lastlog outdated complaints
        ".*/var/log/lastlog: No such file or directory",

        # ssh messages may be dropped when closing
        '10.*: dropping message while waiting for child to exit',

        # SELinux messages to ignore
        "(audit: )?type=1403 audit.*",
        "(audit: )?type=1404 audit.*",
        # happens on Atomic (https://bugzilla.redhat.com/show_bug.cgi?id=1298157)
        "(audit: )?type=1400 audit.*: avc:  granted .*",

        # https://bugzilla.redhat.com/show_bug.cgi?id=1242656
        "(audit: )?type=1400 .*denied.*comm=\"cockpit-ws\".*name=\"unix\".*dev=\"proc\".*",
        "(audit: )?type=1400 .*denied.*comm=\"ssh-transport-c\".*name=\"unix\".*dev=\"proc\".*",
        "(audit: )?type=1400 .*denied.*comm=\"cockpit-ssh\".*name=\"unix\".*dev=\"proc\".*",

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
    ]

    # Whitelist of allowed console.error() messages during tests; these match substrings
    allowed_console_errors = [
        # HACK: These should be fixed, but debugging these is not trivial, and the impact is very low
        "Warning: .* setState.*on an unmounted component",
        "Warning: Can't perform a React state update on an unmounted component."
    ]

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal contains a entry completely matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_hostkey_messages(self):
        self.allow_journal_messages('.*: .* host key for server is not known: .*',
                                    '.*: refusing to connect to unknown host: .*',
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

    def allow_authorize_journal_messages(self):
        self.allow_journal_messages("cannot reauthorize identity.*:.*unix-user:admin.*",
                                    "cannot reauthorize identity\(s\).*:.*unix-user:.*",
                                    ".*: pam_authenticate failed: Authentication failure",
                                    ".*is not in the sudoers file.  This incident will be reported.",
                                    ".*: a password is required",
                                    "user user was reauthorized",
                                    "sudo: no password was provided",
                                    "sudo: unable to resolve host .*",
                                    "sudo: unable to open /run/sudo/ts/unpriv: Permission denied",
                                    "sudo: unable to stat /var/db/sudo: Permission denied",
                                    ".*: sorry, you must have a tty to run sudo",
                                    ".*/pkexec: bridge exited",
                                    "We trust you have received the usual lecture from the local System",
                                    "Administrator. It usually boils down to these three things:",
                                    "#1\) Respect the privacy of others.",
                                    "#2\) Think before you type.",
                                    "#3\) With great power comes great responsibility.",
                                    ".*Sorry, try again.",
                                    ".*incorrect password attempt.*")

    def check_journal_messages(self, machine=None):
        """Check for unexpected journal entries."""
        machine = machine or self.machine
        # on main machine, only consider journal entries since test case start
        cursor = (machine == self.machine) and self.journal_start or None
        syslog_ids = ["cockpit-ws", "cockpit-bridge"]
        if not self.allow_core_dumps:
            syslog_ids += ["systemd-coredump"]
        messages = machine.journal_messages(syslog_ids, 5, cursor=cursor)
        if "TEST_AUDIT_NO_SELINUX" not in os.environ:
            messages += machine.audit_messages("14", cursor=cursor) # 14xx is selinux

        if self.image in ['fedora-31', 'fedora-30', 'fedora-testing', 'fedora-i386']:
            # Fedora >= 30 switched to dbus-broker
            self.allowed_messages.append("dbus-daemon didn't send us a dbus address; not installed?.*")

        if self.image in ['rhel-8-2', 'rhel-8-2-distropkg']:
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1753991
            self.allowed_messages.append('.*type=1400.*avc:  denied  { dac_override } .* comm="rhsmd" .* scontext=system_u:system_r:rhsmcertd_t:s0-s0:c0.c1023 tcontext=system_u:system_r:rhsmcertd_t:.*')

        all_found = True
        first = None
        for m in messages:
            # remove leading/trailing whitespace
            m = m.strip()
            # Ignore empty lines
            if not m:
                continue
            found = False
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
            raise Error("FAIL: Test completed, but found unexpected journal messages:\n" + first)

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
                raise Error(log)

    def check_axe(self, label=None, suffix=""):
        """Run aXe check on the currently active frame

        The report gets written into an attachment
        "<label>-axe-{violations,incomplete}.json". If you specify a suffix, it
        will be appended to the file name, which is useful if you call this
        more than once within one test.
        """
        # only run this on the default OS test, that's enough
        if os.getenv("TEST_OS") not in [None, testvm.TEST_OS_DEFAULT]:
            return
        # HACK: We cannot test axe on Firefox since `axe.run()` returns promise
        # and Firefox CDP cannot wait for it to resolve
        if self.browser.cdp.browser == "firefox":
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
        attach(filename)

        # aXe triggers that *shrug*
        self.allow_journal_messages("received invalid message without channel prefix")

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.browser is not None:
            self.browser.snapshot(title, label)

    def copy_js_log(self, title, label=None):
        if self.browser is not None:
            self.browser.copy_js_log(title, label)

    def copy_journal(self, title, label=None):
        for name, m in self.machines.items():
            if m.ssh_reachable:
                log = "%s-%s-%s.log" % (label or self.label(), m.label, title)
                with open(log, "w") as fp:
                    m.execute("journalctl", stdout=fp)
                    print("Journal extracted to %s" % (log))
                    attach(log)

    def copy_cores(self, title, label=None):
        for name, m in self.machines.items():
            if m.ssh_reachable:
                directory = "%s-%s-%s.core" % (label or self.label(), m.label, title)
                dest = os.path.abspath(directory)
                m.download_dir("/var/lib/systemd/coredump", dest)
                try:
                    os.rmdir(dest)
                except OSError as ex:
                    if ex.errno == errno.ENOTEMPTY:
                        print("Core dumps downloaded to %s" % (dest))
                        attach(dest)


class MachineCase(BaseCase):
    def setUp(self):
        if opts.address and self.provision is not None:
            raise unittest.SkipTest("Cannot provision multiple machines if a specific machine address is specified")

        self.machine = None
        self.browser = None
        self.machines = {}
        provision = self.provision or {'machine1': {}}

        # First create all machines, wait for them later
        for key in sorted(provision.keys()):
            options = provision[key].copy()
            if 'address' in options:
                del options['address']
            if 'dns' in options:
                del options['dns']
            if 'dhcp' in options:
                del options['dhcp']
            machine = self.new_machine(**options)
            self.machines[key] = machine

            if not self.machine:
                self.machine = machine
            if opts.trace:
                print("Starting {0} {1}".format(key, machine.label))
            machine.start()

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

        self.tmpdir = tempfile.mkdtemp()
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmpdir)


class PersistentMachineCase(BaseCase):
    @classmethod
    def setUpClass(cls):
        if cls.provision is not None:
            raise unittest.SkipTest("Cannot provision machines on a PersistentMachineCase")

        cls.machine = None
        cls.browser = None
        cls.machine_options = {}

        # First create the machine, wait for it later
        cls.machine = cls.new_machine(cls, cleanup=False, **cls.machine_options)
        if opts.trace:
            print("Starting {0} {1}".format('machine1', cls.machine.label))
        cls.machine.start()
        cls.machine.wait_boot()
        cls.tmpdir = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        if cls.network:
            cls.network.kill()
        if cls.machine and opts.address:
            cls.machine.disconnect()
        else:
            cls.machine.kill()
        shutil.rmtree(cls.tmpdir)


def jsquote(str):
    return json.dumps(str)


def skipBrowser(reason, *args):
    browser = os.environ.get("TEST_BROWSER", "chromium")
    if browser in args:
        return unittest.skip("{0}: {1}".format(browser, reason))
    return lambda func: func


def skipImage(reason, *args):
    if testvm.DEFAULT_IMAGE in args:
        return unittest.skip("{0}: {1}".format(testvm.DEFAULT_IMAGE, reason))
    return lambda func: func


def allowImage(reason, *args):
    if testvm.DEFAULT_IMAGE not in args:
        return unittest.skip("{0}: {1}".format(testvm.DEFAULT_IMAGE, reason))
    return lambda func: func


def skipPackage(*args):
    packages_env = os.environ.get("TEST_SKIP_PACKAGES", "").split()
    for package in args:
        if package in packages_env:
            return unittest.skip("{0} is excluded in $TEST_SKIP_PACKAGES".format(package))
    return lambda func: func


def enableAxe(method):
    """Enable aXe accessibility test code injection for this test case"""

    # only run this on the default OS test, that's enough
    if os.getenv("TEST_OS") not in [None, testvm.TEST_OS_DEFAULT]:
        return method

    def wrapper(*args):
        with open(os.path.join(TEST_DIR, "common/axe.js")) as f:
            script = f.read()
        # first method argument is "self", a MachineCase instance
        args[0].browser.cdp.invoke("Page.addScriptToEvaluateOnNewDocument", source=script, no_trace=True)
        return method(*args)

    return wrapper


class TestResult(tap.TapResult):
    def __init__(self, stream, descriptions, verbosity):
        self.policy = None
        super().__init__(verbosity)

    def startTest(self, test):
        sys.stdout.write("# {0}\n# {1}\n#\n".format('-' * 70, str(test)))
        sys.stdout.flush()
        super().startTest(test)

    def stopTest(self, test):
        sys.stdout.write("\n")
        sys.stdout.flush()
        super().stopTest(test)


class OutputBuffer(object):
    def __init__(self):
        self.poll = select.poll()
        self.buffers = {}
        self.fds = {}

    def drain(self):
        while self.fds:
            for p in self.poll.poll(1000):
                data = os.read(p[0], 1024)
                if data == b"":
                    self.poll.unregister(p[0])
                else:
                    self.buffers[p[0]] += data
            else:
                break

    def push(self, pid, fd):
        self.poll.register(fd, select.POLLIN)
        self.fds[pid] = fd
        self.buffers[fd] = b""

    def pop(self, pid):
        fd = self.fds.pop(pid)
        buffer = self.buffers.pop(fd)
        try:
            self.poll.unregister(fd)
        except KeyError:
            pass
        while True:
            data = os.read(fd, 1024)
            if data == b"":
                break
            buffer += data
        os.close(fd)
        return buffer


class TapRunner(object):
    resultclass = TestResult

    def __init__(self, verbosity=1, jobs=1, thorough=False):
        self.stream = unittest.runner._WritelnDecorator(sys.stderr)
        self.verbosity = verbosity
        self.thorough = thorough
        self.jobs = jobs

    def runOne(self, test, offset):
        result = TestResult(self.stream, False, self.verbosity)
        result.offset = offset
        try:
            test(result)
        except KeyboardInterrupt:
            return False
        except Exception:
            sys.stderr.write("Unexpected exception while running {0}\n".format(test))
            sys.stderr.write(traceback.print_exc())
            return False
        else:
            result.printErrors()
            return result.wasSuccessful()

    def run(self, testable, testable_no_flatten):
        """Run tests.

        Arguments:
          testable: List of TestSuite instances which will be flattened so they
            run concurrently.
          testable_no_flatten: List of TestSuite instances will be run serially
            after the suites in testable.
        """
        ts = unittest.TestSuite(testable)
        ts.addTests(testable_no_flatten)
        tap.TapResult.plan(ts)

        # Flatten the tests we can run concurrently into a single list
        tests = []

        def flatten(test, tests):
            if test.countTestCases() == 1:
                tests.append(test)
            else:
                for t in test:
                    flatten(t, tests)
        flatten(testable, tests)

        # Now setup the count we have
        count = len(tests)
        for i, test in enumerate(tests):
            setattr(test, "tapOffset", i)

        # For statistics
        start = time.time()

        pids = {}
        options = 0
        buffer = None
        if not self.thorough and self.verbosity <= 1:
            buffer = OutputBuffer()
            options = os.WNOHANG
        failures = {"count": 0}

        def join_some(n):
            while len(pids) > n:
                if buffer:
                    buffer.drain()
                try:
                    (pid, code) = os.waitpid(-1, options)
                except KeyboardInterrupt:
                    sys.exit(255)
                if code & 0xff:
                    failed = 1
                else:
                    failed = (code >> 8) & 0xff
                if pid:
                    if buffer:
                        output = buffer.pop(pid)
                        test = pids[pid]
                        failed, retry = self.filterOutput(test, failed, output)
                        if retry:
                            tests.append(test)
                    del pids[pid]
                failures["count"] += failed

        while True:
            join_some(self.jobs - 1)

            # run the no_flatten serially
            if not tests and testable_no_flatten:
                tests = testable_no_flatten
                self.jobs = 1

            if not tests:
                join_some(0)

                # See if we inserted more tests
                if not tests:
                    break

            # The next test to test
            test = tests.pop()

            # Fork off a child process for each test
            if buffer:
                (rfd, wfd) = os.pipe()

            sys.stdout.flush()
            sys.stderr.flush()
            pid = os.fork()
            if not pid:
                if buffer:
                    os.dup2(wfd, 1)
                    os.dup2(wfd, 2)
                random.seed()
                offset = getattr(test, "tapOffset", 0)
                if self.runOne(test, offset):
                    sys.exit(0)
                else:
                    sys.exit(1)

            # The parent process
            pids[pid] = test
            if buffer:
                os.close(wfd)
                buffer.push(pid, rfd)

        # Report on the results
        duration = int(time.time() - start)
        hostname = socket.gethostname().split(".")[0]
        details = "[{0}s on {1}]".format(duration, hostname)
        count = failures["count"]
        if count:
            sys.stdout.write("# {0} TESTS FAILED {1}\n".format(count, details))
        else:
            sys.stdout.write("# TESTS PASSED {0}\n".format(details))
        return count

    def filterOutput(self, test, failed, output):
        # Check how many retries we can do of this test
        tries = getattr(test, "retryCount", 0)
        tries += 1
        setattr(test, "retryCount", tries)

        # Didn't fail, just print output and continue
        if not failed:
            sys.stdout.buffer.write(output)
            return failed, False

        # Otherwise pass through this command if it exists
        cmd = ["tests-policy", testvm.DEFAULT_IMAGE]
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            (changed, unused) = proc.communicate(output)
            if proc.returncode == 0:
                output = changed
        except OSError as ex:
            if ex.errno != errno.ENOENT:
                sys.stderr.write("Couldn't run tests-policy: {0}\n".format(str(ex)))

        # Just retry failures always (but maximum 3 times), we don't need to be precious about flakes
        if b"# SKIP " not in output and tries < 3:
            output += b"\n# RETRY \n"

        # Write the output bytes
        sys.stdout.buffer.write(output)

        if b"# SKIP " in output or b"# RETRY" in output:
            failed = 0

        # Whether we should retry the test or not
        return failed, b"# RETRY " in output


def print_tests(tests):
    for test in tests:
        if isinstance(test, unittest.TestSuite):
            print_tests(test)
        elif isinstance(test, unittest.loader._FailedTest):
            name = test.id().replace("unittest.loader._FailedTest.", "")
            print("Error: '{0}' does not match a test".format(name), file=sys.stderr)
        else:
            print(test.id().replace("__main__.", ""))


def arg_parser():
    parser = argparse.ArgumentParser(description='Run Cockpit test(s)')
    parser.add_argument('-j', '--jobs', dest="jobs", type=int,
                        default=os.environ.get("TEST_JOBS", 1), help="Number of concurrent jobs")
    parser.add_argument('-v', '--verbose', dest="verbosity", action='store_const',
                        const=2, help='Verbose output')
    parser.add_argument('-t', "--trace", dest='trace', action='store_true',
                        help='Trace machine boot and commands')
    parser.add_argument('-q', '--quiet', dest='verbosity', action='store_const',
                        const=0, help='Quiet output')
    parser.add_argument('--thorough', dest='thorough', action='store_true',
                        help='Thorough mode, no skipping known issues')
    parser.add_argument('-s', "--sit", dest='sit', action='store_true',
                        help="Sit and wait after test failure")
    parser.add_argument('--nonet', dest="fetch", action="store_false",
                        help="Don't go online to download images or data")
    parser.add_argument('tests', nargs='*')
    parser.add_argument("-l", "--list", action="store_true", help="Print the list of tests that would be executed")

    parser.set_defaults(verbosity=1, fetch=True)
    return parser


def test_main(options=None, suite=None, persistent_machine_suites=[], attachments=None, **kwargs):
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

    if opts.sit and opts.jobs > 1:
        parser.error("the -s or --sit argument not avalible with multiple jobs")

    opts.address = getattr(opts, "address", None)
    opts.browser = getattr(opts, "browser", None)
    opts.attachments = os.environ.get("TEST_ATTACHMENTS", attachments)
    if opts.attachments:
        os.makedirs(opts.attachments, exist_ok=True)

    import __main__

    def leaf_classes(base_class, exclude=None):
        subclasses = base_class.__subclasses__()
        if base_class == exclude:
            return []
        if not subclasses:
            return [base_class]
        # Filter out all the subclasses that aren't defined under test/verify
        return [klass for klass in itertools.chain(*[leaf_classes(subkl, exclude) for subkl in subclasses])
                if klass.__module__ == "__main__"]

    # Collect unittest.TestCase and MachineCase tests into a single suite so they can be run concurrently
    # Collect PersistentMachineCase tests into an array of suites (persistent_machine_suites), these we run serially
    machine_cases = []
    if len(opts.tests) > 0:
        if suite:
            parser.error("tests may not be specified when running a predefined test suite")
        # Because specifying multiple methods belonging to the same
        # PersistentMachineCase is possible, collect the methods given into a
        # single array before loading them
        persistent_tests = {}
        for test in opts.tests:
            klass = test.split('.')[0]
            for machine_case in leaf_classes(unittest.TestCase, exclude=PersistentMachineCase):
                if klass == machine_case.__qualname__:
                    machine_cases.append(unittest.TestSuite(
                        unittest.TestLoader().loadTestsFromName(test, module=__main__)))
            for persistent_machine_case in leaf_classes(PersistentMachineCase):
                if klass == persistent_machine_case.__qualname__:
                    persistent_tests.setdefault(klass, []).append(test)
        for klass in persistent_tests:
            persistent_machine_suites.append(unittest.TestSuite(
                unittest.TestLoader().loadTestsFromNames(persistent_tests[klass], module=__main__)))
        suite = unittest.TestSuite(machine_cases)
    elif not suite and not persistent_machine_suites:
        for machine_case in leaf_classes(unittest.TestCase, exclude=PersistentMachineCase):
            machine_cases.append(unittest.TestLoader().loadTestsFromTestCase(machine_case))
        for persistent_machine_case in leaf_classes(PersistentMachineCase):
            persistent_machine_suites.append(
                unittest.TestSuite(
                    unittest.TestLoader().loadTestsFromTestCase(persistent_machine_case)))
        suite = unittest.TestSuite(machine_cases)

    if options.list:
        print_tests(suite)
        for s in persistent_machine_suites:
            print()
            print_tests(s)
        return 0

    runner = TapRunner(verbosity=opts.verbosity, jobs=opts.jobs, thorough=opts.thorough)
    ret = runner.run(suite, persistent_machine_suites)
    if not standalone:
        return ret
    sys.exit(ret)


class Error(Exception):
    def __init__(self, msg):
        self.msg = msg

    def __str__(self):
        return self.msg


class RetryError(Error):
    pass


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
