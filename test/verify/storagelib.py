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

import re
import os.path

from testlib import *


class StorageHelpers:
    '''Mix-in class for using in tests that derive from something else than MachineCase or StorageCase'''

    def inode(self, f):
        return self.machine.execute("stat -L '%s' -c %%i" % f)

    def retry(self, setup, check, teardown):
        def step():
            if setup:
                setup()
            if check():
                return True
            if teardown:
                teardown()
            return False

        self.browser.wait(step)

    def add_ram_disk(self, size=50):
        '''Add per-test RAM disk

        The disk gets removed automatically when the test ends. This is safe for @nondestructive tests.

        Return the device name.
        '''
        # sanity test: should not yet be loaded
        self.machine.execute("test ! -e /sys/module/scsi_debug")
        self.machine.execute("modprobe scsi_debug dev_size_mb=%s" % size)
        dev = self.machine.execute('set -e; while true; do O=$(ls /sys/bus/pseudo/drivers/scsi_debug/adapter*/host*/target*/*:*/block 2>/dev/null || true); '
                                   '[ -n "$O" ] && break || sleep 0.1; done; echo "/dev/$O"').strip()
        # don't use addCleanup() here, this is often busy and needs to be cleaned up late; done in MachineCase.nonDestructiveSetup()

        return dev

    def add_loopback_disk(self, size=50):
        '''Add per-test loopback disk

        The disk gets removed automatically when the test ends. This is safe for @nondestructive tests.

        Unlike add_ram_disk(), this can be called multiple times, and is less size constrained.
        However, loopback devices look quite special to the OS, so they are not a very good
        simulation of a "real" disk.

        Return the device name.
        '''
        dev = self.machine.execute("set -e; F=$(mktemp /var/tmp/loop.XXXX); "
                                   "dd if=/dev/zero of=$F bs=1M count=%s; "
                                   "losetup --find --show $F; "
                                   "rm $F" % size).strip()
        # right after unmounting the device is often still busy, so retry a few times
        self.addCleanup(self.machine.execute, "umount {0}; until losetup -d {0}; do sleep 1; done".format(dev), timeout=10)
        return dev

    def force_remove_disk(self, device):
        '''Act like the given device gets physically removed.

        This circumvents all the normal EBUSY failures, and thus can be used for testing
        the cleanup after a forceful removal.
        '''
        self.machine.execute('echo 1 > /sys/block/%s/device/delete' % os.path.basename(device))

    def devices_dropdown(self, title):
        self.browser.click("#devices .pf-c-dropdown button.pf-c-dropdown__toggle")
        self.browser.click("#devices .pf-c-dropdown a:contains('%s')" % title)

    # Content

    def content_row_tbody(self, index):
        return "#detail-content > article > div > table > tbody:nth-of-type(%d)" % index

    def content_row_expand(self, index):
        b = self.browser
        tbody = self.content_row_tbody(index)
        b.wait_visible(tbody)
        if "pf-m-expanded" not in (b.attr(tbody, "class") or ""):
            b.click(tbody + " tr td.pf-c-table__toggle button")
            b.wait_visible(tbody + ".pf-m-expanded")

    def content_row_action(self, index, title):
        btn = self.content_row_tbody(index) + " tr td:last-child button:contains(%s)" % title
        self.browser.click(btn)

    # The row might come and go a couple of times until it has the
    # expected content.  However, wait_in_text can not deal with a
    # temporarily disappearing element, so we use self.retry.

    def content_row_wait_in_col(self, row_index, col_index, val):
        col = self.content_row_tbody(row_index) + " tr:first-child > :nth-child(%d)" % (col_index + 1)
        wait(lambda: self.browser.is_present(col) and val in self.browser.text(col))

    def content_head_action(self, index, title):
        self.content_row_expand(index)
        btn = self.content_row_tbody(index) + " .ct-listing-panel-actions button:contains(%s)" % title
        self.browser.click(btn)

    def content_dropdown_action(self, index, title):
        self.content_row_expand(index)
        dropdown = self.content_row_tbody(index) + " .ct-listing-panel-actions .pf-c-dropdown"
        self.browser.click(dropdown + " button.pf-c-dropdown__toggle")
        self.browser.click(dropdown + " a:contains('%s')" % title)

    def content_tab_expand(self, row_index, tab_index):
        tab_btn = self.content_row_tbody(row_index) + " .ct-listing-panel-head > nav ul li:nth-child(%d) a" % tab_index
        tab = self.content_row_tbody(row_index) + " .ct-listing-panel-body[data-key=%d]" % (tab_index - 1)
        self.content_row_expand(row_index)
        self.browser.click(tab_btn)
        self.browser.wait_visible(tab)
        return tab

    def content_tab_action(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        btn = tab + " button:contains(%s)" % title
        self.browser.wait_attr(btn, "disabled", None)
        self.browser.click(btn)

    def wait_content_tab_action_disabled(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        btn = tab + " button:disabled:contains(%s)" % title
        self.browser.wait_visible(btn)

    # To check what's in a tab, we need to open the row and select the
    # tab.
    #
    # However, sometimes we open the wrong row or the wrong tab
    # because the right row or right tab still has to be created and
    # take its right place.  If the right row or tab finally appears,
    # it won't be open at that point and we will miss it if we only
    # open a row/tab once.  So we just run the whole process in a big
    # retry loop.
    #
    # XXX - Clicking a button in a tab has the same problem, but we
    # ignore that for now.

    def content_tab_wait_in_info(self, row_index, tab_index, title, val=None, alternate_val=None, cond=None):
        b = self.browser

        def setup():
            pass

        def check():
            row = self.content_row_tbody(row_index)
            row_item = row + " tr td.pf-c-table__toggle button"
            tab_btn = row + " .ct-listing-panel-head > nav ul li:nth-child(%d) a" % tab_index
            tab = row + " .ct-listing-panel-body[data-key=%d]" % (tab_index - 1)
            cell = tab + " dt:contains(%s) + *" % title

            # The DOM might change at any time while we are inspecting
            # it, so we can't reliably test for a elements existence
            # before clicking on it, for example.  Instead, we just
            # click and catch the testlib.Error that happens when it
            # is not there.  However, the click itself will wait for a
            # timeout when the element is missing, so we check anyway
            # before trying, just to speed things up.

            try:
                if not b.is_present(row + ".pf-m-expanded"):
                    if not b.is_present(row_item):
                        return False
                    b.click(row_item)
                    if not b.is_present(row + ".pf-m-expanded"):
                        return False

                if not b.is_present(tab) or not b.is_visible(tab):
                    if not b.is_present(tab_btn):
                        return False
                    b.click(tab_btn)
                    if not b.is_visible(tab):
                        return False

                if not b.is_present(cell) or not b.is_visible(cell):
                    return False

                if val is not None and val in b.text(cell):
                    return True
                if alternate_val is not None and alternate_val in b.text(cell):
                    return True
                if cond is not None and cond(cell):
                    return True
                return False
            except Error:
                return False

        def teardown():
            pass
        self.retry(setup, check, teardown)

    def content_tab_info_label(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        return tab + " dt:contains(%s)" % title

    def content_tab_info_action(self, row_index, tab_index, title, wrapped=False):
        label = self.content_tab_info_label(row_index, tab_index, title)
        link = label + " + dd button.pf-m-link"
        self.browser.click(link)

    # Dialogs

    def dialog_wait_open(self):
        self.browser.wait_visible('#dialog')

    def dialog_wait_alert(self, text):
        self.browser.wait_in_text('#dialog .pf-c-alert__title', text)

    def dialog_field(self, field):
        return '#dialog [data-field="%s"]' % field

    def dialog_val(self, field):
        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "text-input-checked":
            if self.browser.is_present(sel + " input[type=checkbox]:not(:checked)"):
                return False
            else:
                return self.browser.val(sel + " input[type=text]")
        elif ftype == "select":
            return self.browser.attr(sel, "data-value")
        else:
            return self.browser.val(sel)

    def dialog_set_val(self, field, val):
        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "checkbox":
            self.browser.set_checked(sel, val)
        elif ftype == "select-spaces":
            for label in val:
                self.browser.set_checked('%s :contains("%s") input' % (sel, label), val)
        elif ftype == "size-slider":
            self.browser.set_val(sel + " .size-unit", "1048576")
            self.browser.set_input_text(sel + " .size-text", str(val))
        elif ftype == "select":
            self.browser.set_val(sel + " select", val)
        elif ftype == "select-radio":
            self.browser.click(sel + " input[data-data='%s']" % val)
        elif ftype == "text-input":
            self.browser.set_input_text(sel, val)
        elif ftype == "text-input-checked":
            if not val:
                self.browser.set_checked(sel + " input[type=checkbox]", False)
            else:
                self.browser.set_checked(sel + " input[type=checkbox]", True)
                self.browser.set_input_text(sel + " [type=text]", val)
        elif ftype == "combobox":
            self.browser.click(sel + " button.pf-c-select__toggle-button")
            self.browser.click(sel + " .pf-c-select__menu li:contains('{0}') button".format(val))
        else:
            self.browser.set_val(sel, val)

    def dialog_combobox_choices(self, field):
        return self.browser.call_js_func("""(function (sel) {
                                               var lis = ph_find(sel).querySelectorAll('li');
                                               var result = [];
                                               for (i = 0; i < lis.length; ++i)
                                                 result.push(lis[i].textContent);
                                               return result;
                                             })""", self.dialog_field(field))

    def dialog_is_present(self, field, label):
        return self.browser.is_present('%s :contains("%s") input' % (self.dialog_field(field), label))

    def dialog_wait_val(self, field, val):
        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "size-slider":
            self.browser.wait_val(sel + " .size-unit", "1048576")
            self.browser.wait_val(sel + " .size-text", str(val))
        elif ftype == "select":
            self.browser.wait_attr(sel, "data-value", val)
        else:
            self.browser.wait_val(sel, val)

    def dialog_wait_error(self, field, val):
        # XXX - allow for more than one error
        self.browser.wait_in_text('#dialog .pf-c-form__helper-text.pf-m-error', val)

    def dialog_wait_not_visible(self, field):
        self.browser.wait_not_visible(self.dialog_field(field))

    def dialog_wait_not_present(self, field):
        self.browser.wait_not_present(self.dialog_field(field))

    def dialog_wait_apply_enabled(self):
        self.browser.wait_attr('#dialog button.apply', "disabled", None)

    def dialog_apply(self):
        self.browser.click('#dialog button.apply')

    def dialog_cancel(self):
        self.browser.click('#dialog button.cancel')

    def dialog_wait_close(self):
        self.browser.wait_not_present('#dialog')

    def dialog_check(self, expect):
        for f in expect:
            if not self.dialog_val(f) == expect[f]:
                return False
        return True

    def dialog_set_vals(self, values):
        # Sometimes a certain field needs to be set before other
        # fields come into existence and thus the order matter that we
        # set the fields in.  The tests however just give us a
        # unordered 'dict'.  Instead of changing the tests, we figure
        # out the right order dynamically here by just setting what we
        # can and then starting over.  As long as we make progress in
        # each iteration, everything is good.
        failed = {}
        last_error = None
        for f in values:
            try:
                self.dialog_set_val(f, values[f])
            except Error as e:
                failed[f] = values[f]
                last_error = e
        if failed:
            if len(failed) < len(values):
                self.dialog_set_vals(failed)
            else:
                raise last_error

    def dialog(self, values, expect={}):
        self.dialog_wait_open()
        for f in expect:
            self.dialog_wait_val(f, expect[f])
        self.dialog_set_vals(values)
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

    def dialog_open_with_retry(self, trigger, expect):
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

    def dialog_apply_with_retry(self, expected_errors=None):
        def step():
            try:
                self.dialog_apply()
                self.dialog_wait_close()
            except Error:
                if expected_errors is None:
                    return False
                err = self.browser.text('#dialog')
                print(err)
                for exp in expected_errors:
                    if exp in err:
                        return False
                raise
            return True
        self.browser.wait(step)

    def dialog_with_retry(self, trigger, values, expect):
        self.dialog_open_with_retry(trigger, expect)
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

    def wait_mounted(self, row, col):
        self.content_tab_wait_in_info(row, col, "Mount point",
                                      cond=lambda cell: "The filesystem is not mounted" not in self.browser.text(cell))


class StorageCase(MachineCase, StorageHelpers):

    def setUp(self):

        if self.image in ["fedora-coreos"]:
            self.skipTest("No udisks/cockpit-storaged on OSTree images")

        super().setUp()
        self.storagectl_cmd = "udisksctl"

        ver = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager Version || true")
        m = re.match('s "(.*)"', ver)
        if m:
            self.storaged_version = list(map(int, m.group(1).split(".")))
        else:
            self.storaged_version = [0]

        if "debian" in self.machine.image or "ubuntu" in self.machine.image:
            # Debian's udisks has a patch to use FHS /media directory
            self.mount_root = "/media"
        else:
            self.mount_root = "/run/media"
