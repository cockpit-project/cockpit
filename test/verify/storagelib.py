#!/usr/bin/python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
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

import os
from testlib import *

def content_action_btn(index):
    return "#content .list-group li:nth-child(%d) .btn-group" % index

class StorageCase(MachineCase):
    def setUp(self):

        if "atomic" in os.getenv("TEST_OS", ""):
            self.skipTest("No storage on Atomic")

        if "debian" in os.getenv("TEST_OS", ""):
            self.skipTest("No storage on Debian (yet)")

        MachineCase.setUp(self)

    def inode(self, f):
        return self.machine.execute("stat -L '%s' -c %%i" % f)

    # Action buttons

    def content_action(self, index, action):
        btn = content_action_btn(index)
        self.browser.wait_present(btn)
        self.browser.click_action_btn(btn, action)

    def content_default_action(self, index, action):
        btn = content_action_btn(index)
        self.browser.wait_present(btn)
        self.browser.wait_action_btn (btn, action)
        self.browser.click_action_btn (btn)

    def content_single_action(self, index, action):
        btn = "#content .list-group li:nth-child(%d) button" % index
        self.browser.wait_present(btn)
        self.browser.wait_text (btn, action)
        self.browser.click (btn)

    # Dialogs

    def dialog_wait_open(self):
        self.browser.wait_present('#dialog')
        self.browser.wait_visible('#dialog')

    def dialog_wait_alert(self, text):
        self.browser.wait_in_text('#dialog .alert-message', text)

    def dialog_field(self, field):
        return '#dialog [data-field="%s"]' % field

    def dialog_val(self, field):
        return self.browser.val(self.dialog_field(field))

    def dialog_set_val(self, field, val):
        if isinstance(val, bool):
            self.browser.set_checked(self.dialog_field(field), val)
        elif isinstance(val, dict):
            for label in val:
                self.dialog_select(field, label, val[label])
        else:
            self.browser.set_val(self.dialog_field(field), val)

    def dialog_set_expander(self, field, val):
        self.browser.call_js_func(
            """(function (sel, val) {
                 if ($(sel).hasClass('collapsed') == val) {
                    $(sel).click();
                 }
            })""", self.dialog_field(field), val)

    def dialog_is_present(self, field, label):
        return self.browser.is_present('%s .checkbox:contains("%s") input' % (self.dialog_field(field), label))

    def dialog_select(self, field, label, val):
        self.browser.set_checked('%s .checkbox:contains("%s") input' % (self.dialog_field(field), label), val)

    def dialog_wait_val(self, field, val):
        self.browser.wait_val(self.dialog_field(field), val)

    def dialog_wait_error(self, field, val):
        # XXX - allow for more than one error
        self.browser.wait_in_text('#dialog .dialog-error', val)

    def dialog_wait_not_visible(self, field):
        self.browser.wait_not_visible(self.dialog_field(field))

    def dialog_apply(self):
        self.browser.click('#dialog [data-action="apply"]')

    def dialog_cancel(self):
        self.browser.click('#dialog [data-dismiss="modal"]')

    def dialog_wait_close(self):
        self.browser.wait_not_present('#dialog')

    def dialog_check(self, expect):
        for f in expect:
            if not self.dialog_val(f) == expect[f]:
                return False
        return True

    def dialog(self, values, expect={}):
        self.dialog_wait_open()
        for f in expect:
            self.dialog_wait_val(f, expect[f])
        for f in values:
            self.dialog_set_val(f, values[f])
        self.dialog_apply()
        self.dialog_wait_close()

    def confirm(self):
        self.dialog({})

    # There is a lot of asynchronous activity in the storage stack.
    # For example, changing fstab or crypttab via the storaged API
    # will not immediately update the Configuration properties of
    # block objects.  The storaged daemon will only do that once it
    # gets a change notification for those files, which happens some
    # time later.  As another example, wiping a block device has to be
    # noticed by udev and be propagated back to the daemon before it
    # updates its properties.
    #
    # Concretely, the tests have to mainly deal with the cases listed
    # below, and we offer some functions to help with that.
    #
    # - Waiting until a expected change to fstab or crypttab has
    #   arrived in storaged.  This is important so that it will mount
    #   filesystems to the expected places, and will clean up fstab in
    #   the expected ways, among other things.
    #
    #   This is done with wait_in_storaged_configuration and
    #   wait_not_in_storaged_configuration.
    #
    # - Waiting until a expected change to fstab or crypttab has
    #   arrived in Cockpit.  This is important so that dialogs will
    #   show the right things, and try to modify the right
    #   configuration.
    #
    #   This is done by repeatedly opening a dialog until it shows the
    #   right values, via dialog_with_retry.
    #
    # - Waiting until a block device is considered 'free' and can be
    #   used as a physical volume or raid member.
    #
    #   This is also done by repeatedly opening a dialog until all
    #   needed block devices are listed.

    def retry(self, setup, check, teardown):
        b = self.browser
        b.arm_timeout()
        while True:
            setup()
            if check():
                break
            teardown()
            b.wait_checkpoint()
        b.disarm_timeout()

    def dialog_with_retry(self, trigger, values, expect):
        def setup():
            trigger()
            self.dialog_wait_open()
        def check():
            if callable(expect):
                return expect()
            else:
                return self.dialog_check(expect)
        def teardown():
            self.dialog_cancel()
            self.dialog_wait_close()
        self.retry(setup, check, teardown)
        if values:
            for f in values:
                self.dialog_set_val(f, values[f])
            self.dialog_apply()
        else:
            self.dialog_cancel()
        self.dialog_wait_close()

    # HACK - sometimes we have to use "storagedctl" and sometimes "storagectl".

    def wait_in_storaged_configuration(self, mount_point):
        wait(lambda: mount_point in self.machine.execute("/usr/bin/storage*ctl dump | grep Configuration"))

    def wait_not_in_storaged_configuration(self, mount_point):
        wait(lambda: mount_point not in self.machine.execute("/usr/bin/storage*ctl dump | grep Configuration"))
