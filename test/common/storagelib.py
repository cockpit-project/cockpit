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

import json
import os.path
import re
import textwrap

from testlib import Error, MachineCase, wait


def from_udisks_ascii(codepoints):
    return ''.join(map(chr, codepoints[:-1]))


class StorageHelpers:
    """Mix-in class for using in tests that derive from something else than MachineCase or StorageCase"""

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
        """Add per-test RAM disk

        The disk gets removed automatically when the test ends. This is safe for @nondestructive tests.

        Return the device name.
        """
        # sanity test: should not yet be loaded
        self.machine.execute("test ! -e /sys/module/scsi_debug")
        self.machine.execute(f"modprobe scsi_debug dev_size_mb={size}")
        dev = self.machine.execute('while true; do O=$(ls /sys/bus/pseudo/drivers/scsi_debug/adapter*/host*/target*/*:*/block 2>/dev/null || true); '
                                   '[ -n "$O" ] && break || sleep 0.1; done; echo "/dev/$O"').strip()
        # don't use addCleanup() here, this is often busy and needs to be cleaned up late; done in MachineCase.nonDestructiveSetup()

        return dev

    def add_loopback_disk(self, size=50, name=None):
        """Add per-test loopback disk

        The disk gets removed automatically when the test ends. This is safe for @nondestructive tests.

        Unlike add_ram_disk(), this can be called multiple times, and
        is less size constrained.  The backing file starts out sparse,
        so this can be used to create massive block devices, as long
        as you are careful to not actually use much of it.

        However, loopback devices look quite special to the OS, so
        they are not a very good simulation of a "real" disk.

        Return the device name.

        """
        # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1969408
        # It would be nicer to remove $F immediately after the call to
        # losetup, but that will break some versions of lvm2.
        dev = self.machine.execute("F=$(mktemp /var/tmp/loop.XXXX); "
                                   "truncate --size=%sMB $F; "
                                   "losetup --show %s $F" % (size, name if name else "--find")).strip()
        # If this device had partions in its last incarnation on this
        # machine, they might come back for unknown reasons, in a
        # non-functional state. Running partprobe will get rid of
        # them.
        self.machine.execute("partprobe '%s'" % dev)
        # right after unmounting the device is often still busy, so retry a few times
        self.addCleanup(self.machine.execute, "umount {0} || true; rm $(losetup -n -O BACK-FILE -l {0}); until losetup -d {0}; do sleep 1; done".format(dev), timeout=10)
        return dev

    def force_remove_disk(self, device):
        """Act like the given device gets physically removed.

        This circumvents all the normal EBUSY failures, and thus can be used for testing
        the cleanup after a forceful removal.
        """
        self.machine.execute(f'echo 1 > /sys/block/{os.path.basename(device)}/device/delete')

    def devices_dropdown(self, title):
        self.browser.click("#devices .pf-v5-c-dropdown button.pf-v5-c-dropdown__toggle")
        self.browser.click(f"#devices .pf-v5-c-dropdown a:contains('{title}')")

    # Content

    def content_row_tbody(self, index):
        return "#detail-content > .pf-v5-c-card > div > table > tbody:nth-of-type(%d)" % index

    def content_row_expand(self, index):
        b = self.browser
        tbody = self.content_row_tbody(index)
        b.wait_visible(tbody)
        if "pf-m-expanded" not in (b.attr(tbody, "class") or ""):
            b.click(tbody + " tr td.pf-v5-c-table__toggle button")
            b.wait_visible(tbody + ".pf-m-expanded")

    def content_row_action(self, index, title, isExpandable=True):
        if isExpandable:
            btn = self.content_row_tbody(index) + f" tr:first-child td button:contains({title})"
        else:
            btn = "#detail-content > .pf-v5-c-card > div > table > :nth-child(%d)" % index + f" td button:contains({title})"
        self.browser.click(btn)

    # The row might come and go a couple of times until it has the
    # expected content.  However, wait_in_text can not deal with a
    # temporarily disappearing element, so we use self.retry.

    def content_row_wait_in_col(self, row_index, col_index, val, isExpandable=True, alternate_val=None):
        if isExpandable:
            col = self.content_row_tbody(row_index) + " tr:first-child > :nth-child(%d)" % (col_index + 1)
        else:
            col = "#detail-content > .pf-v5-c-card > div > table > :nth-child(%d)" % row_index + " > :nth-child(%d)" % (col_index + 1)
        wait(lambda: self.browser.is_present(col) and (val in self.browser.text(col) or (alternate_val and alternate_val in self.browser.text(col))))

    def content_dropdown_action(self, index, title, isExpandable=True):
        if isExpandable:
            dropdown = self.content_row_tbody(index) + " tr td:last-child .pf-v5-c-dropdown"
        else:
            dropdown = "#detail-content > .pf-v5-c-card > div > table > :nth-child(%d)" % index + " td:last-child .pf-v5-c-dropdown"
        self.browser.click(dropdown + " button.pf-v5-c-dropdown__toggle")
        self.browser.click(dropdown + f" a:contains('{title}')")

    def content_tab_expand(self, row_index, tab_index):
        tab_btn = self.content_row_tbody(row_index) + " .pf-v5-c-tabs ul li:nth-child(%d) button" % tab_index
        tab = self.content_row_tbody(row_index) + " .ct-listing-panel-body[data-key='%d']" % (tab_index - 1)
        self.content_row_expand(row_index)
        self.browser.click(tab_btn)
        self.browser.wait_visible(tab)
        return tab

    def content_tab_action(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        btn = tab + f" button:contains({title})"
        self.browser.wait_attr(btn, "disabled", None)
        self.browser.click(btn)

    def wait_content_tab_action_disabled(self, row_index, tab_index, title):
        tab = self.content_tab_expand(row_index, tab_index)
        btn = tab + f" button:disabled:contains({title})"
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
            row_item = row + " tr td.pf-v5-c-table__toggle button"
            tab_btn = row + " .pf-v5-c-tabs ul li:nth-child(%d) button" % tab_index
            tab = row + " .ct-listing-panel-body[data-key='%d']" % (tab_index - 1)
            cell = tab + f" dt:contains({title}) + *"

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
        return tab + f" dt:contains({title})"

    def content_tab_info_action(self, row_index, tab_index, title):
        label = self.content_tab_info_label(row_index, tab_index, title)
        link = label + " + dd button.pf-m-link"
        self.browser.click(link)

    # Dialogs

    def dialog_wait_open(self):
        self.browser.wait_visible('#dialog')

    def dialog_wait_alert(self, text):
        self.browser.wait_in_text('#dialog .pf-v5-c-alert__title', text)

    def dialog_field(self, field):
        return f'#dialog [data-field="{field}"]'

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
                self.browser.set_checked(f'{sel} :contains("{label}") input', val)
        elif ftype == "size-slider":
            self.browser.set_val(sel + " .size-unit select", "1000000")
            self.browser.set_input_text(sel + " .size-text input", str(val))
        elif ftype == "select":
            self.browser._wait_present(sel + f" select option[value='{val}']:not([disabled])")
            self.browser.set_val(sel + " select", val)
        elif ftype == "select-radio":
            self.browser.click(sel + f" input[data-data='{val}']")
        elif ftype == "text-input":
            self.browser.set_input_text(sel, val)
        elif ftype == "text-input-checked":
            if not val:
                self.browser.set_checked(sel + " input[type=checkbox]", val=False)
            else:
                self.browser.set_checked(sel + " input[type=checkbox]", val=True)
                self.browser.set_input_text(sel + " [type=text]", val)
        elif ftype == "combobox":
            self.browser.click(sel + " button.pf-v5-c-select__toggle-button")
            self.browser.click(sel + f" .pf-v5-c-select__menu li:contains('{val}') button")
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
        return self.browser.is_present(f'{self.dialog_field(field)} :contains("{label}") input')

    def dialog_wait_val(self, field, val, unit=None):
        if unit is None:
            unit = "1000000"

        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "size-slider":
            self.browser.wait_val(sel + " .size-unit select", unit)
            self.browser.wait_val(sel + " .size-text input", str(val))
        elif ftype == "select":
            self.browser.wait_attr(sel, "data-value", val)
        else:
            self.browser.wait_val(sel, val)

    def dialog_wait_error(self, field, val):
        # XXX - allow for more than one error
        self.browser.wait_in_text('#dialog .pf-v5-c-form__helper-text .pf-m-error', val)

    def dialog_wait_not_present(self, field):
        self.browser.wait_not_present(self.dialog_field(field))

    def dialog_wait_apply_enabled(self):
        self.browser.wait_attr('#dialog button.apply:nth-of-type(1)', "disabled", None)

    def dialog_apply(self):
        self.browser.click('#dialog button.apply:nth-of-type(1)')

    def dialog_apply_secondary(self):
        self.browser.click('#dialog button.apply:nth-of-type(2)')

    def dialog_cancel(self):
        self.browser.click('#dialog button.cancel')

    def dialog_wait_close(self):
        # file system operations often take longer than 10s
        with self.browser.wait_timeout(max(self.browser.cdp.timeout, 60)):
            self.browser.wait_not_present('#dialog')

    def dialog_check(self, expect):
        for f in expect:
            if not self.dialog_val(f) == expect[f]:
                return False
        return True

    def dialog_set_vals(self, values):
        # Sometimes a certain field needs to be set before other
        # fields come into existence and thus the order matters that
        # we set the fields in.  The tests however just give us a
        # unordered 'dict'.  Instead of changing the tests, we figure
        # out the right order dynamically here by just setting what we
        # can and then starting over.  As long as we make progress in
        # each iteration, everything is good.
        failed = {}
        last_error = Exception
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

    def dialog(self, values, expect=None, secondary=False):
        if expect is None:
            expect = {}
        self.dialog_wait_open()
        for f in expect:
            self.dialog_wait_val(f, expect[f])
        self.dialog_set_vals(values)
        if secondary:
            self.dialog_apply_secondary()
        else:
            self.dialog_apply()
        self.dialog_wait_close()

    def confirm(self):
        self.dialog({})

    # There is some asynchronous activity in the storage stack.  (It
    # used to be much worse, but it has improved over the years, yay!)
    #
    # The tests deal with that by waiting for the right conditions,
    # which sometimes means opening a dialog a couple of times until
    # it has the right contents, or applying it a couple of times
    # until it works.

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

    def udisks_objects(self):
        return json.loads(self.machine.execute(["python3", "-c", textwrap.dedent("""
            import dbus, json
            print(json.dumps(dbus.SystemBus().call_blocking(
                "org.freedesktop.UDisks2",
                "/org/freedesktop/UDisks2",
                "org.freedesktop.DBus.ObjectManager",
                "GetManagedObjects", "", [])))""")]))

    def configuration_field(self, dev, tab, field):
        managerObjects = self.udisks_objects()
        for path in managerObjects:
            if "org.freedesktop.UDisks2.Block" in managerObjects[path]:
                iface = managerObjects[path]["org.freedesktop.UDisks2.Block"]
                if from_udisks_ascii(iface["Device"]) == dev or from_udisks_ascii(iface["PreferredDevice"]) == dev:
                    for entry in iface["Configuration"]:
                        if entry[0] == tab:
                            if field in entry[1]:
                                print(f"{path}/{tab}/{field} = {from_udisks_ascii(entry[1][field])}")
                                return from_udisks_ascii(entry[1][field])
        return ""

    def assert_in_configuration(self, dev, tab, field, text):
        self.assertIn(text, self.configuration_field(dev, tab, field))

    def assert_not_in_configuration(self, dev, tab, field, text):
        self.assertNotIn(text, self.configuration_field(dev, tab, field))

    def child_configuration_field(self, dev, tab, field):
        udisks_objects = self.udisks_objects()
        for path in udisks_objects:
            if "org.freedesktop.UDisks2.Encrypted" in udisks_objects[path]:
                block_iface = udisks_objects[path]["org.freedesktop.UDisks2.Block"]
                crypto_iface = udisks_objects[path]["org.freedesktop.UDisks2.Encrypted"]
                if from_udisks_ascii(block_iface["Device"]) == dev or from_udisks_ascii(block_iface["PreferredDevice"]) == dev:
                    for entry in crypto_iface["ChildConfiguration"]:
                        if entry[0] == tab:
                            if field in entry[1]:
                                print("%s/child/%s/%s = %s" % (path, tab, field,
                                                               from_udisks_ascii(entry[1][field])))
                                return from_udisks_ascii(entry[1][field])
        return ""

    def assert_in_child_configuration(self, dev, tab, field, text):
        self.assertIn(text, self.child_configuration_field(dev, tab, field))

    def lvol_child_configuration_field(self, lvol, tab, field):
        udisk_objects = self.udisks_objects()
        for path in udisk_objects:
            if "org.freedesktop.UDisks2.LogicalVolume" in udisk_objects[path]:
                iface = udisk_objects[path]["org.freedesktop.UDisks2.LogicalVolume"]
                if iface["Name"] == lvol:
                    for entry in iface["ChildConfiguration"]:
                        if entry[0] == tab:
                            if field in entry[1]:
                                print("%s/child/%s/%s = %s" % (path, tab, field,
                                                               from_udisks_ascii(entry[1][field])))
                                return from_udisks_ascii(entry[1][field])
        return ""

    def assert_in_lvol_child_configuration(self, lvol, tab, field, text):
        self.assertIn(text, self.lvol_child_configuration_field(lvol, tab, field))

    def wait_mounted(self, row, col):
        with self.browser.wait_timeout(30):
            self.content_tab_wait_in_info(row, col, "Mount point",
                                          cond=lambda cell: "The filesystem is not mounted" not in self.browser.text(cell))

    def wait_not_mounted(self, row, col):
        with self.browser.wait_timeout(30):
            self.content_tab_wait_in_info(row, col, "Mount point",
                                          cond=lambda cell: "The filesystem is not mounted" in self.browser.text(cell))

    def setup_systemd_password_agent(self, password):
        # This sets up a systemd password agent that replies to all
        # queries with the given password.

        self.write_file("/usr/local/bin/test-password-agent",
                        f"""#!/bin/sh
# Sleep a bit to avoid starting this agent too quickly over and over,
# and so that other agents get a chance as well.
sleep 30

for s in $(grep -h ^Socket= /run/systemd/ask-password/ask.* | sed 's/^Socket=//'); do
  printf '%s' '{password}' | /usr/lib/systemd/systemd-reply-password 1 $s
done
""", perm="0755")

        self.write_file("/etc/systemd/system/test-password-agent.service",
                        """
[Unit]
Description=Test Password Agent
DefaultDependencies=no
Conflicts=shutdown.target emergency.service
Before=shutdown.target
[Service]
ExecStart=/usr/local/bin/test-password-agent
""")

        self.write_file("/etc/systemd/system/test-password-agent.path",
                        """
[Unit]
Description=Test Password Agent Directory Watch
DefaultDependencies=no
Conflicts=shutdown.target emergency.service
Before=paths.target shutdown.target cryptsetup.target
[Path]
DirectoryNotEmpty=/run/systemd/ask-password
MakeDirectory=yes
""")
        self.machine.execute("ln -s ../test-password-agent.path /etc/systemd/system/sysinit.target.wants/")

    def encrypt_root(self, passphrase):
        m = self.machine

        # Set up a password agent in the old root and then arrange for
        # it to be included in the initrd.  This will unlock the new
        # encrypted root during boot.
        #
        # The password agent and its initrd configuration will be
        # copied to the new root, so it will stay in place also when
        # the initrd is regenerated again from within the new root.

        self.setup_systemd_password_agent(passphrase)
        install_items = [
            '/etc/systemd/system/sysinit.target.wants/test-password-agent.path',
            '/etc/systemd/system/test-password-agent.path',
            '/etc/systemd/system/test-password-agent.service',
            '/usr/local/bin/test-password-agent',
        ]
        m.write("/etc/dracut.conf.d/01-askpass.conf",
                f'install_items+=" {" ".join(install_items)} "')

        # The first step is to move /boot to a new unencrypted
        # partition on the new disk but keep it mounted at /boot.
        # This helps when running grub2-install and grub2-mkconfig,
        # which will look at /boot and do the right thing.
        #
        # Then we copy (most of) the old root to the new disk, into a
        # logical volume sitting on top of a LUKS container.
        #
        # The kernel command line is changed to use the new root
        # filesystem, and grub is installed on the new disk. The boot
        # configuration of the VM has been changed to boot from the
        # new disk.
        #
        # At that point the new root can be booted by the existing
        # initrd, but the initrd will prompt for the passphrase (as
        # expected).  Thus, the initrd is regenerated to include the
        # password agent from above.
        #
        # Before the reboot, we destroy the original disk to make
        # really sure that it wont be used anymore.

        info = m.add_disk("4G", serial="NEWROOT", boot_disk=True)
        dev = "/dev/" + info["dev"]
        wait(lambda: m.execute(f"test -b {dev} && echo present").strip() == "present")
        m.execute(f"""
set -x
parted -s {dev} mktable msdos
parted -s {dev} mkpart primary ext4 1M 500M
parted -s {dev} mkpart primary ext4 500M 100%
echo {passphrase} | cryptsetup luksFormat --pbkdf-memory=300 {dev}2
luks_uuid=$(blkid -p {dev}2 -s UUID -o value)
echo {passphrase} | cryptsetup luksOpen --pbkdf-memory=300 {dev}2 luks-$luks_uuid
vgcreate root /dev/mapper/luks-$luks_uuid
lvcreate root -n root -l100%VG
mkfs.ext4 /dev/root/root
mkdir /new-root
mount /dev/root/root /new-root
mkfs.ext4 {dev}1
mkdir /new-root/boot
mount {dev}1 /new-root/boot
tar --selinux --one-file-system -cf - --exclude /boot --exclude='/var/tmp/*' --exclude='/var/cache/*' \
    --exclude='/var/lib/mock/*' --exclude='/var/lib/containers/*' --exclude='/new-root/*' \
    / | tar --selinux -C /new-root -xf -
tar --one-file-system -C /boot -cf - . | tar -C /new-root/boot -xf -
umount /new-root/boot
mount {dev}1 /boot
echo "(hd0) {dev}" >/boot/grub2/device.map
sed -i -e 's,/boot/,/,' /boot/loader/entries/*
uuid=$(blkid -p /dev/root/root -s UUID -o value)
buuid=$(blkid -p {dev}1 -s UUID -o value)
echo "UUID=$uuid / auto defaults 0 0" >/new-root/etc/fstab
echo "UUID=$buuid /boot auto defaults 0 0" >>/new-root/etc/fstab
dracut --regenerate-all --force
grub2-install {dev}
( # HACK - grub2-mkconfig messes with /boot/loader/entries/ and /etc/kernel/cmdline
  mv /boot/loader/entries /boot/loader/entries.stowed
  ! test -f /etc/kernel/cmdline || mv /etc/kernel/cmdline /etc/kernel/cmdline.stowed
  grub2-mkconfig -o /boot/grub2/grub.cfg
  mv /boot/loader/entries.stowed /boot/loader/entries
  ! test -f /etc/kernel/cmdline.stowed || mv /etc/kernel/cmdline.stowed /etc/kernel/cmdline
)
grubby --update-kernel=ALL --args="root=UUID=$uuid rootflags=defaults rd.luks.uuid=$luks_uuid rd.lvm.lv=root/root"
! test -f /etc/kernel/cmdline || cp /etc/kernel/cmdline /new-root/etc/kernel/cmdline
""", timeout=300)
        m.spawn("dd if=/dev/zero of=/dev/vda bs=1M count=100; reboot", "reboot", check=False)
        m.wait_reboot(300)
        self.assertEqual(m.execute("findmnt -n -o SOURCE /").strip(), "/dev/mapper/root-root")


class StorageCase(MachineCase, StorageHelpers):

    def setUp(self):

        if self.image in ["fedora-coreos", "rhel4edge"]:
            self.skipTest("No udisks/cockpit-storaged on OSTree images")

        super().setUp()

        ver = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager Version || true")
        m = re.match('s "(.*)"', ver)
        if m:
            self.storaged_version = list(map(int, m.group(1).split(".")))
        else:
            self.storaged_version = [0]

        crypto_types = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager SupportedEncryptionTypes || true")
        if "luks2" in crypto_types:
            self.default_crypto_type = "luks2"
        else:
            self.default_crypto_type = "luks1"

        if self.image.startswith("rhel-8") or self.image.startswith("centos-8"):
            # HACK: missing /etc/crypttab file upsets udisks: https://github.com/storaged-project/udisks/pull/835
            self.machine.write("/etc/crypttab", "")

        # starting out with empty PCP logs and pmlogger not running causes these metrics channel messages
        self.allow_journal_messages("pcp-archive: no such metric: disk.*")

        # UDisks2 invalidates the Size property and cockpit-bridge
        # gets it immediately.  But sometimes the interface is already
        # gone.
        self.allow_journal_messages("org.freedesktop.UDisks2: couldn't get property org.freedesktop.UDisks2.Filesystem Size .* No such interface.*")
