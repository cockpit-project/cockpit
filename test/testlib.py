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
import signal
import tempfile
import unittest
try:
    import testvm
except ImportError:
    print "Unable to import testvm, probably new test struture?"
    pass

class Timeout:
    def __init__(self, seconds=1, error_message='Timeout'):
        self.seconds = seconds
        self.error_message = error_message
    def handle_timeout(self, signum, frame):
        raise Exception(self.error_message)
    def __enter__(self):
        signal.signal(signal.SIGALRM, self.handle_timeout)
        signal.alarm(self.seconds)
    def __exit__(self, type, value, traceback):
        signal.alarm(0)

__all__ = (
    # Test definitions
    'test_main',
    'Browser',
    'MachineCase',

    'sit',

    'wait',
    'RepeatThis',

    # Random utilities
    'merge'
    )

class RepeatThis(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

topdir = os.path.normpath(os.path.dirname(__file__))

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

    def open(self, href):
        """
        Load a page into the browser.

        Arguments:
          page: The path of the Cockpit page to load, such as "/dashboard".
          url: The full URL to load.

        Either PAGE or URL needs to be given.

        Raises:
          Error: When a timeout occurs waiting for the page to load.
        """
        if href.startswith("/"):
            href = "http://%s:9090%s" % (self.address, href)

        def tryopen(hard=False):
            try:
                if self.phantom:
                    self.phantom.kill()
                self.phantom = Phantom("en_US.utf8")
                self.phantom.open(href)
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

    def reload(self):
        self.switch_to_top()
        self.wait_js_cond("ph_select('iframe.container-frame').every(function (e) { return e.getAttribute('data-loaded'); })")
        self.phantom.reload(self.phantom_wait_timeout)

    def expect_reload(self):
        self.phantom.expect_reload(self.phantom_wait_timeout)

    def switch_to_frame(self, name):
        self.phantom.switch_to_frame(name)

    def switch_to_top(self):
        self.phantom.switch_to_top()

    def upload_file(self, selector, file):
        self.phantom.upload_file(selector, file)

    def eval_js(self, code):
        return self.phantom.do(code)

    def call_js_func(self, func, *args):
        return self.phantom.do("return %s(%s);" % (func, ','.join(map(jsquote, args))))

    def go(self, hash, host="localhost"):
        # if not hash.startswith("/@"):
        #    hash = "/@" + host + hash
        self.call_js_func('ph_go', hash)

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

    def arm_timeout(self):
        return self.phantom.arm_timeout(timeout=self.phantom_wait_timeout)

    def disarm_timeout(self):
        return self.phantom.disarm_timeout()

    def wait_checkpoint(self):
        return self.phantom.wait_checkpoint()

    def dialog_complete(self, sel, button=".btn-primary", result="hide"):
        self.click(sel + " " + button)
        self.wait_not_present(sel + " .dialog-wait")

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
                For old cockpit this may be an old style page identifier.
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
                self.wait_visible("iframe.container-frame[name='%s']" % frame)
                break
            except Error, ex:
                if reconnect and ex.msg == 'timeout':
                    reconnect = False
                    if self.is_present(".curtains button"):
                        self.click(".curtains button", True)
                        self.wait_not_visible(".curtains")
                        continue
                raise exc_info[0], exc_info[1], exc_info[2]

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

    def login_and_go(self, path=None, user=None, host=None):
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
        self.set_val('#login-password-input', "foobar")
        self.click('#login-button')
        self.expect_reload()
        self.wait_present('#content')
        self.wait_visible('#content')
        if path:
            self.enter_page(path.split("#")[0], host=host)

    def logout(self):
        self.switch_to_top()
        self.click("#content-user-name")
        self.click('#go-logout')
        self.expect_reload()

    def relogin(self, path=None, user=None):
        if user is None:
            user = self.default_user
        self.logout()
        self.wait_visible("#login")
        self.set_val("#login-user-input", user)
        self.set_val("#login-password-input", "foobar")
        self.click('#login-button')
        self.expect_reload()
        self.wait_present('#content')
        self.wait_visible('#content')
        if path:
            if path.startswith("/@"):
                host = path[2:].split("/")[0]
            else:
                host = None
            self.enter_page(path.split("#")[0], host=host)

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.phantom:
            self.phantom.show(file="%s-%s-%s.png" % (program_name, label or self.label, title))

    def kill(self):
        if self.phantom:
            self.phantom.kill()
        self.phantom = None

class MachineCase(unittest.TestCase):
    runner = None
    machine_class = testvm.VirtMachine
    machine = None
    machines = [ ]

    def new_machine(self, flavor=None, system=None):
        (unused, sep, label) = self.id().rpartition(".")
        m = self.machine_class(verbose=arg_trace, flavor=flavor, system=system, label="%s-%s" % (program_name, label))
        self.addCleanup(lambda: m.kill())
        self.machines.append(m)
        return m

    def new_browser(self, address=None):
        (unused, sep, label) = self.id().rpartition(".")
        browser = Browser(address = address or self.machine.address, label=label)
        self.addCleanup(lambda: browser.kill())
        return browser

    def setUp(self, macaddr=None):
        self.machine = self.new_machine()
        self.machine.start(macaddr=macaddr)
        if arg_trace:
            print "starting machine %s" % (self.machine.address)
        self.machine.wait_boot()
        self.browser = self.new_browser()
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        if self.runner and not self.runner.wasSuccessful():
            self.snapshot("FAIL")
            self.copy_journal("FAIL")
            if arg_sit_on_failure:
                for f in self.runner.failures:
                    print >> sys.stderr, f[1]
                for e in self.runner.errors:
                    print >> sys.stderr, e[1]
                print >> sys.stderr, "ADDRESS: %s" % self.machine.address
                sit()
        elif self.machine.address:
            self.check_journal_messages()
        shutil.rmtree(self.tmpdir)

    def wait_for_cockpit_running(self, atomic_wait_for_host="localhost"):
        """Wait until cockpit is running.

        We only need to do this on atomic systems.
        On other systems, systemctl blocks until the service is actually running.
        """
        if not "atomic" in self.machine.os or not atomic_wait_for_host:
            return
        WAIT_COCKPIT_RUNNING = """#!/bin/sh
until curl -s --connect-timeout 1 http://%s:9090 >/dev/null; do
    sleep 0.5;
done;
""" % (atomic_wait_for_host)
        with Timeout(seconds=30, error_message="Timeout while waiting for cockpit/ws to start"):
            self.machine.execute(script=WAIT_COCKPIT_RUNNING)

    def start_cockpit(self, atomic_wait_for_host="localhost"):
        """Start Cockpit.

        Cockpit is not running when the test virtual machine starts up, to
        allow you to make modifications before it starts.
        """
        if "atomic" in self.machine.os:
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1228776
            # we want to run:
            # self.machine.execute("atomic run cockpit/ws --no-tls")
            # but atomic doesn't forward the parameter, so we use the resulting command
            # also we need to wait for cockpit to be up and running
            RUN_COCKPIT_CONTAINER = """#!/bin/sh
systemctl start docker
/usr/bin/docker run -d --privileged --pid=host -v /:/host cockpit/ws /container/atomic-run --local-ssh --no-tls
"""
            with Timeout(seconds=30, error_message="Timeout while waiting for cockpit/ws to start"):
                self.machine.execute(script=RUN_COCKPIT_CONTAINER)
                self.wait_for_cockpit_running(atomic_wait_for_host)
        else:
            self.machine.execute("systemctl start cockpit-testing.socket")

    def restart_cockpit(self):
        """Restart Cockpit.
        """
        if "atomic" in self.machine.os:
            with Timeout(seconds=30, error_message="Timeout while waiting for cockpit/ws to restart"):
                self.machine.execute("docker restart `docker ps | grep cockpit/ws | awk '{print $1;}'`")
                self.wait_for_cockpit_running()
        else:
            self.machine.execute("systemctl restart cockpit-testing.socket")

    def login_and_go(self, path, user=None, host=None):
        self.start_cockpit(host)
        self.browser.login_and_go(path, user=user, host=host)

    allowed_messages = [
        # This is a failed login, which happens every time
        "Returning error-response 401 with reason `Sorry'",

        # Reauth stuff
        '.*Reauthorizing unix-user:.*',
        '.*user .* was reauthorized',
        'cockpit-polkit helper exited with status: 0',

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

        # SELinux messages to ignore
        "(audit: )?type=1403 audit.*",
        "(audit: )?type=1404 audit.*",
    ]

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal containes a entry matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_restart_journal_messages(self):
        self.allow_journal_messages(".*Connection reset by peer.*",
                                    ".*Broken pipe.*",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Underlying GIOStream returned 0 bytes on an async read \\(g-io-error-quark, 0\\). Exiting.",
                                    # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1141137
                                    "localhost: bridge program failed: Child process killed by signal 9",
                                    "request timed out, closing",
                                    "PolicyKit daemon disconnected from the bus.",
                                    "We are no longer a registered authentication agent.",
                                    ".*: failed to retrieve resource: terminated",
                                    # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1253319
                                    'audit:.*denied.*2F6D656D66643A73642D73797374656D642D636F726564756D202864656C.*',
                                    )

    def allow_authorize_journal_messages(self):
        self.allow_journal_messages("cannot reauthorize identity.*:.*unix-user:admin.*",
                                    "Error executing command as another user: Not authorized",
                                    "This incident has been reported.",
                                    ".*: a password is required",
                                    "user user was reauthorized",
                                    ".*: sorry, you must have a tty to run sudo"
                                    )


    def check_journal_messages(self, machine=None):
        """Check for unexpected journal entries."""
        machine = machine or self.machine
        syslog_ids = [ "cockpit-ws", "cockpit-bridge" ]
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
        cmd = [
            "%s/phantom-driver" % topdir,
            "%s/sizzle.js" % topdir,
            "%s/phantom-lib.js" % topdir
        ]
        self.driver = subprocess.Popen(cmd, env=environ,
                                       stdout=subprocess.PIPE, stdin=subprocess.PIPE, close_fds=True)
        self.frame = None

    def run(self, args):
        if arg_trace:
            print "->", repr(args)[:200]
        self.driver.stdin.write(json.dumps(args).replace("\n", " ")+ "\n")
        line = self.driver.stdout.readline()
        if arg_trace:
            print "<-", line.strip()
        res = json.loads(line)
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

    def reload(self, timeout):
        status = self.run({'cmd': 'reload', 'timeout': timeout*1000})
        if status != "success":
            raise Error(status)

    def expect_reload(self, timeout):
        status = self.run({'cmd': 'expect-reload', 'timeout': timeout*1000})
        if status != "success":
            raise Error(status)

    def inject(self, file):
        if not self.run({'cmd': 'inject', 'file': file}):
            raise Error("failed")

    def switch_to_frame(self, name):
        return self.run({'cmd': 'switch', 'name': name})

    def switch_to_top(self):
        return self.run({'cmd': 'switch_top'})

    def upload_file(self, selector, file):
        return self.run({'cmd': 'upload', 'file': file, 'selector': selector})

    def do(self, code):
        return self.run({'cmd': 'do', 'code': code})

    def wait(self, cond, timeout):
        return self.run({'cmd': 'wait', 'cond': cond, 'timeout': timeout*1000})

    def arm_timeout(self, timeout):
        return self.run({'cmd': 'armtimeout', 'timeout': timeout*1000 })

    def disarm_timeout(self):
        return self.run({'cmd': 'disarmtimeout' })

    def wait_checkpoint(self):
        return self.run({'cmd': 'waitcheckpoint' })

    def show(self, file="page.png"):
        if not self.run({'cmd': 'show', 'file': file}):
            raise "failed"
        print "Wrote %s" % file

    def keys(self, type, keys):
        self.run({'cmd': 'keys', 'type': type, 'keys': keys })

    def quit(self):
        self.run({'cmd': 'ping'})
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

    tries = 0
    repeat_this = True
    while repeat_this and tries < 5:
        runner = unittest.TextTestRunner(verbosity=args.verbosity, failfast=True, resultclass=Result)
        result = runner.run(suite)
        repeat_this = False
        for e in result.errors:
            if "RepeatThis: " in e[1]:
                repeat_this = True
        tries += 1

    if repeat_this:
        print "Not repeating after %d spurious failures" % tries

    sys.exit(not result.wasSuccessful())

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
