# -*- coding: utf-8 -*-

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

import tap
import testvm
import cdp

TEST_DIR = os.path.normpath(os.path.dirname(os.path.realpath(os.path.join(__file__, ".."))))
BOTS_DIR = os.path.normpath(os.path.join(TEST_DIR, "..", "bots"))
_PY3 = sys.version_info[0] >= 3

os.environ["PATH"] = "{0}:{1}:{2}".format(os.environ.get("PATH"), BOTS_DIR, TEST_DIR)

__all__ = (
    # Test definitions
    'test_main',
    'arg_parser',
    'Browser',
    'MachineCase',
    'skipImage',
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

    def open(self, href, cookie=None):
        """
        Load a page into the browser.

        Arguments:
          href: The path of the Cockpit page to load, such as "/dashboard".

        Either PAGE or URL needs to be given.

        Raises:
          Error: When a timeout occurs waiting for the page to load.
        """
        if href.startswith("/"):
            href = "http://%s:%s%s" % (self.address, self.port, href)

        if cookie:
            self.cdp.invoke("Network.setCookie", **cookie)
        self.switch_to_top()
        self.cdp.invoke("Page.navigate", url=href)
        self.expect_load()

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
                return c["value"]
        return None

    def go(self, hash, host="localhost"):
        # if not hash.startswith("/@"):
        #    hash = "/@" + host + hash
        self.call_js_func('ph_go', hash)

    def mouse(self, selector, type_):
        self.eval_js("ph_mouse_event(ph_find('%s'), '%s')" % (selector, type_))

    def click(self, selector, force=False):
        self.call_js_func('ph_click', selector, force)

    def val(self, selector):
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector, val):
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector):
        return self.call_js_func('ph_text', selector)

    def attr(self, selector, attr):
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector, attr, val):
        self.call_js_func('ph_set_attr', selector, attr, val and 'true' or 'false')

    def set_checked(self, selector, val):
        self.call_js_func('ph_set_checked', selector, val)

    def focus(self, selector):
        self.call_js_func('ph_focus', selector)

    def blur(self, selector):
        self.call_js_func('ph_blur', selector)

    def key_press(self, keys):
        for k in keys:
            if k == "Backspace":
                self.cdp.invoke("Input.dispatchKeyEvent", type="keyDown", windowsVirtualKeyCode=8)
            elif k.isalnum():
                self.cdp.invoke("Input.dispatchKeyEvent", type="char", text=k, key=k)
            else:
                self.cdp.invoke("Input.dispatchKeyEvent", type="char", text=k)

    def set_input_text(self, selector, val):
        self.set_val(selector, "")
        self.focus(selector)
        if val == "":
            # We need some real action for React to emit change signals
            self.key_press([ " ", "Backspace" ])
        else:
            self.key_press(val)
        self.wait_val(selector, val)
        self.blur(selector)

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
        return self.wait_js_func('ph_is_present', selector)

    def wait_not_present(self, selector):
        return self.wait_js_func('!ph_is_present', selector)

    def is_visible(self, selector):
        return self.call_js_func('ph_is_visible', selector)

    def wait_visible(self, selector):
        return self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector, val):
        return self.wait_js_func('ph_has_val', selector, val)

    def wait_not_val(self, selector, val):
        return self.wait_js_func('!ph_has_val', selector, val)

    def wait_attr(self, selector, attr, val):
        return self.wait_js_func('ph_has_attr', selector, attr, val)

    def wait_not_attr(self, selector, attr, val):
        return self.wait_js_func('!ph_has_attr', selector, attr, val)

    def wait_not_visible(self, selector):
        return self.wait_js_func('!ph_is_visible', selector)

    def wait_in_text(self, selector, text):
        return self.wait_js_func('ph_in_text', selector, text)

    def wait_not_in_text(self, selector, text):
        return self.wait_js_func('!ph_in_text', selector, text)

    def wait_text(self, selector, text):
        return self.wait_js_func('ph_text_is', selector, text)

    def wait_text_not(self, selector, text):
        return self.wait_js_func('!ph_text_is', selector, text)

    def wait_popup(self, id):
        """Wait for a popup to open.

        Arguments:
          id: The 'id' attribute of the popup.
        """
        self.wait_visible('#' + id);

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
                        self.click("#machine-reconnect", True)
                        self.wait_not_visible(".curtains-ct")
                        continue
                raise

        self.switch_to_frame(frame)
        self.wait_present("body")
        self.wait_visible("body")

    def leave_page(self):
        self.switch_to_top()

    def wait_action_btn(self, sel, entry):
        self.wait_text(sel + ' button:first-child', entry);

    def click_action_btn(self, sel, entry=None):
        # We don't need to open the menu, it's enough to simulate a
        # click on the invisible button.
        if entry:
            self.click(sel + ' a:contains("%s")' % entry, True);
        else:
            self.click(sel + ' button:first-child');

    def login_and_go(self, path=None, user=None, host=None, authorized=True):
        if user is None:
            user = self.default_user
        href = path
        if not href:
            href = "/"
        if host:
            href = "/@" + host + href
        self.open(href)
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

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG and HTML.

        Arguments:
            title: Used for the filename.
        """
        if self.cdp and self.cdp.valid:
            filename = "{0}-{1}.png".format(label or self.label, title)
            ret = self.cdp.invoke("Page.captureScreenshot", no_trace=True)
            if "data" in ret:
                with open(filename, 'wb') as f:
                    f.write(base64.standard_b64decode(ret["data"]))
                attach(filename)
                print("Wrote screenshot to " + filename)
            else:
                print("Screenshot not available")

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


class MachineCase(unittest.TestCase):
    image = testvm.DEFAULT_IMAGE
    runner = None
    machine = None
    machines = { }
    machine_class = None
    browser = None
    network = None

    # provision is a dictionary of dictionaries, one for each additional machine to be created, e.g.:
    # provision = { 'openshift' : { 'image': 'openshift', 'memory_mb': 1024 } }
    # These will be instantiated during setUp, and replaced with machine objects
    provision = None

    def label(self):
        (unused, sep, label) = self.id().partition(".")
        return label.replace(".", "-")

    def new_machine(self, image=None, forward={ }, **kwargs):
        import testvm
        machine_class = self.machine_class
        if image is None:
            image = self.image
        if opts.address:
            if machine_class or forward:
                raise unittest.SkipTest("Cannot run this test when specific machine address is specified")
            machine = testvm.Machine(address=opts.address, image=image, verbose=opts.trace, browser=opts.browser)
            self.addCleanup(lambda: machine.disconnect())
        else:
            if not machine_class:
                machine_class = testvm.VirtMachine
            if not self.network:
                network = testvm.VirtNetwork()
                self.addCleanup(lambda: network.kill())
                self.network = network
            networking = self.network.host(restrict=True, forward=forward)
            machine = machine_class(verbose=opts.trace, networking=networking, image=image, **kwargs)
            if opts.fetch and not os.path.exists(machine.image_file):
                machine.pull(machine.image_file)
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
        if _PY3 and self._outcome:
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
        if not _PY3:
            orig_result = result

            # We need a result to intercept, so create one here
            if result is None:
                result = self.defaultTestResult()
                startTestRun = getattr(result, 'startTestRun', None)
                if startTestRun is not None:
                    startTestRun()

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
                super(MachineCase, self).run(result)
            except RetryError as ex:
                assert retry < max_retry_hard_limit
                sys.stderr.write("{0}\n".format(ex))
                sleep(retry * 10)
            else:
                break

        self.currentResult = None

        if not _PY3:
            # Standard book keeping that we have to do
            if orig_result is None:
                stopTestRun = getattr(result, 'stopTestRun', None)
                if stopTestRun is not None:
                    stopTestRun()

    def setUp(self):
        if opts.address and self.provision is not None:
            raise unittest.SkipTest("Cannot provision multiple machines if a specific machine address is specified")

        self.machine = None
        self.browser = None
        self.machines = { }
        provision = self.provision or { 'machine1': { } }

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

        def sitter():
            if opts.sit and not self.checkSuccess():
                if _PY3 and self._outcome:
                    [traceback.print_exception(*e[1]) for e in self._outcome.errors if e[1]]
                else:
                    self.currentResult.printErrors()
                sit(self.machines)
        self.addCleanup(sitter)

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
            self.browser = self.new_browser()
        self.tmpdir = tempfile.mkdtemp()

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
            self.check_browser_messages()
        shutil.rmtree(self.tmpdir)

    def login_and_go(self, path=None, user=None, host=None, authorized=True):
        self.machine.start_cockpit(host)
        self.browser.login_and_go(path, user=user, host=host, authorized=authorized)

    allow_core_dumps = False

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
        # HACK: affects *all* tests, impractical for a naughty (https://bugzilla.redhat.com/show_bug.cgi?id=1461893)
        "type=1401 audit(.*): op=security_compute_av reason=bounds .* tclass=process.*",

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

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal contains a entry matching the given regexp"""
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
                                    'audit:.*denied.*comm="systemd-user-se".*nologin.*',

                                    'localhost: dropping message while waiting for child to exit',
                                    '.*: GDBus.Error:org.freedesktop.PolicyKit1.Error.Failed: .*',
                                    '.*g_dbus_connection_call_finish_internal.*G_IS_DBUS_CONNECTION.*',
                                    '.*Message recipient disconnected from message bus without replying.*',
                                    )

    def allow_authorize_journal_messages(self):
        self.allow_journal_messages("cannot reauthorize identity.*:.*unix-user:admin.*",
                                    "cannot reauthorize identity\(s\).*:.*unix-user:.*",
                                    ".*: pam_authenticate failed: Authentication failure",
                                    ".*is not in the sudoers file.  This incident will be reported.",
                                    ".*: a password is required",
                                    "user user was reauthorized",
                                    "sudo: unable to resolve host .*",
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
        syslog_ids = [ "cockpit-ws", "cockpit-bridge" ]
        if not self.allow_core_dumps:
            syslog_ids += [ "systemd-coredump" ]
        messages = machine.journal_messages(syslog_ids, 5)
        if "TEST_AUDIT_NO_SELINUX" not in os.environ:
            messages += machine.audit_messages("14") # 14xx is selinux

        # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1557913
        # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1563143
        # these fail tons of tests due to the SELinux violations (so naughty override causes too much spamming)
        if self.image in ['fedora-28', 'fedora-atomic', 'fedora-testing', 'fedora-i386']:
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { dac_override }.*')
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { module_request }.*')
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { getattr } for .* comm="which" path="/usr/sbin/setfiles".*')

        if self.image in ['fedora-29']:
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { getattr } for .* comm="which" path="/usr/sbin/setfiles".*')
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1608030
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { create } for .* comm="ebtables".*firewalld_t.*')
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1571377
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { .* } for .* path="/dev/random" .*')
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { read } for .* name="random" .*')

        if self.image == 'rhel-x':
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1559820
            # this affects every boot (so naughty override causes too much spamming)
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { create } for  pid=1 comm="systemd" name="bpf".*')
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1573501
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { create } for .*comm="nft" .*firewalld_t.*')
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1571377
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { .* } for .* path="/dev/random" .*')
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { read } for .* name="random" .*')
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1629588
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { read } for .* comm="agetty" name="motd".*')
            self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied  { read } for .* comm="sshd" name="motd".*')

        # these images don't have tuned; keep in sync with bots/images/scripts/debian.setup
        if self.image in ["ubuntu-1604", "debian-stable"]:
            self.allowed_messages.append('com.redhat.tuned: .*org.freedesktop.DBus.Error.ServiceUnknown.*')

        all_found = True
        first = None
        for m in messages:
            # remove leading/trailing whitespace
            m = m.strip()
            found = False
            for p in self.allowed_messages:
                match = re.match(p, m)
                if match and match.group(0) == m:
                    found = True
                    break
            if not found:
                all_found = False
                if not first:
                    print("Unexpected journal messages:")
                    first = m
                print(m)
        if not all_found:
            self.copy_js_log("FAIL")
            self.copy_journal("FAIL")
            self.copy_cores("FAIL")
            raise Error(first)

    def check_browser_messages(self):
        if not self.browser:
            return
        for log in self.browser.get_js_log():
            if log.startswith("error: uncaught"):
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

some_failed = False

def jsquote(str):
    return json.dumps(str)

def skipImage(reason, *args):
    if testvm.DEFAULT_IMAGE in args:
        return unittest.skip("{0}: {1}".format(testvm.DEFAULT_IMAGE, reason))
    return lambda func: func

def skipPackage(*args):
    packages_env = os.environ.get("TEST_SKIP_PACKAGES","").split()
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
        args[0].browser.cdp.invoke("Page.addScriptToEvaluateOnLoad", scriptSource=script, no_trace=True)
        return method(*args)

    return wrapper


class TestResult(tap.TapResult):
    def __init__(self, stream, descriptions, verbosity):
        self.policy = None
        super(TestResult, self).__init__(verbosity)

    def startTest(self, test):
        sys.stdout.write("# {0}\n# {1}\n#\n".format('-' * 70, str(test)))
        sys.stdout.flush()
        super(TestResult, self).startTest(test)

    def stopTest(self, test):
        sys.stdout.write("\n")
        sys.stdout.flush()
        super(TestResult, self).stopTest(test)

class OutputBuffer(object):
    def __init__(self):
        self.poll = select.poll()
        self.buffers = { }
        self.fds = { }

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
        except:
            sys.stderr.write("Unexpected exception while running {0}\n".format(test))
            sys.stderr.write(traceback.print_exc())
            return False
        else:
            result.printErrors()
            return result.wasSuccessful()

    def run(self, testable):
        tap.TapResult.plan(testable)

        tests = [ ]

        # The things to test
        def collapse(test, tests):
            if test.countTestCases() == 1:
                tests.append(test)
            else:
                for t in test:
                    collapse(t, tests)
        collapse(testable, tests)

        # Now setup the count we have
        count = len(tests)
        for i, test in enumerate(tests):
            setattr(test, "tapOffset", i)

        # For statistics
        start = time.time()

        pids = { }
        options = 0
        buffer = None
        if not self.thorough and self.verbosity <= 1:
            buffer = OutputBuffer()
            options = os.WNOHANG
        failures = { "count": 0 }

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
        # "output" is bytes, grab corresponding stream
        out = _PY3 and sys.stdout.buffer or sys.stdout

        # Didn't fail, just print output and continue
        if tries >= 3 or not failed:
            out.write(output)
            return failed, False

        # Otherwise pass through this command if it exists
        cmd = [ "tests-policy", testvm.DEFAULT_IMAGE ]
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            (changed, unused) = proc.communicate(output)
            if proc.returncode == 0:
                output = changed
        except OSError as ex:
            if ex.errno != errno.ENOENT:
                sys.stderr.write("Couldn't run tests-policy: {0}\n".format(str(ex)))

        # Write the output bytes
        out.write(output)

        if b"# SKIP " in output or b"# RETRY" in output:
            failed = 0

        # Whether we should retry the test or not
        return failed, b"# RETRY " in output

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
    if _PY3:
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
        setattr(opts, key, value);

    if opts.sit and opts.jobs > 1:
        parser.error("the -s or --sit argument not avalible with multiple jobs")

    opts.address = getattr(opts, "address", None)
    opts.browser = getattr(opts, "browser", None)
    opts.attachments = os.environ.get("TEST_ATTACHMENTS", attachments)
    if opts.attachments and not os.path.exists(opts.attachments):
        os.makedirs(opts.attachments)

    import __main__
    if len(opts.tests) > 0:
        if suite:
            parser.error("tests may not be specified when running a predefined test suite")
        suite = unittest.TestLoader().loadTestsFromNames(opts.tests, module=__main__)
    elif not suite:
        suite = unittest.TestLoader().loadTestsFromModule(__main__)

    runner = TapRunner(verbosity=opts.verbosity, jobs=opts.jobs, thorough=opts.thorough)
    ret = runner.run(suite)
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
        except:
            if t == tries-1:
                raise
            else:
                pass
        t = t + 1
        sleep(delay)
    raise Error(msg or "Condition did not become true.")

def sit(machines={ }):
    """
    Wait until the user confirms to continue.

    The current test case is suspended so that the user can inspect
    the browser.
    """
    for (name, machine) in machines.items():
        sys.stderr.write(machine.diagnose())
    print("Press RET to continue...")
    sys.stdin.readline()
