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

from time import sleep # Browser class (timeouts)
import subprocess      # opening Phantom driver
import os
import traceback 
import re       # journal matching
import json     # Phantom
import logging  # debug output in classes
from avocado.utils import process # Journal output



#topdir = "/usr/share/avocado/tests/lib"
topdir=os.path.dirname(os.path.abspath(__file__))
# Command line options

log=logging.getLogger("Browser")
program_name = "TEST"
arg_sit_on_failure = False
arg_trace = False

admins_only_pam = """
#%PAM-1.0
auth       required     pam_sepermit.so
auth       substack     password-auth
auth       include      postlogin
auth       optional     pam_reauthorize.so prepare
account    required     pam_nologin.so
account    sufficient   pam_succeed_if.so uid = 0
account    required     pam_succeed_if.so user ingroup wheel
account    include      password-auth
password   include      password-auth
# pam_selinux.so close should be the first session rule
session    required     pam_selinux.so close
session    required     pam_loginuid.so
# pam_selinux.so open should only be followed by sessions to be executed in the user context
session    required     pam_selinux.so open env_params
session    optional     pam_keyinit.so force revoke
session    optional     pam_reauthorize.so prepare
session    include      password-auth
session    include      postlogin
"""

class Browser:
    phantom_wait_timeout = 60

    def __init__(self, address, label):
        self.default_user = "admin"
        self.address = address
        self.label = label
        self.phantom = None
        log.info("TOPDIR is: %s" % topdir)

    def title(self):
        return self.phantom.do('return document.title');

    def open(self, page=None, url=None, port=9090):
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
            if not page.startswith("/"):
                page = "/local/" + page;
            url = "/#%s" % (page, )
        if url.startswith("/"):
            url = "http://%s:%d%s" % (self.address, port, url)

        def tryopen(hard=False):
            try:
                if self.phantom:
                    self.phantom.kill()
                self.phantom = Phantom("en_US.utf8")
                self.phantom.open(url)
                log.info( str(self.phantom))
                return True
            except:
                if hard:
                    raise
                return False

        tries = 0
        while not tryopen(tries >= 20):
            log.info( "Restarting browser...")
            sleep(0.1)
            tries = tries + 1

        self.init_after_load()

    def init_after_load(self):
        # Prevent sizzle from registering with AMD loader, and also claiming the usual global name
        with open("%s/sizzle.v2.1.0.js" % topdir) as file:
            js = "var define = null; " + file.read()
            self.phantom.do(js)
        self.phantom.inject("%s/phantom-lib.js" % topdir)
        self.phantom.do("ph_init()")

    def reload(self):
        self.phantom.reload()
        self.init_after_load()

    def expect_reload(self):
        self.phantom.expect_reload()
        self.init_after_load()

    def switch_to_frame(self, name):
        self.phantom.switch_to_frame(name)
        self.init_after_load()

    def switch_to_parent_frame(self):
        self.phantom.switch_to_parent_frame()

    def eval_js(self, code):
        return self.phantom.do(code)

    def call_js_func(self, func, *args):
        return self.phantom.do("return %s(%s);" % (func, ','.join(map(jsquote, args))))

    def go(self, hash):
        if not hash.startswith("/"):
            hash = "/local/" + hash;
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
        output = self.phantom.wait("%s(%s)" % (func, ','.join(map(jsquote, args))), timeout=self.phantom_wait_timeout)
        log.debug(str(func) + ": " + str(args)+ ": RESULT " + str(output))
        return output

    def wait_present(self, selector):
        return self.wait_js_func('ph_is_present', selector)

    def wait_visible(self, selector):
        return self.wait_js_func('ph_is_visible', selector)

    def wait_val(self, selector, val):
        return self.wait_js_func('ph_has_val', selector, val)

    def wait_attr(self, selector, attr, val):
        return self.wait_js_func('ph_has_attr', selector, attr, val)

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

            id: The identifier the page.  This is either a the id
                attribute for legacy pages, or a string starting with
                "/" for modern pages.
        """
        self.wait_present('#content')
        self.wait_visible('#content')
        if id.startswith("/"):
            self.wait_present("iframe.container-frame[name='%s'][data-loaded]" % id)
            self.switch_to_frame(id)
            self.wait_present("body")
            self.wait_visible("body")
        else:
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

    def login_and_go(self, page, user=None, password="foobar"):
        if user is None:
            user = self.default_user
        self.open(page)
        self.wait_visible("#login")
        self.set_val('#login-user-input', user)
        self.set_val('#login-password-input', password)
        self.click('#login-button')
        self.expect_reload()
        self.wait_page(page)

    def logout(self):
        self.click('a[onclick*="cockpit.logout"]')
        self.expect_reload()

    def relogin(self, page, user=None, password="foobar"):
        if user is None:
            user = self.default_user
        logout()
        self.wait_visible("#login")
        self.set_val("#login-user-input", user)
        self.set_val("#login-password-input", "foobar")
        self.click('#login-button')
        self.expect_reload()
        self.wait_page(page)

    def snapshot(self, title, label=None):
        """Take a snapshot of the current screen and save it as a PNG.

        Arguments:
            title: Used for the filename.
        """
        if self.phantom:
            self.phantom.show(file="%s-%s-%s.png" % (program_name, label or self.label, title))


def jsquote(str):
    return json.dumps(str)

class Phantom:
    def __init__(self, lang=None):
        environ = os.environ.copy()
        if lang:
            environ["LC_ALL"] = lang
        self.driver = subprocess.Popen([ "%s/phantom-driver"  % topdir], env=environ,
                                       stdout=subprocess.PIPE, stdin=subprocess.PIPE)
        self.frame = None

    def run(self, args):
        if arg_trace:
            print "->", repr(args)[:200]
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

    def switch_to_frame(self, name):
        return self.run({'cmd': 'switch', 'name': name})

    def switch_to_top(self):
        return self.run({'cmd': 'switch_top'})

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
