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
# along with Cockpit; If not, see <https://www.gnu.org/licenses/>.

import json
import os.path
import re
import textwrap
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from typing import Any

from machine.machine_core.machine_virtual import VirtMachine
from testlib import Error, JsonObject, MachineCase, wait


def from_udisks_ascii(codepoints: Sequence[int]) -> str:
    return ''.join(map(chr, codepoints[:-1]))


class StorageHelpers(MachineCase):
    """Mix-in class for using in tests that derive from something else than MachineCase or StorageCase"""

    def inode(self, f: str) -> str:
        return self.machine.execute("stat -L '%s' -c %%i" % f)

    def retry(self, check: Callable[[], bool], setup: Callable[[], None] | None = None, teardown: Callable[[], None] | None = None) -> None:
        def step() -> bool:
            if setup:
                setup()
            if check():
                return True
            if teardown:
                teardown()
            return False

        self.browser.wait(step)

    def add_ram_disk(self, size: int = 50, delay: int | None = None) -> str:
        """Add per-test RAM disk

        The disk gets removed automatically when the test ends. This is safe for @nondestructive tests.

        Optionally takes a delay in nanoseconds which delays IO responses, 100000000 equals ~ 40 kB/s.

        Return the device name.
        """
        # sanity test: should not yet be loaded
        self.machine.execute("test ! -e /sys/module/scsi_debug")
        delay_option = f'ndelay={delay}' if delay else ''
        self.machine.execute(f"modprobe scsi_debug dev_size_mb={size} {delay_option}")
        dev = self.machine.execute('while true; do O=$(ls /sys/bus/pseudo/drivers/scsi_debug/adapter*/host*/target*/*:*/block 2>/dev/null || true); '
                                   '[ -n "$O" ] && break || sleep 0.1; done; echo "/dev/$O"').strip()
        # don't use addCleanup() here, this is often busy and needs to be cleaned up late; done in MachineCase.nonDestructiveSetup()

        return dev

    def add_loopback_disk(self, size: int = 50, name: str | None = None) -> str:
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
        backf = self.machine.execute("mktemp /var/tmp/loop.XXXX").strip()
        dev = self.machine.execute(f"truncate --size={size}MB {backf}; "
                                   f"losetup -P --show {name if name else '--find'} {backf}").strip()
        # If this device had partitions in its last incarnation on this
        # machine, they might come back for unknown reasons, in a
        # non-functional state. Running partprobe will get rid of
        # them.
        self.machine.execute("partprobe '%s'" % dev)
        # right after unmounting the device is often still busy, so retry a few times
        self.addCleanup(self.machine.execute, f"until losetup -d {dev}; do sleep 1; done; rm {backf}", timeout=10)
        self.addCleanup(self.machine.execute, f"findmnt -n -o TARGET {dev} | xargs --no-run-if-empty umount;")

        return dev

    def add_targetd_loopback_disk(self, index: str, size: int = 50) -> str:
        """Add per-test loopback device that can be forcefully removed.
        """

        m = self.machine
        model = f"disk{index}"
        wwn = f"naa.5000{index:012x}"

        m.execute(f"rm -f /var/tmp/targetd.{model}")
        m.execute(f"targetcli /backstores/fileio create name={model} size={size}M file_or_dev=/var/tmp/targetd.{model}")
        m.execute(f"targetcli /loopback create {wwn}")
        m.execute(f"targetcli /loopback/{wwn}/luns create /backstores/fileio/{model}")

        self.addCleanup(m.execute, f"targetcli /loopback delete {wwn}")
        self.addCleanup(m.execute, f"targetcli /backstores/fileio delete {model}")
        self.addCleanup(m.execute, f"rm -f /var/tmp/targetd.{model}")

        dev = m.execute(f'for dev in /sys/block/*; do if [ -f $dev/device/model ] && [ "$(cat $dev/device/model | tr -d [:space:])" == "{model}" ]; then echo /dev/$(basename $dev); fi; done').strip()
        if dev == "":
            raise Error("Device not found")
        return dev

    def force_remove_disk(self, device: str) -> None:
        """Act like the given device gets physically removed.

        This circumvents all the normal EBUSY failures, and thus can be used for testing
        the cleanup after a forceful removal.
        """
        self.machine.execute(f'echo 1 > /sys/block/{os.path.basename(device)}/device/delete')
        # the removal trips up PCP and our usage graphs
        self.allow_browser_errors("direct: instance name lookup failed.*")

    def addCleanupVG(self, vgname: str) -> None:
        """Ensure the given VG is removed after the test"""

        self.addCleanup(self.machine.execute, f"if [ -d /dev/{vgname} ]; then vgremove --force {vgname}; fi")

    def addCleanupMount(self, mount_point: str) -> None:
        self.addCleanup(self.machine.execute,
                        f"if mountpoint -q {mount_point}; then umount {mount_point}; fi")

    # Dialogs

    def dialog_wait_open(self) -> None:
        self.browser.wait_visible('#dialog')

    def dialog_wait_alert(self, text1: str, text2: str | None = None) -> None:
        def has_alert_title() -> bool:
            t = self.browser.text('#dialog .pf-v6-c-alert__title')
            return text1 in t or (text2 is not None and text2 in t)
        self.browser.wait(has_alert_title)

    def dialog_wait_title(self, text: str) -> None:
        self.browser.wait_in_text('#dialog .pf-v6-c-modal-box__title', text)

    def dialog_field(self, field: str) -> str:
        return f'#dialog [data-field="{field}"]'

    def dialog_val(self, field: str) -> Any:
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

    def dialog_set_val(self, field: str, val: str | bool | int | dict[str, bool]) -> None:
        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "checkbox":
            assert isinstance(val, bool)
            self.browser.set_checked(sel, val)
        elif ftype == "select-spaces":
            assert isinstance(val, dict)
            for label, value in val.items():
                self.browser.set_checked(f'{sel} [data-space-name="{label}"] input', value)
        elif ftype == "size-slider":
            self.browser.set_val(sel + " .size-unit select", "1000000")
            self.browser.set_input_text(sel + " .size-text input", str(val))
        elif ftype == "select":
            self.browser._wait_present(sel + f" select option[value='{val}']:not([disabled])")
            self.browser.set_val(sel + " select", val)
        elif ftype == "select-radio":
            self.browser.click(sel + f" input[data-data='{val}']")
        elif ftype == "text-input":
            assert isinstance(val, str)
            self.browser.set_input_text(sel, val)
        elif ftype == "text-input-checked":
            if not val:
                self.browser.set_checked(sel + " input[type=checkbox]", val=False)
            else:
                assert isinstance(val, str)
                self.browser.set_checked(sel + " input[type=checkbox]", val=True)
                self.browser.set_input_text(sel + " [type=text]", val)
        elif ftype == "combobox":
            self.browser.click(sel + " button.pf-v6-c-menu-toggle__button")
            self.browser.click(f".pf-v6-c-menu li:contains('{val}') button")
        else:
            self.browser.set_val(sel, val)

    def dialog_combobox_choices(self, field: str) -> Any:
        return self.browser.call_js_func("""(function () {
                                               var lis = ph_find('.pf-v6-c-menu').querySelectorAll('li');
                                               var result = [];
                                               for (i = 0; i < lis.length; ++i)
                                                 result.push(lis[i].textContent);
                                               return result;
                                             })""")

    def dialog_is_present(self, field: str, label: str) -> bool:
        return self.browser.is_present(f'{self.dialog_field(field)} :contains("{label}") input')

    def dialog_wait_val(self, field: str, val: str | bool, unit: str | None = None) -> None:
        if unit is None:
            unit = "1000000"

        sel = self.dialog_field(field)
        ftype = self.browser.attr(sel, "data-field-type")
        if ftype == "size-slider":
            self.browser.wait_val(sel + " .size-unit select", unit)
            self.browser.wait_val(sel + " .size-text input", str(val))
        elif ftype == "select":
            self.browser.wait_attr(sel, "data-value", val)
        elif ftype == "checkbox":
            self.browser.wait_visible(sel + (":checked" if val else ":not(:checked)"))
        else:
            self.browser.wait_val(sel, val)

    def dialog_wait_error(self, field: str, val: str) -> None:
        # XXX - allow for more than one error
        self.browser.wait_in_text('#dialog .pf-v6-c-form__helper-text .pf-m-error', val)

    def dialog_wait_not_present(self, field: str) -> None:
        self.browser.wait_not_present(self.dialog_field(field))

    def dialog_wait_apply_enabled(self) -> None:
        self.browser.wait_attr('#dialog button.apply:nth-of-type(1)', "disabled", None)

    def dialog_wait_apply_disabled(self) -> None:
        self.browser.wait_visible('#dialog button.apply:nth-of-type(1)[disabled]')

    def dialog_apply(self) -> None:
        self.browser.click('#dialog button.apply:nth-of-type(1)')

    def dialog_apply_secondary(self) -> None:
        self.browser.click('#dialog button.apply:nth-of-type(2)')

    def dialog_cancel(self) -> None:
        self.browser.click('#dialog button.cancel')

    def dialog_wait_close(self) -> None:
        # file system operations often take longer than 10s
        with self.browser.wait_timeout(max(self.browser.timeout, 60)):
            self.browser.wait_not_present('#dialog')

    def dialog_check(self, expect: Mapping[str, Any]) -> bool:
        for f in expect:
            if not self.dialog_val(f) == expect[f]:
                return False
        return True

    def dialog_set_vals(self, values: JsonObject) -> None:
        # Sometimes a certain field needs to be set before other
        # fields come into existence and thus the order matters that
        # we set the fields in.  The tests however just give us a
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
            elif last_error is not None:
                raise last_error

    def dialog(self, values: JsonObject, expect: JsonObject | None = None, secondary: bool = False) -> None:
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

    def confirm(self) -> None:
        self.dialog({})

    # There is some asynchronous activity in the storage stack.  (It
    # used to be much worse, but it has improved over the years, yay!)
    #
    # The tests deal with that by waiting for the right conditions,
    # which sometimes means opening a dialog a couple of times until
    # it has the right contents, or applying it a couple of times
    # until it works.

    def dialog_open_with_retry(self, trigger: Callable[[], None], expect: Mapping[str, Any] | Callable[[], bool]) -> None:
        def setup() -> None:
            trigger()
            self.dialog_wait_open()

        def check() -> bool:
            if callable(expect):
                return expect()
            else:
                return self.dialog_check(expect)

        def teardown() -> None:
            self.dialog_cancel()
            self.dialog_wait_close()
        self.retry(check, setup, teardown)

    def dialog_apply_with_retry(self, expected_errors: Collection[str] | None = None) -> None:
        def step() -> bool:
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

    def dialog_with_retry(self, trigger: Callable[[], None], values: Mapping[str, Any], expect: Callable[[], bool] | Mapping[str, Any]) -> None:
        self.dialog_open_with_retry(trigger, expect)
        if values:
            for f in values:
                self.dialog_set_val(f, values[f])
            self.dialog_apply()
        else:
            self.dialog_cancel()
        self.dialog_wait_close()

    def dialog_with_error_retry(self, trigger: Callable[[], None], errors: Iterable[str], values: JsonObject | None = None,
                                first_setup: Callable[[], None] | None = None, retry_setup: Callable[[], None] | None = None,
                                setup: Callable[[], None] | None = None) -> None:
        def doit() -> bool:
            nonlocal first_setup
            trigger()
            self.dialog_wait_open()
            if values:
                self.dialog_set_vals(values)
            if first_setup:
                first_setup()
                first_setup = None
            elif retry_setup:
                retry_setup()
            elif setup:
                setup()
            self.dialog_apply()
            try:
                self.dialog_wait_close()
                return True
            except Exception:
                dialog_text = self.browser.text('#dialog .pf-v6-c-alert__title')
                for err in errors:
                    if err in dialog_text:
                        print("WARNING: retrying dialog")
                        self.dialog_cancel()
                        self.dialog_wait_close()
                        return False
                raise
        self.browser.wait(doit)

    def udisks_objects(self) -> Any:
        return json.loads(self.machine.execute(["python3", "-c", textwrap.dedent("""
            import dbus, json
            print(json.dumps(dbus.SystemBus().call_blocking(
                "org.freedesktop.UDisks2",
                "/org/freedesktop/UDisks2",
                "org.freedesktop.DBus.ObjectManager",
                "GetManagedObjects", "", [])))""")]))

    def configuration_field(self, dev: str, tab: str, field: str) -> str:
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

    def assert_in_configuration(self, dev: str, tab: str, field: str, text: str) -> None:
        self.assertIn(text, self.configuration_field(dev, tab, field))

    def assert_not_in_configuration(self, dev: str, tab: str, field: str, text: str) -> None:
        self.assertNotIn(text, self.configuration_field(dev, tab, field))

    def child_configuration_field(self, dev: str, tab: str, field: str) -> str:
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

    def assert_in_child_configuration(self, dev: str, tab: str, field: str, text: str) -> None:
        self.assertIn(text, self.child_configuration_field(dev, tab, field))

    def lvol_child_configuration_field(self, lvol: str, tab: str, field: str) -> str:
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

    def assert_in_lvol_child_configuration(self, lvol: str, tab: str, field: str, text: str) -> None:
        self.assertIn(text, self.lvol_child_configuration_field(lvol, tab, field))

    def setup_systemd_password_agent(self, password: str) -> None:
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

    def modify_rootfs(self, vgname: str = "root", lvname: str = "root",
                      passphrase: str | None = None) -> None:
        m = self.machine

        # Set up a password agent in the old root and then arrange for
        # it to be included in the initrd.  This will unlock the new
        # encrypted root during boot.
        #
        # The password agent and its initrd configuration will be
        # copied to the new root, so it will stay in place also when
        # the initrd is regenerated again from within the new root.

        if passphrase:
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
        # logical volume, maybe sitting on top of a LUKS container.
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
        # really sure that it won't be used anymore.

        # Assert this is a destructive test which always is a VirtMachine.
        assert isinstance(m, VirtMachine)
        info = m.add_disk("6G", serial="NEWROOT", boot_disk=True)
        dev = "/dev/" + info["dev"]
        wait(lambda: m.execute(f"test -b {dev} && echo present").strip() == "present")
        m.execute(f"""
set -x
parted -s {dev} mktable msdos
parted -s {dev} mkpart primary ext4 1M 500M
parted -s {dev} mkpart primary ext4 500M 100%
if [ "{passphrase}" != "None" ]; then
  echo {passphrase} | cryptsetup luksFormat --pbkdf-memory=300 {dev}2
  luks_uuid=$(blkid -p {dev}2 -s UUID -o value)
  echo {passphrase} | cryptsetup luksOpen --pbkdf-memory=300 {dev}2 luks-$luks_uuid
  vgcreate {vgname} /dev/mapper/luks-$luks_uuid
  luks_karg=rd.luks.uuid=$luks_uuid
else
  vgcreate {vgname} {dev}2
fi
lvcreate {vgname} -n {lvname} -l100%VG
mkfs.ext4 /dev/{vgname}/{lvname}
mkdir /new-root
mount /dev/{vgname}/{lvname} /new-root
mkfs.ext4 {dev}1
# don't move the EFI partition
if mountpoint /boot/efi; then umount /boot/efi; fi
mkdir /new-root/boot
mount {dev}1 /new-root/boot
tar --selinux --one-file-system -cf - --exclude /boot --exclude='/var/tmp/*' --exclude='/var/cache/*' \
    --exclude='/var/lib/mock/*' --exclude='/var/lib/containers/*' --exclude='/new-root/*' \
    / | tar --selinux -C /new-root -xf -
# latest Fedora have /var on a separate subvolume
if mountpoint /var; then
    tar -C /var --selinux --one-file-system -cf - --exclude='tmp/*' --exclude='cache/*' \
        --exclude='lib/mock/*' --exclude='lib/containers/*' \
        . | tar --selinux -C /new-root/var -xf -
fi
tar --one-file-system -C /boot -cf - . | tar -C /new-root/boot -xf -
umount /new-root/boot
mount {dev}1 /boot
echo "(hd0) {dev}" >/boot/grub2/device.map
sed -i -e 's,/boot/,/,' /boot/loader/entries/*
uuid=$(blkid -p /dev/{vgname}/{lvname} -s UUID -o value)
buuid=$(blkid -p {dev}1 -s UUID -o value)
echo "UUID=$uuid / auto defaults 0 0" >/new-root/etc/fstab
echo "UUID=$buuid /boot auto defaults 0 0" >>/new-root/etc/fstab
if [ "{passphrase}" != "None" ]; then dracut --regenerate-all --force; fi
grub2-install {dev}
( # HACK - grub2-mkconfig messes with /boot/loader/entries/ and /etc/kernel/cmdline
  mv /boot/loader/entries /boot/loader/entries.stowed
  ! test -f /etc/kernel/cmdline || mv /etc/kernel/cmdline /etc/kernel/cmdline.stowed
  grub2-mkconfig -o /boot/grub2/grub.cfg
  mv /boot/loader/entries.stowed /boot/loader/entries
  ! test -f /etc/kernel/cmdline.stowed || mv /etc/kernel/cmdline.stowed /etc/kernel/cmdline
)
grubby --update-kernel=ALL --args="root=UUID=$uuid rootflags=defaults $luks_karg rd.lvm.lv={vgname}/{lvname}"
! test -f /etc/kernel/cmdline || cp /etc/kernel/cmdline /new-root/etc/kernel/cmdline
""", timeout=300)
        # destroy bootability of the current root partition, just to make sure
        m.execute("rm -rf /etc/*")
        m.reboot()
        self.assertEqual(m.execute("findmnt -n -o SOURCE /").strip(), f"/dev/mapper/{vgname}-{lvname}")

    # Cards and tables

    def card(self, title: str) -> str:
        return f"[data-test-card-title='{title}']"

    def card_parent_link(self) -> str:
        return ".pf-v6-c-breadcrumb__item:nth-last-child(2) > a"

    def card_header(self, title: str) -> str:
        return self.card(title) + " .pf-v6-c-card__header"

    def card_row(self, title: str, index: int | None = None, name: str | None = None, location: str | None = None, table_index: int = 1) -> str:
        pfx = self.card(title) + f" table:nth-of-type({table_index})"
        if index is not None:
            return pfx + f" tbody tr:nth-child({index})"
        elif name is not None:
            name = name.replace("/dev/", "")
            return pfx + f" tbody [data-test-row-name='{name}']"
        else:
            return pfx + f" tbody [data-test-row-location='{location}']"

    def click_card_row(self, title: str, index: int | None = None, name: str | None = None, location: str | None = None, table_index: int = 1) -> None:
        self.browser.click_button("id-link", self.card_row(title, index, name, location, table_index))

    def card_row_col(self, title: str, row_index: int | None = None, col_index: int | None = None,
                     row_name: str | None = None, row_location: str | None = None, table_index: int = 1) -> str:
        return self.card_row(title, row_index, row_name, row_location, table_index) + f" td:nth-child({col_index})"

    def card_desc(self, card_title: str, desc_title: str) -> str:
        return self.card(card_title) + f" [data-test-desc-title='{desc_title}'] [data-test-value=true]"

    def card_desc_action(self, card_title: str, desc_title: str) -> str:
        return self.card(card_title) + f" [data-test-desc-title='{desc_title}'] [data-test-action=true] button"

    def card_button(self, card_title: str, button_title: str) -> str:
        return self.card(card_title) + f" button:contains('{button_title}')"

    def dropdown_toggle(self, parent: str) -> str:
        return parent + " .pf-v6-c-menu-toggle"

    def dropdown_action(self, title: str) -> str:
        return f".pf-v6-c-menu button:contains('{title}')"

    def dropdown_description(self, title: str) -> str:
        return f".pf-v6-c-menu button:contains('{title}') .pf-v6-c-menu__item-description"

    def click_dropdown(self, parent: str, title: str) -> None:
        self.browser.click(self.dropdown_toggle(parent))
        self.browser.click(self.dropdown_action(title))

    def click_card_dropdown(self, card_title: str, button_title: str) -> None:
        self.click_dropdown(self.card_header(card_title), button_title)

    def click_devices_dropdown(self, title: str) -> None:
        self.click_card_dropdown("Storage", title)

    def check_dropdown_action_disabled(self, parent: str, title: str, expected_text: str) -> None:
        self.browser.click(self.dropdown_toggle(parent))
        self.browser.wait_visible(self.dropdown_action(title) + "[disabled]")
        self.browser.wait_text(self.dropdown_description(title), expected_text)
        self.browser.click(self.dropdown_toggle(parent))

    def wait_mounted(self, card_title: str) -> None:
        with self.browser.wait_timeout(30):
            self.browser.wait_not_in_text(self.card_desc(card_title, "Mount point"),
                                          "The filesystem is not mounted.")

    def wait_not_mounted(self, card_title: str) -> None:
        with self.browser.wait_timeout(30):
            self.browser.wait_in_text(self.card_desc(card_title, "Mount point"),
                                      "The filesystem is not mounted.")

    def wait_card_button_disabled(self, card_title: str, button_title: str) -> None:
        with self.browser.wait_timeout(30):
            self.browser.wait_visible(self.card_button(card_title, button_title) + ":disabled")


class StorageCase(StorageHelpers):

    def setUp(self) -> None:

        if self.image == "fedora-coreos":
            self.skipTest("No udisks/cockpit-storaged on OSTree images")

        super().setUp()

        ver = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager Version || true")
        m = re.match(r's "(.*)"', ver)
        if m:
            self.storaged_version = list(map(int, m.group(1).split(".")))
        else:
            self.storaged_version = [0]

        crypto_types = self.machine.execute("busctl --system get-property org.freedesktop.UDisks2 /org/freedesktop/UDisks2/Manager org.freedesktop.UDisks2.Manager SupportedEncryptionTypes || true")
        if "luks2" in crypto_types:
            self.default_crypto_type = "luks2"
        else:
            self.default_crypto_type = "luks1"

        # OSTree friendly, automatically unmounted and cleaned up
        self.mnt_dir = os.path.join(self.vm_tmpdir, "mnt")
        self.machine.execute(f"mkdir -p {self.mnt_dir}")

        if self.image.startswith("rhel-8"):
            # HACK: missing /etc/crypttab file upsets udisks: https://github.com/storaged-project/udisks/pull/835
            self.machine.write("/etc/crypttab", "")

        # starting out with empty PCP logs and pmlogger not running causes these metrics channel messages
        self.allow_journal_messages("pcp-archive: no such metric: disk.*")

        # UDisks2 invalidates the Size property and cockpit-bridge
        # gets it immediately.  But sometimes the interface is already
        # gone.
        self.allow_journal_messages("org.freedesktop.UDisks2: couldn't get property org.freedesktop.UDisks2.Filesystem Size .* No such interface.*")


class StorageSmartCase(StorageCase):
    provision = {
        "0": {
            "disk_bus": "sata",
            "disk_dev": "sda",
        }
    }
