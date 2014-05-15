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
from urlparse import urlparse

import argparse
import subprocess
import os
import atexit
import shutil
import sys
import socket
import traceback
import exceptions
import re
import json
import unittest

import testvm

__all__ = (
    # Test definitions
    'test_main',
    'Browser',
    'MachineCase',

    'sit',

    'check',
    'check_eq',
    'check_not_eq',
    'check_in',
    'check_not_in',
    'wait',

    # Random utilities
    'merge'
    )

topdir = os.path.normpath(os.path.dirname(__file__) + "/..")

# Command line options

program_name = "TEST"
arg_sit_on_failure = False
arg_trace = False

class Browser:
    phantom_wait_timeout = 60

    def __init__(self, address, label):
        self.default_user = "admin"
        self.address = address
        self.label = label
        self.phantom = None

    def title(self):
        return self.phantom.do('return document.title');

    def open(self, page=None, url=None, port=1001):
        """
        Load a page into the browser.

        Arguments:
          page: The id of the Cockpit page to load, such as "dashboard".
          url: The full URL to load.

        Either PAGE or URL needs to be given.

        Raises:
          Error: When a timeout occurs waiting for the page to load.
        """
        if page:
            url = "/#%s" % (page, )
        if url.startswith("/"):
            url = "http://%s:%d%s" % (self.address, port, url)

        def tryopen(hard=False):
            try:
                if self.phantom:
                    self.phantom.kill()
                self.phantom = Phantom("en_US.utf8")
                self.phantom.open(url)
                return True
            except:
                if hard:
                    raise
                return False

        tries = 0
        while not tryopen(tries >= 20):
            print "Restarting browser..."
            sleep(0.1)
            tries = tries + 1

        self.init_after_load()

    def init_after_load(self):
        self.phantom.inject("%s/test/phantom-lib.js" % topdir)
        self.phantom.do("ph_init()")

    def reload(self):
        self.phantom.reload()
        self.init_after_load()

    def expect_reload(self):
        self.phantom.expect_reload()
        self.init_after_load()

    def eval_js(self, code):
        return self.phantom.do(code)

    def call_js_func(self, func, *args):
        return self.phantom.do("return %s(%s);" % (func, ','.join(map(jsquote, args))))

    def go(self, hash):
        self.call_js_func('ph_go', hash)

    def click(self, selector):
        self.call_js_func('ph_click', selector)

    def val(self, selector):
        return self.call_js_func('ph_val', selector)

    def set_val(self, selector, val):
        self.call_js_func('ph_set_val', selector, val)

    def text(self, selector):
        return self.call_js_func('ph_text', selector)

    def attr(self, selector, attr):
        return self.call_js_func('ph_attr', selector, attr)

    def set_attr(self, selector, attr, val):
        self.call_js_func('ph_set_attr', selector, attr, val)

    def set_checked(self, selector, val):
        self.call_js_func('ph_set_checked', selector, val)

    def focus(self, selector):
        self.call_js_func('ph_focus', selector)

    def key_press(self, keys):
        return self.phantom.keys('keypress', keys)

    def wait_timeout(self, timeout):
        class WaitParamsRestorer():
            def __init__(self, timeout):
                self.timeout = timeout
            def __enter__(self):
                pass
            def __exit__(self, type, value, traceback):
                self.phantom_wait_timeout = self.timeout
        r = WaitParamsRestorer(self.phantom_wait_timeout)
        self.phantom_wait_timeout = max (timeout, self.phantom_wait_timeout)
        return r

    def inject_js(self, code):
        self.phantom.do(code);

    def wait_js_cond(self, cond):
        return self.phantom.wait(cond, timeout=self.phantom_wait_timeout)

    def wait_js_func(self, func, *args):
        return self.phantom.wait("%s(%s)" % (func, ','.join(map(jsquote, args))), timeout=self.phantom_wait_timeout)

    def wait_visible(self, selector):
        return self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector, val):
        return self.wait_js_func('ph_has_val', selector, val)

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

    # TODO: This code needs to be migrated away from dbus-json1
    def wait_dbus_ready(self, client_address = "localhost", client_options = { }):
        return self.wait_js_func('ph_dbus_ready', client_address, client_options)

    def wait_dbus_prop(self, iface, prop, text, client_address = "localhost", client_options = { }):
        return self.wait_js_func('ph_dbus_prop', client_address, client_options, iface, prop, text)

    def wait_dbus_object_prop(self, path, iface, prop, text, client_address = "localhost", client_options = { }):
        return self.wait_js_func('ph_dbus_object_prop', client_address, client_options, path, iface, prop, text)

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

    def wait_page(self, id):
        """Wait for a page to become current.

        Arguments:
            id: The 'id' attribute of the page.
        """
        self.wait_visible('#content')
        self.wait_visible('#' + id)
        self.wait_dbus_ready()

    def wait_action_btn(self, sel, entry):
        self.wait_text(sel + ' button:first-child', entry);

    def click_action_btn(self, sel, entry=None):
        # We don't need to open the menu, it's enough to simulate a
        # click on the invisible button.
        if entry:
            self.click(sel + ' a:contains("%s")' % entry);
        else:
            self.click(sel + ' button:first-child');

    def login_and_go(self, page, user=None):
        if user is None:
            user = self.default_user
        self.open(page)
        self.wait_visible("#login")
        self.set_val('#login-user-input', user)
        self.set_val('#login-password-input', "foobar")
        self.click('#login-button')
        self.wait_page(page)

    def logout(self):
        self.click('a[onclick*="cockpit_logout"]')
        self.expect_reload()

    def relogin(self, page, user=None):
        if user is None:
            user = self.default_user
        self.logout()
        self.wait_visible("#login")
        self.set_val("#login-user-input", user)
        self.set_val("#login-password-input", "foobar")
        self.click('#login-button')
        self.wait_page(page)

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.phantom:
            self.phantom.show(file="%s-%s-%s.png" % (program_name, label or self.label, title))

class MachineCase(unittest.TestCase):
    runner = None
    machine_class = testvm.QemuMachine
    machine = None
    machines = [ ]

    def new_machine(self, flavor=None):
        m = self.machine_class(verbose=arg_trace, flavor=flavor)
        self.addCleanup(lambda: m.kill())
        self.machines.append(m)
        return m

    def new_browser(self, address=None):
        (unused, sep, label) = self.id().rpartition(".")
        return Browser(address = address or self.machine.address, label=label)

    def setUp(self):
        self.machine = self.new_machine()
        self.machine.start()
        self.machine.wait_boot()
        self.browser = self.new_browser()

    def tearDown(self):
        if self.runner and not self.runner.wasSuccessful():
            self.snapshot("FAIL")
            self.copy_journal("FAIL")
            if arg_sit_on_failure:
                print >> sys.stderr, "ADDRESS: %s" % self.machine.address
                sit()
        if self.machine.address:
            self.check_journal_messages()

    def start_cockpit(self):
        """Start Cockpit.

        Cockpit is not running when the test virtual machine starts up, to
        allow you to make modifications before it starts.
        """
        self.machine.execute("systemctl start cockpit-testing.socket")

    def login_and_go(self, page, user=None):
        self.start_cockpit()
        self.browser.login_and_go(page, user)

    allowed_messages = [
        # This is a failed login, which happens every time
        "Returning error-response 401 with reason `Sorry'",

        # Reboots are ok
        "-- Reboot --",

        # Sometimes D-Bus goes away before us during shutdown
        "Lost \\(or failed to acquire\\) the name com.redhat.Cockpit on the system message bus",
        "GLib-GIO:ERROR:gdbusobjectmanagerserver\\.c:.*:g_dbus_object_manager_server_emit_interfaces_.*: assertion failed \\(error == NULL\\): The connection is closed \\(g-io-error-quark, 18\\)",
        "Error sending message: The connection is closed",
        "Error receiving data: Connection reset by peer",

        ## Bugs

        # https://bugs.freedesktop.org/show_bug.cgi?id=70540
        ".*ActUserManager: user .* has no username.*",

        # https://github.com/cockpit-project/cockpit/issues/48
        "Failed to load '.*': Key file does not have group 'Unit'",

        # https://github.com/cockpit-project/cockpit/issues/115
        "cockpit-testing\\.service: main process exited, code=exited, status=1/FAILURE",
        "Unit cockpit-testing\\.service entered failed state\\.",

        # https://bugs.freedesktop.org/show_bug.cgi?id=71092
        "logind\\.KillUser failed \\(Input/output error\\), trying systemd\\.KillUnit",

        # SELinux messages to ignore
        "type=1403 audit.*",
        "type=1404 audit.*",
        "type=1400 audit.*denied.*nologin.*system_u:system_r:sshd_t:s0-s0:c0.c1023.*",
    ]

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal containes a entry matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def check_journal_messages(self, machine=None):
        """Check for unexpected journal entries."""
        machine = machine or self.machine
        syslog_ids = [ "cockpitd", "cockpit-ws" ]
        messages = machine.journal_messages(syslog_ids, 5)
        messages += machine.audit_messages("14") # 14xx is selinux
        all_found = True
        for m in messages:
            found = False
            for p in self.allowed_messages:
                match = re.match(p, m)
                if match and match.group(0) == m:
                    found = True
                    break
            if not found:
                print "Unexpected journal message '%s'" % m
                all_found = False
        if not all_found:
            self.copy_journal("FAIL")
            raise Error("There were unexpected journal messages")

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        self.browser.snapshot(title, label)

    def copy_journal(self, title, label=None):
        if label is None:
            (unused, sep, label) = self.id().rpartition(".")
        for m in self.machines:
            if m.address:
                dir = "%s-%s-%s-%s.journal" % (program_name, label, m.address, title)
                m.download_dir("/var/log/journal", dir)
                print "Journal database copied to %s" % (dir)

some_failed = False

def jsquote(str):
    return json.dumps(str)

class Phantom:
    def __init__(self, lang=None):
        environ = os.environ.copy()
        if lang:
            environ["LC_ALL"] = lang
        self.driver = subprocess.Popen([ "%s/test/phantom-driver" % topdir ], env=environ,
                                       stdout=subprocess.PIPE, stdin=subprocess.PIPE)

    def run(self, args):
        if arg_trace:
            print "->", args
        self.driver.stdin.write(json.dumps(args).replace("\n", " ")+ "\n")
        res = json.loads(self.driver.stdout.readline())
        if arg_trace:
            print "<-", res
        if 'error' in res:
            raise Error(res['error'])
        if 'timeout' in res:
            raise Error("timeout")
        if 'result' in res:
            return res['result']
        raise Error("unexpected")

    def open(self, url):
        status = self.run({'cmd': 'open', 'url': url})
        if status != "success":
            raise Error(status)

    def reload(self):
        status = self.run({'cmd': 'reload'})
        if status != "success":
            raise Error(status)

    def expect_reload(self):
        status = self.run({'cmd': 'expect-reload'})
        if status != "success":
            raise Error(status)

    def inject(self, file):
        if not self.run({'cmd': 'inject', 'file': file}):
            raise Error("failed")

    def do(self, code):
        return self.run({'cmd': 'do', 'code': code})

    def wait(self, cond, timeout):
        return self.run({'cmd': 'wait', 'cond': cond, 'timeout': timeout*1000})

    def show(self, file="page.png"):
        if not self.run({'cmd': 'show', 'file': file}):
            raise "failed"
        print "Wrote %s" % file

    def keys(self, type, keys):
        self.run({'cmd': 'keys', 'type': type, 'keys': keys })

    def quit(self):
        self.driver.stdin.close()
        self.driver.wait()

    def kill(self):
        self.driver.terminate()
        self.driver.wait()

def test_main():
    """
    Run all test cases, as indicated by 'args'.

    If no arguments are given on the command line, all test cases are
    executed.  Otherwise only the given test cases are run.
    """

    global program_name
    global arg_trace
    global arg_sit_on_failure

    class Result(unittest.TextTestResult):
        def startTest(self, test):
            test.runner = self
            unittest.TextTestResult.startTest(self, test)
        def stopTest(self, test):
            unittest.TextTestResult.stopTest(self, test)
            test.runner = None

    program_name = os.path.basename (sys.argv[0])

    parser = argparse.ArgumentParser(description='Run Cockpit test')
    parser.add_argument('-v', '--verbose', dest="verbosity", action='store_const',
                        const=2, help='Verbose output')
    parser.add_argument('-t', dest='trace', action='store_true',
                        help='Trace machine boot and commands')
    parser.add_argument('-q', '--quiet', dest='verbosity', action='store_const',
                        const=0, help='Quiet output')
    parser.add_argument('-s', dest='sit', action='store_true')
    parser.add_argument('--vm-start-hook', help='Machine start hook')
    parser.add_argument('tests', nargs='*')

    parser.set_defaults(verbosity=1)
    args = parser.parse_args()

    arg_trace = args.trace
    arg_sit_on_failure = args.sit

    import __main__
    if len(args.tests) > 0:
        suite = unittest.TestLoader().loadTestsFromNames(args.tests, module=__main__)
    else:
        suite = unittest.TestLoader().loadTestsFromModule(__main__)
    runner = unittest.TextTestRunner(verbosity=args.verbosity, failfast=True, resultclass=Result)
    result = runner.run(suite)
    sys.exit(not result.wasSuccessful())

class Error(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

def wait(func, msg=None, delay=0.2, tries=20):
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
        Defaults to 0.2.
      tries: How often to call FUNC.  Defaults to 20.

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

def check(cond, msg=None):
    if not cond:
        raise Error(msg or "Condition is not true")
    else:
        return True

def check_eq(val, expected, source = "Value"):
    return check (val == expected, "%s is '%s', not '%s' as expected" % ( source, val, expected ))

def check_not_eq(val, expected, source = "Value"):
    return check (val != expected, "%s is '%s', not something else as expected" % ( source, val ))

def check_in(val, expected, source = "Value"):
    return check (expected in val, "%s is '%s', which doesn't include '%s' as expected" % ( source, val, expected ))

def check_not_in(val, expected, source = "Value"):
    return check (expected not in val, "%s is '%s', which includes '%s', but that isn't expected" % ( source, val, expected ))

def sit():
    """
    Wait until the user confirms to continue.

    The current test case is suspended so that the user can inspect
    the browser.
    """
    raw_input ("Press RET to continue... ")

def merge(*args):
    return dict(reduce(lambda x,y: x + y, map(lambda d: d.items(), args), [ ]))

def shesc(str):
    return "'" + str.replace("'", "'\\''") + "'"
