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
import re
from testlib import *

class StorageCase(MachineCase):
    def setUp(self):

        if "atomic" in os.getenv("TEST_OS", ""):
            self.skipTest("No storage on Atomic")

        MachineCase.setUp(self)
        self.storagectl_cmd = self.machine.execute("for cmd in storagedctl storagectl udisksctl; do if which $cmd 2>/dev/null; then break; fi; done").strip()

        if "udisksctl" in self.storagectl_cmd:
            ver = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager Version || true")
        else:
            ver = self.machine.execute("busctl --system get-property org.storaged.Storaged /org/storaged/Storaged/Manager org.storaged.Storaged.Manager Version || true")
        m = re.match('s "(.*)"', ver)
        if m:
            self.storaged_version = map(int, m.group(1).split("."))
        else:
            self.storaged_version = [ 0 ]

        self.storaged_is_old_udisks = ("udisksctl" in self.storagectl_cmd and self.storaged_version < [2, 6, 0])


    def inode(self, f):
        return self.machine.execute("stat -L '%s' -c %%i" % f)

    def retry(self, setup, check, teardown):
        b = self.browser
        b.arm_timeout()
        while True:
            if setup:
                setup()
            if check():
                break
            if teardown:
                teardown()
            b.wait_checkpoint()
        b.disarm_timeout()

    # Content

    def content_row_expand(self, index):
        b = self.browser
        tbody = "#detail-content tbody:nth-of-type(%d)" % index
        b.wait_present(tbody)
        if not "open" in b.attr(tbody, "class"):
            b.click(tbody + " tr.listing-ct-item")
            b.wait_present(tbody + ".open")

    def content_row_action(self, index, title):
        btn = "#detail-content tbody:nth-of-type(%d) .listing-ct-item .listing-ct-actions button:contains(%s)" % (index, title)
        self.browser.wait_present(btn)
        self.browser.click(btn)

    # The row might come and go a couple of times until it has the
    # expected content.  However, wait_in_text can not deal with a
    # temporarily disappearing element, so we use self.retry.

    def content_row_wait_in_col(self, row_index, col_index, val):
        col = "#detail-content tbody:nth-of-type(%d) .listing-ct-item :nth-child(%d)" % (row_index, col_index+1)
        self.retry(None, lambda: self.browser.is_present(col) and val in self.browser.text(col), None)

    def content_head_action(self, index, title):
        self.content_row_expand(index)
        btn = "#detail-content tbody:nth-of-type(%d) .listing-ct-head .listing-ct-actions button:contains(%s)" % (index, title)
        self.browser.wait_present(btn)
        self.browser.click(btn)

    def content_tab_expand(self, row_index, tab_index):
        tab_btn = "#detail-content tbody:nth-of-type(%d) .listing-ct-head li:nth-child(%d) a" % (row_index, tab_index)
        tab = "#detail-content tbody:nth-of-type(%d) .listing-ct-body:nth-child(%d)" % (row_index, tab_index + 1)
        self.content_row_expand(row_index)
        self.browser.wait_present(tab_btn)
        self.browser.click(tab_btn)
        self.browser.wait_present(tab)
        return tab

    def content_tab_action(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        btn = tab + " button:contains(%s)" % title
        self.browser.wait_present(btn)
        self.browser.wait_attr(btn, "disabled", None)
        self.browser.click(btn)

    # To check what's in a tab, we need to open the row and select the
    # tab.
    #
    # However, sometimes we open the wrong row or the wrong tab
    # because the right row or right tab still has to be created and
    # take its right place.  If the right row or tab finally appears,
    # it wont be open at that point and we will miss it if we only
    # open a row/tab once.  So we just run the whole process in a big
    # retry loop.
    #
    # XXX - Clicking a button in a tab has the same problem, but we
    # ignore that for now.

    def content_tab_wait_in_info(self, row_index, tab_index, title, val):
        b = self.browser

        def setup():
            pass

        def check():
            row = "#detail-content tbody:nth-of-type(%d)" % row_index
            row_item = row + " tr.listing-ct-item"
            tab_btn = row + " .listing-ct-head li:nth-child(%d) a" % tab_index
            tab = row + " .listing-ct-body:nth-child(%d)" % (tab_index + 1)
            cell = tab + " table.info-table-ct tr:contains(%s) td:nth-child(2)" % title

            if not b.is_present(row + ".open"):
                if not b.is_present(row_item):
                    return False
                b.click(row_item)
                if not b.is_present(row + ".open"):
                    return False

            if not b.is_present(tab):
                if not b.is_present(tab_btn):
                    return False
                b.click(tab_btn)
                if not b.is_present(tab):
                    return False

            if not b.is_present(cell):
                return False
            return val in b.text(cell)

        def teardown():
            pass
        self.retry(setup, check, teardown)

    def content_tab_info_row(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        return tab + " table.info-table-ct tr:contains(%s)" % title

    def content_tab_info_action(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        link = tab + " table.info-table-ct tr:contains(%s) td:nth-child(2) a" % title
        self.browser.wait_present(link)
        self.browser.click(link)

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
        elif isinstance(val, int):
            # size slider
            self.browser.set_val(self.dialog_field(field) + " .size-unit", "1048576")
            self.browser.set_val(self.dialog_field(field) + " .size-text", str(val))
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
        if isinstance(val, int):
            # size slider
            self.browser.wait_val(self.dialog_field(field) + " .size-unit", "1048576")
            self.browser.wait_val(self.dialog_field(field) + " .size-text", str(val))
        else:
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

    def wait_in_storaged_configuration(self, mount_point):
        wait(lambda: mount_point in self.machine.execute("%s dump | grep Configuration" % self.storagectl_cmd))

    def wait_not_in_storaged_configuration(self, mount_point):
        wait(lambda: mount_point not in self.machine.execute("%s dump | grep Configuration" % self.storagectl_cmd))
