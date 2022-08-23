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

import functools
import os
import subprocess
import time
import unittest
import xml.etree.ElementTree as ET

import parent
from testlib import *
from netlib import NetworkCase


def readFile(name):
    content = ''
    if os.path.exists(name):
        with open(name, 'r') as f:
            content = f.read().replace('\n', '')
    return content


# Preparations for physical disk storage pool
def prepareDisk(m):
    m.add_disk("50M", serial="DISK1")
    wait(lambda: m.execute("ls -l /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_DISK1"))
    m.execute("parted /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_DISK1 mklabel gpt")


SPICE_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='spice' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
      <image compression='off'/>
    </graphics>
"""

VNC_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='vnc' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
"""

CONSOLE_XML = """
    <console type='file'>
      <target type='serial' port='0'/>
      <source path='{log}'/>
    </console>
"""

PTYCONSOLE_XML = """
    <serial type='pty'>
      <source path='/dev/pts/3'/>
      <target port='0'/>
      <alias name='serial0'/>
    </serial>
    <console type='pty' tty='/dev/pts/3'>
      <source path='/dev/pts/3'/>
      <target type='serial' port='0'/>
      <alias name='serial0'/>
    </console>
"""

DOMAIN_XML = """
<domain type='qemu'>
  <name>{name}</name>
  <vcpu>1</vcpu>
  <os>
    <type arch='x86_64'>hvm</type>
    <boot dev='hd'/>
    <boot dev='network'/>
  </os>
  <memory unit='MiB'>256</memory>
  <currentMemory unit='MiB'>256</currentMemory>
  <features>
    <acpi/>
  </features>
  <devices>
    <disk type='block' device='disk'>
      <driver name='qemu' type='raw'/>
      <source dev='/dev/{disk}'/>
      <target dev='vda' bus='virtio'/>
      <serial>ROOT</serial>
    </disk>
    <disk type='file' snapshot='external'>
      <driver name='qemu' type='qcow2'/>
      <source file='{image}'/>
      <target dev='vdb' bus='virtio'/>
      <serial>SECOND</serial>
    </disk>
    <controller type='scsi' model='virtio-scsi' index='0' id='hot'/>
    <interface type='network'>
      <source network='default' bridge='virbr0'/>
      <target dev='vnet0'/>
    </interface>
    {console}
    {graphics}
  </devices>
</domain>
"""

POOL_XML = """
<pool type='dir'>
  <name>images</name>
  <target>
    <path>{path}</path>
  </target>
</pool>
"""

VOLUME_XML = """
<volume type='file'>
  <name>{name}</name>
  <key>{image}</key>
  <capacity unit='bytes'>1073741824</capacity>
  <target>
    <path>{image}</path>
    <format type='qcow2'/>
  </target>
</volume>
"""

NETWORK_XML_PXE = """<network>
  <name>pxe-nat</name>
  <forward mode='nat'>
    <nat>
      <port start='1024' end='65535'/>
    </nat>
  </forward>
  <bridge name='virbr0' stp='on' delay='0'/>
  <mac address='52:54:00:53:7d:8e'/>
  <ip address='192.168.122.1' netmask='255.255.255.0'>
    <tftp root='/var/lib/libvirt/pxe-config'/>
    <dhcp>
      <range start='192.168.122.2' end='192.168.122.254'/>
      <bootp file='pxe.cfg'/>
    </dhcp>
  </ip>
</network>"""

PXE_SERVER_CFG = """#!ipxe

echo Rebooting in 60 seconds
sleep 60
reboot"""


# If this test fails to run, the host machine needs:
# echo "options kvm-intel nested=1" > /etc/modprobe.d/kvm-intel.conf
# rmmod kvm-intel; modprobe kvm-intel || true


@skipImage("Atomic cannot run virtual machines", "fedora-atomic", "rhel-atomic", "continuous-atomic")
class TestMachines(NetworkCase):
    created_pool = False
    provider = None

    def setUp(self):
        MachineCase.setUp(self)
        self.startLibvirt()

        # enforce use of cockpit-machines instead of cockpit-machines-ovirt
        m = self.machine
        m.execute(
            "sed -i 's/\"priority\".*$/\"priority\": 100,/' {0}".format("/usr/share/cockpit/machines/manifest.json"))
        m.execute(
            "[ ! -e {0} ] || sed -i 's/\"priority\".*$/\"priority\": 0,/' {0}".format("/usr/share/cockpit/ovirt/manifest.json"))
        # we don't have configuration to open the firewall for local libvirt machines, so just stop firewalld
        m.execute("systemctl stop firewalld; systemctl try-restart libvirtd")

    def startLibvirt(self):
        m = self.machine
        # Ensure everything has started correctly
        m.execute("systemctl start libvirtd.service")
        # Wait until we can get a list of domains
        wait(lambda: m.execute("virsh list"))
        # Wait for the network 'default' to become active
        wait(lambda: m.execute(command="virsh net-info default | grep Active"))

    def startVm(self, name, graphics='spice', ptyconsole=False):
        m = self.machine

        image_file = m.pull("cirros")
        m.add_disk(serial="NESTED", path=image_file, type="qcow2")
        # Wait for the disk to be added
        wait(lambda: m.execute("ls -l /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_NESTED"))

        img = "/var/lib/libvirt/images/{0}-2.img".format(name)
        output = m.execute("readlink /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_NESTED").strip().split("\n")[-1]

        args = {
            "name": name,
            "disk": os.path.basename(output),
            "image": img,
            "logfile": None,
            "console": "",
        }

        if ptyconsole:
            args["console"] = PTYCONSOLE_XML
        else:
            m.execute("chmod 777 /var/log/libvirt")
            args["logfile"] = "/var/log/libvirt/console-{0}.log".format(name)
            args["console"] = CONSOLE_XML.format(log=args["logfile"])

        if graphics == 'spice':
            cxml = SPICE_XML
        elif graphics == 'vnc':
            cxml = VNC_XML
        elif graphics == 'none':
            cxml = ""
        else:
            assert False, "invalid value for graphics"
        args["graphics"] = cxml.format(**args)

        if not self.created_pool:
            xml = POOL_XML.format(path="/var/lib/libvirt/images")
            m.execute("echo \"{0}\" > /tmp/xml; virsh pool-define /tmp/xml; virsh pool-start images".format(xml))
            self.created_pool = True

        xml = VOLUME_XML.format(name=os.path.basename(img), image=img)
        m.execute("echo \"{0}\" > /tmp/xml; virsh vol-create images /tmp/xml".format(xml))

        xml = DOMAIN_XML.format(**args)
        m.execute("echo \"{0}\" > /tmp/xml; virsh define /tmp/xml; virsh start {1}".format(xml, name))

        m.execute('[ "$(virsh domstate {0})" = running ] || '
                  '{{ virsh dominfo {0} >&2; cat /var/log/libvirt/qemu/{0}.log >&2; exit 1; }}'.format(name))

        self.allow_journal_messages('.*denied.*search.*"qemu-.*".*dev="proc".*')
        self.allow_journal_messages('.*denied.*comm="pmsignal".*')

        return args

    def testState(self):
        b = self.browser
        m = self.machine
        name = "subVmTest1"
        args = self.startVm(name)

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running")

        m.execute('[ "$(virsh domstate {0})" = running ] || '
                  '{{ virsh dominfo {0} >&2; cat /var/log/libvirt/qemu/{0}.log >&2; exit 1; }}'.format(name))

        return args

    def testBasic(self):
        b = self.browser
        m = self.machine

        args = self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running")
        b.wait_in_text("#vm-subVmTest1-vcpus", "1")

        b.wait_in_text("#vm-subVmTest1-bootorder", "disk,network")
        emulated_machine = b.text("#vm-subVmTest1-emulatedmachine")
        self.assertTrue(len(emulated_machine) > 0) # emulated machine varies across test machines

        def get_usage(selector):
            i = 0
            content = b.text(selector)
            while content[i].isdigit() or content[i] == ".":
                i += 1
            return float(content[:i])

        # switch to and check Usage
        b.click("#vm-subVmTest1-usage")
        b.wait_in_text("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption", "256 MiB")
        b.wait_present("#chart-donut-0 .donut-title-big-pf")
        b.wait(lambda: get_usage("#chart-donut-0") > 0.0)
        b.wait_in_text("tbody.open .listing-ct-body td:nth-child(2) .usage-donut-caption", "1 vCPU")
        # CPU usage cannot be nonzero with blank image, so just ensure it's a percentage
        b.wait_present("#chart-donut-1 .donut-title-big-pf")
        self.assertLessEqual(get_usage("#chart-donut-1"), 100.0)

        # suspend/resume
        m.execute("virsh suspend subVmTest1")
        b.wait_in_text("#vm-subVmTest1-state", "paused")
        # resume sometimes fails with "unable to execute QEMU command 'cont': Resetting the Virtual Machine is required"
        m.execute('virsh resume subVmTest1 || { virsh destroy subVmTest1; virsh start subVmTest1; }')
        b.wait_in_text("#vm-subVmTest1-state", "running")

        if args["logfile"] is not None:
            wait(lambda: "Linux version" in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Wait for the system to completely start
        if args["logfile"] is not None:
            wait(lambda: "login as 'cirros' user." in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Send Non-Maskable Interrupt (no change in VM state is expected)
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-sendNMI")
        b.wait_not_visible("#vm-subVmTest1-sendNMI")

        if args["logfile"] is not None:
            b.wait(lambda: "NMI received" in self.machine.execute("cat {0}".format(args["logfile"])))

        # shut off
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # continue shut off validation - usage should drop to zero
        b.wait(lambda: get_usage("#chart-donut-0") == 0.0)
        b.wait(lambda: get_usage("#chart-donut-1") == 0.0)

        # start another one, should appear automatically
        self.startVm("subVmTest2")
        b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.click("#virtual-machines-listing .listing-ct tbody:nth-of-type(2) th") # click on the row header
        b.wait_in_text("#vm-subVmTest2-state", "running")
        b.wait_in_text("#vm-subVmTest2-vcpus", "1")
        b.wait_in_text("#vm-subVmTest2-bootorder", "disk,network")

        # restart libvirtd
        m.execute("systemctl stop libvirtd.service")
        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        m.execute("systemctl start libvirtd.service")
        # HACK: https://launchpad.net/bugs/1802005
        if self.provider == "libvirt-dbus" and m.image == "ubuntu-stable":
            m.execute("chmod o+rwx /run/libvirt/libvirt-sock")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr[data-row-id=vm-subVmTest1] th")
        b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type(1) th", "subVmTest1")
        b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")
        b.wait_in_text("#vm-subVmTest2-state", "running")

        # stop second VM, event handling should still work
        b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.click("#virtual-machines-listing .listing-ct tbody:nth-of-type(2) th") # click on the row header
        b.click("#vm-subVmTest2-off-caret")
        b.click("#vm-subVmTest2-forceOff")
        b.wait_in_text("#vm-subVmTest2-state", "shut off")

        # test VM error messages
        b.click("#vm-subVmTest2-run")
        b.click("#vm-subVmTest2-run") # make use of slow processing - the button is still present; will cause error
        # triangle by status
        b.wait_present("tr.listing-ct-item.listing-ct-nonavigate span span.pficon-warning-triangle-o.machines-status-alert")
        # inline notification with error
        b.wait_in_text("div.alert.alert-danger strong", "VM subVmTest2 failed to start")

        b.wait_in_text("a.alert-link.more-button", "show more") # more/less button
        b.click("a.alert-link.more-button")
        b.wait_present("a.alert-link + p")

        # the message when trying to start active VM differs between virsh and libvirt-dbus provider
        if (self.provider == "libvirt-dbus"):
            b.wait_in_text("a.alert-link + p",
                           "domain is already running")
        else:
            b.wait_in_text("a.alert-link + p",
                           "Domain is already active")

        b.wait_in_text("a.alert-link.more-button", "show less")
        b.click("div.alert.alert-danger button") # close button
        # inline notification is gone
        b.wait_not_present("div.alert.alert-danger")
        # triangle by status is gone
        b.wait_not_present(
            "tr.listing-ct-item.listing-ct-nonavigate span span.pficon-warning-triangle-o.machines-status-alert")

        # Check correctness of the toast notifications list
        # We 'll create errors by starting to start domains when the default network in inactive
        self.startVm("subVmTest3")
        m.execute("virsh destroy subVmTest2; virsh destroy subVmTest3; virsh net-destroy default")

        def tryRunDomain(index, name):
            b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type({0}) th".format(index), name)

            row_classes = b.attr("#virtual-machines-listing .listing-ct tbody:nth-of-type({0})".format(index), "class")
            expanded = row_classes and 'open' in row_classes
            if not expanded:
                b.click("#virtual-machines-listing .listing-ct tbody:nth-of-type({0}) th".format(index)) # click on the row header

            b.click("#vm-{0}-run".format(name))

        # Try to run subVmTest1 - it will fail because of inactive default network
        tryRunDomain(1, 'subVmTest1')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) strong", "VM subVmTest1 failed to start")

        # Try to run subVmTest2
        tryRunDomain(2, 'subVmTest2')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(2) strong", "VM subVmTest2 failed to start")

        # Delete the first notification and check notifications list again
        b.focus(".toast-notifications-list-pf")
        b.click(".toast-notifications-list-pf div:nth-child(1) button.close")
        b.wait_not_present(".toast-notifications-list-pf div:nth-child(2) strong")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) strong", "VM subVmTest2 failed to start")

        # Add one more notification
        tryRunDomain(3, 'subVmTest3')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) strong", "VM subVmTest2 failed to start")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(2) strong", "VM subVmTest3 failed to start")

        # Delete the last notification
        b.focus(".toast-notifications-list-pf")
        b.click(".toast-notifications-list-pf div:nth-child(2) button.close")
        b.wait_not_present(".toast-notifications-list-pf div:nth-child(2) strong")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) strong", "VM subVmTest2 failed to start")

    def wait_for_disk_stats(self, name, target):
        b = self.browser
        try:
            with b.wait_timeout(10):
                b.wait_present("#vm-{0}-disks-{1}-used".format(name, target)) # wait for disk statistics to show up
        except Error as ex:
            if not ex.msg.startswith('timeout'):
                raise
            # stats did not show up, check if user message showed up
            print("Libvirt version does not support disk statistics")
            b.wait_present("#vm-{0}-disks-notification".format(name))

    def testLibvirt(self):
        b = self.browser
        m = self.machine

        libvirtServiceName = "libvirtd.service"

        def checkLibvirtEnabled():
            try:
                m.execute("systemctl -q is-enabled {0}".format(libvirtServiceName))
                return True
            except subprocess.CalledProcessError:  # return code != 0
                return False

        self.startVm("subVmTest1")
        self.login_and_go("/machines")

        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        m.execute("systemctl disable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")
        b.click("#start-libvirt")

        b.wait_in_text("body", "Virtual Machines")
        # HACK: https://launchpad.net/bugs/1802005
        if self.provider == "libvirt-dbus" and m.image == "ubuntu-stable":
            m.execute("chmod o+rwx /run/libvirt/libvirt-sock")
        b.wait(lambda: checkLibvirtEnabled())
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        m.execute("systemctl stop {0}".format(libvirtServiceName))
        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")
        b.click("#enable-libvirt") # uncheck it ; ; TODO: fix this, do not assume initial state of the checkbox
        b.click("#start-libvirt")
        b.wait_in_text("body", "Virtual Machines")
        # HACK: https://launchpad.net/bugs/1802005
        if self.provider == "libvirt-dbus" and m.image == "ubuntu-stable":
            m.execute("chmod o+rwx /run/libvirt/libvirt-sock")
        b.wait(lambda: not checkLibvirtEnabled())
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        m.execute("systemctl enable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")

        b.click("#troubleshoot")
        b.leave_page()
        url_location = "/system/services#/{0}".format(libvirtServiceName)
        b.wait(lambda: url_location in b.eval_js("window.location.href"))

    def testDisks(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

        # Test basic disk properties
        b.wait_in_text("#vm-subVmTest1-disks-vda-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vdb-bus", "virtio")

        b.wait_in_text("#vm-subVmTest1-disks-vda-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vdb-device", "disk")

        b.wait_in_text("#vm-subVmTest1-disks-vdb-source-file", "/var/lib/libvirt/images/subVmTest1-2.img")

        # Test domstats
        self.wait_for_disk_stats("subVmTest1", "vda")
        if b.is_present("#vm-subVmTest1-disks-vda-used"):
            b.wait_in_text("#vm-subVmTest1-disks-vda-used", "0.0")
            b.wait_in_text("#vm-subVmTest1-disks-vdb-used", "0.0")

            b.wait_in_text("#vm-subVmTest1-disks-vdb-capacity", "1")

        # Test add disk by external action
        m.execute("qemu-img create -f raw /var/lib/libvirt/images/image3.img 128M")
        # attach to the virtio bus instead of ide
        m.execute("virsh attach-disk subVmTest1 /var/lib/libvirt/images/image3.img vdc")

        b.wait_present("#vm-subVmTest1-disks-vdb-used")

        b.wait_in_text("#vm-subVmTest1-disks-vda-bus", "virtio")

        b.wait_in_text("#vm-subVmTest1-disks-vdc-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-source-file", "/var/lib/libvirt/images/image3.img")

        self.wait_for_disk_stats("subVmTest1", "vdc")
        if b.is_present("#vm-subVmTest1-disks-vdc-used"):
            b.wait_in_text("#vm-subVmTest1-disks-vdc-used", "0.00")
            b.wait_in_text("#vm-subVmTest1-disks-vdc-capacity", "0.13") # 128 MB

        # Test remove disk - by external action
        m.execute("virsh detach-disk subVmTest1 vdc")
        print("Restarting vm-subVmTest1, might take a while")
        b.click("#vm-subVmTest1-reboot-caret")
        b.click("#vm-subVmTest1-forceReboot")

        b.wait_not_present("#vm-subVmTest1-disks-vdc-device")

    # Test Add Disk via dialog
    def testAddDisk(self):
        b = self.browser
        m = self.machine

        class VMAddDiskDialog(object):
            def __init__(
                self, test_obj, pool_name=None, volume_name=None,
                vm_name='subVmTest1',
                volume_size=1, volume_size_unit='GiB',
                use_existing_volume=False,
                expected_target='vda', permanent=False, cache_mode=None,
                verify=True, pool_type=None,
                volume_format=None,
            ):
                print(pool_name, volume_name)
                self.test_obj = test_obj
                self.vm_name = vm_name
                self.pool_name = pool_name
                self.use_existing_volume = use_existing_volume
                self.volume_name = volume_name
                self.volume_size = volume_size
                self.volume_size_unit = volume_size_unit
                self.expected_target = expected_target
                self.permanent = permanent
                self.cache_mode = cache_mode
                self.verify = verify
                self.pool_type = pool_type
                self.volume_format = volume_format

            def execute(self):
                self.open()
                self.fill()
                self.add_disk()
                self.verify_disk_added()

            def open(self):
                b.click("#vm-{0}-disks-adddisk".format(self.vm_name)) # button
                b.wait_in_text(".modal-dialog .modal-header .modal-title", "Add Disk")

                b.wait_present("label:contains(Create New)")
                if self.use_existing_volume:
                    b.click("label:contains(Use Existing)")

                return self

            def fill(self):
                if not self.use_existing_volume:
                    # Choose storage pool
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-new-select-pool".format(self.vm_name), self.pool_name)
                    # Insert name for the new volume
                    b.set_input_text("#vm-{0}-disks-adddisk-new-name".format(self.vm_name), self.volume_name)
                    # Insert size for the new volume
                    b.set_input_text("#vm-{0}-disks-adddisk-new-size".format(self.vm_name), str(self.volume_size))
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-new-unit".format(self.vm_name), self.volume_size_unit)

                    if self.volume_format:
                        b.select_from_dropdown("#vm-{0}-disks-adddisk-new-diskfileformat".format(self.vm_name), self.volume_format)

                    # Configure persistency - by default the check box in unchecked for running VMs
                    if self.permanent:
                        b.click("#vm-{0}-disks-adddisk-new-permanent".format(self.vm_name))
                else:
                    # Choose storage pool
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-existing-select-pool".format(self.vm_name), self.pool_name)
                    # Select from the available volumes
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-existing-select-volume".format(self.vm_name), self.volume_name)

                    # Configure persistency - by default the check box in unchecked for running VMs
                    if self.permanent:
                        b.click("#vm-{0}-disks-adddisk-existing-permanent".format(self.vm_name))

                # Configure performance options
                if self.test_obj.provider == "libvirt-dbus" and self.cache_mode:
                    b.click("div.modal-dialog button:contains(Show Performance Options)")
                    b.select_from_dropdown("div.modal-dialog #cache-mode", self.cache_mode)
                else:
                    b.wait_not_present("#div.modal-dialog #cache-mode")

                return self

            def add_disk(self):
                b.click(".modal-footer button:contains(Add)")
                b.wait_not_present("vm-{0}-disks-adddisk-dialog-modal-window".format(self.vm_name))

                return self

            def verify_disk_added(self):
                b.wait_in_text("#vm-{0}-disks-{1}-bus".format(self.vm_name, self.expected_target), "virtio")
                b.wait_in_text("#vm-{0}-disks-{1}-device".format(self.vm_name, self.expected_target), "disk")

                # Detect volume format
                detect_format_cmd = "virsh vol-dumpxml {0} {1} | xmllint --xpath '/volume/target/format' -".format(self.volume_name, self.pool_name)

                if self.test_obj.provider == "libvirt-dbus":
                    b.wait_in_text('#vm-{0}-disks-{1}-source-volume'.format(self.vm_name, self.expected_target), self.volume_name)
                    if self.cache_mode:
                        b.wait_in_text("#vm-{0}-disks-{1}-cache".format(self.vm_name, self.expected_target), self.cache_mode)
                    # Guess by the name of the pool it's format to avoid passing more parameters
                    if self.pool_type == 'iscsi':
                        expected_format = 'unknown'
                    elif self.pool_type == 'disk':
                        expected_format = 'none'
                    else:
                        expected_format = 'qcow2'

                    self.test_obj.assertEqual(
                        m.execute(detect_format_cmd).rstrip(),
                        '<format type="{0}"/>'.format(self.volume_format or expected_format)
                    )
                else:
                    if self.pool_type == 'disk':
                        b.wait_in_text('#vm-{0}-disks-{1}-source-device'.format(self.vm_name, self.expected_target), self.volume_name)
                    else:
                        b.wait_in_text('#vm-{0}-disks-{1}-source-file'.format(self.vm_name, self.expected_target), self.volume_name)

                return self

        # prepare libvirt storage pools
        m.execute("mkdir /mnt/vm_one ; mkdir /mnt/vm_two ; mkdir /mnt/default_tmp ; chmod a+rwx /mnt/vm_one /mnt/vm_two /mnt/default_tmp")
        m.execute("virsh pool-define-as default_tmp --type dir --target /mnt/default_tmp; virsh pool-start default_tmp")
        m.execute("virsh pool-define-as myPoolOne --type dir --target /mnt/vm_one; virsh pool-start myPoolOne")
        m.execute("virsh pool-define-as myPoolTwo --type dir --target /mnt/vm_two; virsh pool-start myPoolTwo")

        m.execute("virsh vol-create-as default_tmp defaultVol --capacity 1G --format qcow2")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_temporary --capacity 1G --format qcow2")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_permanent --capacity 1G --format qcow2")
        wait(lambda: "mydiskofpooltwo_permanent" in m.execute("virsh vol-list myPoolTwo"))

        # Prepare a local NFS pool
        m.execute("mkdir /mnt/nfs-pool; mkdir /mnt/exports; echo '/mnt/exports 127.0.0.1/24(rw,sync,no_root_squash,no_subtree_check,fsid=0)' > /etc/exports")
        m.execute("systemctl restart nfs-server")
        m.execute("virsh pool-define-as nfs-pool --type netfs --target /mnt/nfs-pool --source-host 127.0.0.1 --source-path /mnt/exports; virsh pool-start nfs-pool")
        # And create a volume on it in order to test use existing volume dialog
        m.execute("virsh vol-create-as --pool nfs-pool --name nfs-volume-0 --capacity 1M --format qcow2")

        # Prepare an iscsi pool
        # Debian and ubuntu images don't have open-iscsi already installed
        # FIXME: Add open-iscsi to debian and ubuntu images
        if "debian" not in m.image and "ubuntu" not in m.image:
            # Preparations for testing ISCSI pools

            target_iqn = "iqn.2019-09.cockpit.lan"
            orig_iqn = m.execute("sed </etc/iscsi/initiatorname.iscsi -e 's/^.*=//'").rstrip()

            # Increase the iSCSI timeouts for heavy load during our testing
            m.execute("""sed -i 's|^\(node\..*log.*_timeout = \).*|\\1 60|' /etc/iscsi/iscsid.conf""")

            # Setup a iSCSI target
            m.execute("""
                      targetcli /backstores/ramdisk create test 50M
                      targetcli /iscsi create %(tgt)s
                      targetcli /iscsi/%(tgt)s/tpg1/luns create /backstores/ramdisk/test
                      targetcli /iscsi/%(tgt)s/tpg1/acls create %(ini)s
                      """ % {"tgt": target_iqn, "ini": orig_iqn})

            m.execute("virsh pool-define-as iscsi-pool --type iscsi --target /dev/disk/by-path --source-host 127.0.0.1 --source-dev {0}; virsh pool-start iscsi-pool".format(target_iqn))
            wait(lambda: "unit:0:0:0" in self.machine.execute("virsh pool-refresh iscsi-pool; virsh vol-list iscsi-pool"), delay=3)

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th")
        b.wait_in_text("#vm-subVmTest1-state", "running")
        b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='mydiskofpoolone_temporary',
            use_existing_volume=False,
            volume_size=2048,
            volume_size_unit='MiB',
            permanent=False,
            expected_target='vdc',
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='mydiskofpoolone_permanent',
            use_existing_volume=False,
            volume_size=2,
            permanent=True,
            cache_mode='writeback',
            expected_target='vdd',
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            use_existing_volume=True,
        ).open()
        b.select_from_dropdown("#vm-subVmTest1-disks-adddisk-existing-select-pool", "myPoolOne")
        # since both disks are already attached
        b.wait_attr("#vm-subVmTest1-disks-adddisk-existing-select-volume", "disabled", "")
        b.wait_in_text("#vm-subVmTest1-disks-adddisk-existing-select-volume", "The pool is empty")
        b.click("#vm-subVmTest1-disks-adddisk-dialog-cancel")
        b.wait_not_present("#vm-subVmTest1-test-disks-adddisk-dialog-modal-window")

        VMAddDiskDialog(
            self,
            pool_name='myPoolTwo',
            volume_name='mydiskofpooltwo_permanent',
            volume_size=2,
            permanent=True,
            use_existing_volume=True,
            expected_target='vde',
        ).execute()

        # check the autoselected options
        # default_tmp pool should be autoselected since it's the first in alphabetical order
        # defaultVol volume should be autoselected since it's the only volume in default_tmp pool
        VMAddDiskDialog(
            self,
            pool_name='default_tmp',
            volume_name='defaultVol',
            use_existing_volume=True,
            expected_target='vdf',
        ).open().add_disk().verify_disk_added()

        VMAddDiskDialog(
            self,
            pool_name='nfs-pool',
            volume_name='nfs-volume-0',
            use_existing_volume=True,
            volume_size=1,
            volume_size_unit='MiB',
            expected_target='vdg',
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='nfs-pool',
            volume_name='nfs-volume-1',
            volume_size=1,
            volume_size_unit='MiB',
            expected_target='vdh',
        ).execute()

        if "debian" not in m.image and "ubuntu" not in m.image and m.image != "centos-7":
            # ISCSI driver does not support virStorageVolCreate API
            VMAddDiskDialog(
                self,
                pool_name='iscsi-pool',
                pool_type='iscsi',
                volume_name='unit:0:0:0',
                expected_target='vdi',
                use_existing_volume='True',
            ).execute()

        # shut off
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # check if the just added non-permanent disks are gone
        b.wait_not_present("#vm-subVmTest1-disks-vdc-device")
        b.wait_not_present("#vm-subVmTest1-disks-vdf-device")
        b.wait_present("#vm-subVmTest1-disks-vdd-device")
        b.wait_present("#vm-subVmTest1-disks-vde-device")

        if self.provider == "libvirt-dbus":
            # Undefine all Storage Pools and  confirm that the Add Disk dialog is disabled
            active_pools = filter(lambda pool: pool != '', m.execute("virsh pool-list --name").split('\n'))
            print(active_pools)
            for pool in active_pools:
                m.execute("virsh pool-destroy {0}".format(pool))
            b.wait_in_text("#card-pf-storage-pools .card-pf-aggregate-status-notification:nth-of-type(1)", "0")
            inactive_pools = filter(lambda pool: pool != '', m.execute("virsh pool-list --inactive --name").split('\n'))
            for pool in inactive_pools:
                m.execute("virsh pool-undefine {0}".format(pool))
            b.wait_in_text("#card-pf-storage-pools .card-pf-aggregate-status-notification:nth-of-type(2)", "0")
            b.click("#vm-subVmTest1-disks-adddisk") # radio button label in modal dialog
            b.wait_present("#vm-subVmTest1-disks-adddisk-dialog-add:disabled")
            b.click("label:contains(Use Existing)")
            b.wait_present("#vm-subVmTest1-disks-adddisk-dialog-add:disabled")
            b.click("#vm-subVmTest1-disks-adddisk-dialog-cancel")

        prepareDisk(self.machine)
        cmds = [
            "virsh pool-define-as pool-disk disk - - /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_DISK1 - /tmp/poolDiskImages",
            "virsh pool-build pool-disk --overwrite",
            "virsh pool-start pool-disk",
        ]
        self.machine.execute("; ".join(cmds))

        partition = str(self.machine.execute("readlink -f /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_DISK1 | cut -d '/' -f 3").strip()) + "1"

        VMAddDiskDialog(
            self,
            pool_name='pool-disk',
            pool_type='disk',
            volume_name=partition,
            volume_size=10,
            volume_size_unit='MiB',
            expected_target='vdc',
        ).execute()

    def testNetworks(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.click("#vm-subVmTest1-networks") # open the "Networks" subtab

        b.wait_in_text("#vm-subVmTest1-network-1-type", "network")
        b.wait_in_text("#vm-subVmTest1-network-1-source", "default")

        b.wait_in_text("#vm-subVmTest1-network-1-state", "up")

        # Test add network
        m.execute("virsh attach-interface --domain subVmTest1 --type network --source default --model virtio --mac 52:54:00:4b:73:5f --config --live")

        b.wait_in_text("#vm-subVmTest1-network-2-type", "network")
        b.wait_in_text("#vm-subVmTest1-network-2-source", "default")
        b.wait_in_text("#vm-subVmTest1-network-2-model", "virtio")
        b.wait_in_text("#vm-subVmTest1-network-2-mac", "52:54:00:4b:73:5f")

        b.wait_in_text("#vm-subVmTest1-network-2-state", "up")

    def testVCPU(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")
        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header

        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.click("#vm-subVmTest1-vcpus-count") # open VCPU modal detail window

        b.wait_present(".modal-body")

        # Test basic vCPU properties
        b.wait_val("#machines-vcpu-count-field", "1")
        b.wait_val("#machines-vcpu-max-field", "1")

        # Set new values
        b.set_input_text("#machines-vcpu-max-field", "4")
        b.set_input_text("#machines-vcpu-count-field", "3")

        # Set new socket value
        b.wait_val("#socketsSelect", "4")
        b.set_val("#socketsSelect", "2")
        b.wait_val("#coresSelect", "1")
        b.wait_val("#threadsSelect", "2")

        # Save
        b.click("#machines-vcpu-modal-dialog-apply")
        b.wait_not_present(".modal-body")

        # Make sure warning next to vcpus appears
        b.wait_present("#vcpus-tooltip")

        # Shut off VM for applying changes after save
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # Make sure warning is gone after shut off
        b.wait_not_present("#vcpus-tooltip")

        # Check changes
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "3")

        # Check after boot
        # Run VM
        b.click("#vm-subVmTest1-run")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        # Check VCPU count
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "3")

        # Open dialog window
        b.click("#vm-subVmTest1-vcpus-count")
        b.wait_present(".modal-body")

        # Check basic values
        b.wait_val("#machines-vcpu-count-field", "3")
        b.wait_val("#machines-vcpu-max-field", "4")

        # Check sockets, cores and threads
        b.wait_val("#socketsSelect", "2")
        b.wait_val("#coresSelect", "1")
        b.wait_val("#threadsSelect", "2")

        b.click("#machines-vcpu-modal-dialog-cancel")
        b.wait_not_present("#machines-vcpu-modal-dialog")

        # Shut off VM
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # Open dialog
        b.click("#vm-subVmTest1-vcpus-count")

        b.wait_present(".modal-body")

        b.set_input_text("#machines-vcpu-count-field", "2")

        # Set new socket value
        b.set_val("#coresSelect", "2")
        b.wait_val("#socketsSelect", "2")
        b.wait_val("#threadsSelect", "1")

        # Save
        b.click("#machines-vcpu-modal-dialog-apply")
        b.wait_not_present("#machines-vcpu-modal-dialog")

        wait(lambda: m.execute(
            "virsh dumpxml subVmTest1 | tee /tmp/subVmTest1.xml | xmllint --xpath '/domain/cpu/topology[@sockets=\"2\"][@threads=\"1\"][@cores=\"2\"]' -"))

        # Run VM - this ensures that the internal state is updated before we move on.
        # We need this here because we can't wait for UI updates after we open the modal dialog.
        b.click("#vm-subVmTest1-run")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        # Wait for the VCPUs link to get new values before opening the dialog
        b.wait_visible("#vm-subVmTest1-vcpus-count")
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "2")

        # Open dialog
        b.click("#vm-subVmTest1-vcpus-count")

        b.wait_present(".modal-body")

        # Set new socket value
        b.wait_val("#coresSelect", "2")
        b.wait_val("#socketsSelect", "2")
        b.wait_val("#threadsSelect", "1")

        b.wait_in_text("#vm-subVmTest1-vcpus-count", "2")

        # Check value of sockets, threads and cores from VM dumpxml
        m.execute(
            "virsh dumpxml subVmTest1 | xmllint --xpath '/domain/cpu/topology[@sockets=\"2\"][@threads=\"1\"][@cores=\"2\"]' -")

    # HACK: broken with Chromium > 63, see https://github.com/cockpit-project/cockpit/pull/9229
    @unittest.skip("Broken with current chromium, see PR #9229")
    def testExternalConsole(self):
        b = self.browser

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running") # running or paused

        b.click("#vm-subVmTest1-consoles") # open the "Console" subtab

        # since VNC is not defined for this VM, the view for "Desktop Viewer" is rendered by default
        b.wait_in_text("#vm-subVmTest1-consoles-manual-address", "127.0.0.1")
        b.wait_in_text("#vm-subVmTest1-consoles-manual-port-spice", "5900")

        b.click("#vm-subVmTest1-consoles-launch") # "Launch Remote Viewer" button
        b.wait_present("#dynamically-generated-file") # is .vv file generated for download?
        self.assertEqual(b.attr("#dynamically-generated-file", "href"),
                         u"data:application/x-virt-viewer,%5Bvirt-viewer%5D%0Atype%3Dspice%0Ahost%3D127.0.0.1%0Aport%3D5900%0Adelete-this-file%3D1%0Afullscreen%3D0%0A")

    def testInlineConsole(self, urlroot=""):
        b = self.browser

        self.startVm("subVmTest1", graphics='vnc')

        if urlroot != "":
            self.machine.execute('mkdir -p /etc/cockpit/; echo "[WebService]\nUrlRoot=%s" > /etc/cockpit/cockpit.conf' % urlroot)

        self.login_and_go("/machines", urlroot=urlroot)
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running") # running or paused

        b.click("#vm-subVmTest1-consoles") # open the "Console" subtab

        # since VNC is defined for this VM, the view for "In-Browser Viewer" is rendered by default
        b.wait_present(".toolbar-pf-results canvas")

    def testInlineConsoleWithUrlRoot(self, urlroot=""):
        self.testInlineConsole(urlroot="/webcon")

    def testDelete(self):
        b = self.browser
        m = self.machine

        name = "subVmTest1"
        img2 = "/var/lib/libvirt/images/{0}-2.img".format(name)

        args = self.startVm(name, graphics='vnc')

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", name)

        m.execute("test -f {0}".format(img2))

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header

        def addDisk(volName, poolName):
            # Virsh does not offer some option to create disks of type volume
            # We have to do this from cockpit UI
            b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

            b.click("#vm-subVmTest1-disks-adddisk") # button
            b.wait_present("label:contains(Create New)") # radio button label in the modal dialog

            b.select_from_dropdown("#vm-subVmTest1-disks-adddisk-new-select-pool", poolName)
            b.set_input_text("#vm-subVmTest1-disks-adddisk-new-name", volName)
            b.set_input_text("#vm-subVmTest1-disks-adddisk-new-size", "10")
            b.select_from_dropdown("#vm-subVmTest1-disks-adddisk-new-unit", "MiB")
            b.click("#vm-subVmTest1-disks-adddisk-new-permanent")

            b.click("#vm-subVmTest1-disks-adddisk-dialog-add")
            b.wait_not_present("#vm-subVmTest1-test-disks-adddisk-dialog-modal-window")

            if self.provider == "libvirt-dbus":
                b.wait_present("#vm-subVmTest1-disks-vdc-source-volume")
                b.wait_present("#vm-subVmTest1-disks-vdc-source-pool")
            else:
                b.wait_present("#vm-subVmTest1-disks-vdc-source-file")

        secondDiskVolName = "mydisk"
        poolName = "images"
        secondDiskPoolPath = "/var/lib/libvirt/images/"
        addDisk(secondDiskVolName, poolName)

        b.click("#vm-{0}-delete".format(name))

        b.wait_present("#vm-{0}-delete-modal-dialog div:contains(The VM is running)".format(name))
        b.wait_present("#vm-{1}-delete-modal-dialog ul li:first-child #disk-source-file:contains({0})".format(img2, name))
        # virsh attach-disk does not create disks of type volume
        if self.provider == "libvirt-dbus":
            b.wait_present("#vm-{1}-delete-modal-dialog #disk-source-volume:contains({0})".format(secondDiskVolName, name))
            b.wait_present("#vm-{1}-delete-modal-dialog #disk-source-pool:contains({0})".format(poolName, name))
        else:
            b.wait_present("#vm-{1}-delete-modal-dialog ul li:nth-child(2) #disk-source-file:contains({0})".format(secondDiskPoolPath, name))
        b.click("#vm-{0}-delete-modal-dialog button:contains(Delete)".format(name))
        b.wait_not_present("#vm-{0}-delete-modal-dialog".format(name))

        b.wait_not_present("#vm-{0}-row".format(name))

        m.execute("while test -f {0}; do sleep 1; done".format(img2))
        m.execute("while test -f {0}; do sleep 1; done".format(secondDiskPoolPath + secondDiskVolName))

        self.assertNotIn(name, m.execute("virsh list --all"))

        # Try to delete a paused VM
        name = "paused-test-vm"
        args = self.startVm(name)

        b.click("tbody tr[data-row-id=vm-{0}] th".format(name)) # click on the row header

        # Make sure that the VM booted normally before attempting to suspend it
        if args["logfile"] is not None:
            wait(lambda: "Linux version" in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        self.machine.execute("virsh -c qemu:///system suspend {0}".format(name))
        b.wait_in_text("#vm-{0}-state".format(name), "paused")
        b.click("#vm-{0}-delete".format(name))
        self.browser.reload()
        b.wait_not_present("tbody tr[data-row-id=vm-{0}] th".format(name)) # click on the row header

    def testSerialConsole(self):
        b = self.browser
        name = "vmWithSerialConsole"

        self.startVm(name, graphics='vnc', ptyconsole=True)

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-{0}] th".format(name), name)

        b.click("tbody tr[data-row-id=vm-{0}] th".format(name)) # click on the row header
        b.wait_in_text("#vm-{0}-state".format(name), "running") # running or paused

        b.click("#vm-{0}-consoles".format(name)) # open the "Console" subtab

        b.set_val("#console-type-select", "serial-browser")
        b.wait_present("div.terminal canvas.xterm-text-layer") # if connected the xterm canvas is rendered

        b.click("#{0}-serialconsole-reconnect".format(name))
        b.wait_present("div.terminal canvas.xterm-text-layer")

        b.click("#{0}-serialconsole-disconnect".format(name))
        b.wait_not_present("div.terminal canvas.xterm-text-layer")
        b.wait_present("div.blank-slate-pf")
        b.wait_present("p.blank-slate-pf-info:contains(Disconnected from serial console. Click the Reconnect button.)")

        b.click("#{0}-serialconsole-reconnect".format(name))
        b.wait_present("div.terminal canvas.xterm-text-layer")

        # disconnecting the serial console closes the pty channel
        self.allow_journal_messages("connection unexpectedly closed by peer",
                                    ".*Connection reset by peer")
        self.allow_browser_errors("Disconnection timed out.")

    def testCreate(self):
        """
        this test will print many expected error messages
        """

        runner = TestMachines.CreateVmRunner(self)
        config = TestMachines.TestCreateConfig

        self.login_and_go("/machines")
        self.browser.wait_in_text("body", "Virtual Machines")

        def checkVendorsLoadedInUi(dialog):
            dialog.open()
            self.browser.wait_present("#vendor-select")
            self.browser.wait_present("#vendor-select option[value='%s']" % dialog.os_vendor)
            dialog.cancel()

        def cancelDialogTest(dialog):
            dialog.open() \
                .fill() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkFilteredOsTest(dialog):
            dialog.open() \
                .checkOsOrVendorFiltered() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkSourceNetworkAbsentTest(dialog):
            dialog.open() \
                .fill() \
                .checkSourceNetworkAbsent() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkDialogFormValidationTest(dialog, errors):
            dialog.open() \
                .fill() \
                .createAndExpectInlineValidationErrors(errors) \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkDialogErrorTest(dialog, errors):
            dialog.open() \
                .fill() \
                .createAndExpectError(errors) \
                .cancel(False)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def createTest(dialog):
            runner.tryCreate(dialog) \

            # We call virt-install always with --wait 0 which means we should
            # check for virt-install script to always finish and the domain to get
            # defined when creating new VMs.
            runner.assertScriptFinished() \
                  .assertDomainDefined(dialog.name, dialog.connection)

            if dialog.delete:
                runner.deleteVm(dialog) \
                      .checkEnvIsEmpty()

        def installWithErrorTest(dialog):
            runner.tryInstallWithError(dialog) \
                .assertScriptFinished() \
                .deleteVm(dialog) \
                .checkEnvIsEmpty()

        # wait for os and vendors to load.
        runner.assertOsInfoQueryFinished()
        rhDialog = TestMachines.VmDialog(self, "loadVendors", os_vendor=config.REDHAT_VENDOR)
        checkVendorsLoadedInUi(rhDialog)

        runner.checkEnvIsEmpty()

        # test just the DIALOG CREATION and cancel
        print("    *\n    * validation errors and ui info/warn messages expected:\n    * ")
        cancelDialogTest(TestMachines.VmDialog(self, sourceType='file',
                                               location=config.NOVELL_MOCKUP_ISO_PATH,
                                               memory_size=1, memory_size_unit='MiB',
                                               storage_size=12500, storage_size_unit='GiB',
                                               os_vendor=config.UNSPECIFIED_VENDOR,
                                               os_name=config.OTHER_OS,
                                               start_vm=True))

        cancelDialogTest(TestMachines.VmDialog(self, sourceType='url',
                                               location=config.VALID_URL,
                                               memory_size=256, memory_size_unit='MiB',
                                               storage_size=0, storage_size_unit='MiB',
                                               os_vendor=config.NOVELL_VENDOR,
                                               os_name=config.NOVELL_NETWARE_4,
                                               start_vm=False))

        # check if older os are filtered
        checkFilteredOsTest(TestMachines.VmDialog(self, os_vendor=config.REDHAT_VENDOR,
                                                  storage_size=1, os_name=config.REDHAT_RHEL_4_7_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, os_vendor=config.MANDRIVA_FILTERED_VENDOR,
                                                  storage_size=1, os_name=config.MANDRIVA_2011_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, os_vendor=config.MAGEIA_VENDOR,
                                                  storage_size=1, os_name=config.MAGEIA_3_FILTERED_OS))

        # try to CREATE WITH DIALOG ERROR

        # name
        checkDialogFormValidationTest(TestMachines.VmDialog(self, "", storage_size='1'), {"Name": "Name should not be empty"})

        # location
        checkDialogFormValidationTest(TestMachines.VmDialog(self, sourceType='url',
                                                            location="invalid/url", storage_size='1',
                                                            os_vendor=config.NOVELL_VENDOR,
                                                            os_name=config.NOVELL_NETWARE_4), {"Source": "Source should start with"})

        # disk
        checkDialogErrorTest(TestMachines.VmDialog(self, location=config.NOVELL_MOCKUP_ISO_PATH,
                                                   storage_size=10000, storage_size_unit='GiB',
                                                   os_vendor=config.NOVELL_VENDOR,
                                                   os_name=config.NOVELL_NETWARE_6,
                                                   start_vm=True), ["space"])

        # start vm
        checkDialogFormValidationTest(TestMachines.VmDialog(self, storage_size='1',
                                                            os_vendor=config.NOVELL_VENDOR,
                                                            os_name=config.NOVELL_NETWARE_6, start_vm=True),
                                      {"Source": "Installation Source should not be empty"})

        # disallow UNSPECIFIED_VENDOR in case of URL installation media and start_vm=False
        checkDialogFormValidationTest(TestMachines.VmDialog(self, sourceType='url', location=config.VALID_URL,
                                                            os_vendor=config.UNSPECIFIED_VENDOR,
                                                            storage_size=100, storage_size_unit='MiB',
                                                            os_name=config.OTHER_OS, start_vm=False),
                                      {"OS Vendor": "You need to select the most closely matching OS vendor and Operating System"})

        # try to CREATE few machines
        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         storage_size=1,
                                         os_vendor=config.MICROSOFT_VENDOR,
                                         os_name=config.MICROSOFT_VISTA))

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=100, storage_size_unit='MiB',
                                         os_vendor=config.MICROSOFT_VENDOR,
                                         os_name=config.MICROSOFT_XP_OS,
                                         start_vm=False))

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=100, storage_size_unit='MiB',
                                         os_vendor=config.APPLE_VENDOR,
                                         os_name=config.MACOS_X_TIGER,
                                         start_vm=False))

        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=0, storage_size_unit='MiB',
                                         os_vendor=config.APPLE_VENDOR,
                                         os_name=config.MACOS_X_TIGER,
                                         start_vm=False,
                                         connection='session'))

        # Try setting the memory to value bigger than it's available on the OS
        # The dialog should auto-adjust it to match the OS'es total memory
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=100000, memory_size_unit='MiB',
                                         storage_size=0, storage_size_unit='MiB',
                                         os_vendor=config.APPLE_VENDOR,
                                         os_name=config.MACOS_X_TIGER,
                                         start_vm=False))

        # Start of tests for import existing disk as installation option
        createTest(TestMachines.VmDialog(self, sourceType='disk_image',
                                         location=config.VALID_DISK_IMAGE_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         os_vendor=config.OPENBSD_VENDOR,
                                         os_name=config.OPENBSD_5_4,
                                         start_vm=False))

        # Recreate the image the previous test just deleted to reuse it
        self.machine.execute("qemu-img create {0} 500M".format(TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))

        # Unload KVM module, otherwise we get errors getting the nested VMs
        # to start properly.
        # This is applicable for all tests that we want to really successfully run a nested VM.
        # in order to allow the rest of the tests to run faster with QEMU KVM
        # Stop pmcd service if available which is invoking pmdakvm and is keeping KVM module used
        self.machine.execute("systemctl stop pmcd || true; modprobe -r kvm_intel kvm_amd kvm")

        createTest(TestMachines.VmDialog(self, sourceType='disk_image',
                                         location=config.VALID_DISK_IMAGE_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         os_vendor=config.OPENBSD_VENDOR,
                                         os_name=config.OPENBSD_5_4,
                                         start_vm=True))
        # End of tests for import existing disk as installation option

        cmds = [
            "mkdir /mnt/tmpPool; chmod a+rwx /mnt/tmpPool",
            "virsh pool-define-as tmpPool --type dir --target /mnt/tmpPool",
            "virsh pool-start tmpPool",
            "qemu-img create -f qcow2 /mnt/tmpPool/vmTmpDestination.qcow2 128M",
            "virsh pool-refresh tmpPool"
        ]
        self.machine.execute("; ".join(cmds))

        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        # Check choosing existing volume as destination storage
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=50, memory_size_unit='MiB',
                                         os_vendor=config.NOVELL_VENDOR,
                                         os_name=config.NOVELL_NETWARE_6,
                                         storage_pool="tmpPool",
                                         storage_volume="vmTmpDestination.qcow2",
                                         start_vm=True,))

        # Check "No Storage" option (only define VM)
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=50, memory_size_unit='MiB',
                                         os_vendor=config.NOVELL_VENDOR,
                                         os_name=config.NOVELL_NETWARE_6,
                                         storage_pool="No Storage",
                                         start_vm=True,))

        if self.provider == "libvirt-dbus":
            # test PXE Source
            self.machine.execute("virsh net-destroy default; virsh net-undefine default")

            # Disable selinux because it makes TFTP directory inaccesible and we don't want sophisticated configuration for tests
            self.machine.execute("if type selinuxenabled >/dev/null 2>&1 && selinuxenabled; then setenforce 0; fi")

            # Set up the PXE server configuration files
            cmds = [
                "mkdir -p /var/lib/libvirt/pxe-config",
                "echo \"{0}\" > /var/lib/libvirt/pxe-config/pxe.cfg".format(PXE_SERVER_CFG),
                "chmod 666 /var/lib/libvirt/pxe-config/pxe.cfg"
            ]
            self.machine.execute("; ".join(cmds))

            # Define and start a NAT network with tftp server configuration
            cmds = [
                "echo \"{0}\" > /tmp/pxe-nat.xml".format(NETWORK_XML_PXE),
                "virsh net-define /tmp/pxe-nat.xml",
                "virsh net-start pxe-nat"
            ]
            self.machine.execute("; ".join(cmds))

            # Add an extra network interface that should appear in the PXE source dropdown
            iface = self.add_iface(activate=False)

            # We don't handle events for networks yet, so reload the page to refresh the state
            self.browser.reload()
            self.browser.enter_page('/machines')
            self.browser.wait_in_text("body", "Virtual Machines")

            # check that the pxe-nat network is not available on session connection
            checkSourceNetworkAbsentTest(TestMachines.VmDialog(self, name='pxe-guest',
                                                               sourceType='pxe',
                                                               location="Virtual Network pxe-nat: NAT",
                                                               storage_size=0, storage_size_unit='MiB',
                                                               connection="session"))

            # First create the PXE VM but do not start it. We 'll need to tweak a bit the XML
            # to have serial console at bios and also redirect serial console to a file
            createTest(TestMachines.VmDialog(self, name='pxe-guest', sourceType='pxe',
                                             location="Virtual Network pxe-nat: NAT",
                                             memory_size=50, memory_size_unit='MiB',
                                             storage_size=0, storage_size_unit='MiB',
                                             os_vendor=config.NOVELL_VENDOR,
                                             os_name=config.NOVELL_NETWARE_6,
                                             start_vm=True, delete=False))

            # We don't want to use start_vm == False because if we get a seperate install phase
            # virt-install will overwrite our changes.
            self.machine.execute("virsh destroy pxe-guest")

            # Remove all serial ports and consoles first and tehn add a console of type file
            # virt-xml tool does not allow to remove both serial and console devices at once
            # https://bugzilla.redhat.com/show_bug.cgi?id=1685541
            # So use python xml parsing to change the domain XML.
            domainXML = self.machine.execute("virsh dumpxml pxe-guest")
            root = ET.fromstring(domainXML)

            # Find the parent element of each "console" element, using XPATH
            for p in root.findall('.//console/..'):
                # Find each console element
                for element in p.findall('console'):
                    # Remove the console element from its parent element
                    p.remove(element)

            # Find the parent element of each "serial" element, using XPATH
            for p in root.findall('.//serial/..'):
                # Find each serial element
                for element in p.findall('serial'):
                    # Remove the serial element from its parent element
                    p.remove(element)

            # Set useserial attribute for bios os element
            os = root.find('os')
            bios = ET.SubElement(os, 'bios')
            bios.set('useserial', 'yes')

            # Add a serial console of type file
            console = ET.fromstring(self.machine.execute("virt-xml --build --console file,path=/tmp/serial.txt,target_type=serial"))
            devices = root.find('devices')
            devices.append(console)

            # Redefine the domain with the new XML
            xmlstr = ET.tostring(root, encoding='unicode', method='xml')

            self.machine.execute("echo \'{0}\' > /tmp/domain.xml; virsh define --file /tmp/domain.xml".format(xmlstr))

            self.machine.execute("virsh start pxe-guest")

            # The file is full of ANSI control characters in between every letter, filter them out
            wait(lambda: self.machine.execute(r"sed 's,\x1B\[[0-9;]*[a-zA-Z],,g' /tmp/serial.txt | grep 'Rebooting in 60'"), delay=3)

            self.machine.execute("virsh destroy pxe-guest; virsh undefine pxe-guest")

            # Check that host network devices are appearing in the options for PXE boot sources
            createTest(TestMachines.VmDialog(self, sourceType='pxe',
                                             location="Host Device {0}: macvtap".format(iface),
                                             memory_size=50, memory_size_unit='MiB',
                                             storage_size=0, storage_size_unit='MiB',
                                             os_vendor=config.NOVELL_VENDOR,
                                             os_name=config.NOVELL_NETWARE_6,
                                             start_vm=False))

            # When switching from PXE mode to anything else make sure that the source input is empty
            checkDialogFormValidationTest(TestMachines.VmDialog(self, storage_size='1',
                                                                sourceType='pxe',
                                                                location="Host Device {0}: macvtap".format(iface),
                                                                sourceTypeSecondChoice='url',
                                                                os_vendor=config.NOVELL_VENDOR,
                                                                os_name=config.NOVELL_NETWARE_6, start_vm=False),
                                          {"Source": "Installation Source should not be empty"})

        # When switching between no pxe installation modes with the source already set
        # make sure that the source is intact
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         sourceTypeSecondChoice='disk_image',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         os_vendor=config.OPENBSD_VENDOR,
                                         os_name=config.OPENBSD_5_4,
                                         start_vm=False))

        # Test that removing virt-install executable will disable Create VM button
        self.machine.execute('rm $(which virt-install)')
        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_visible("#create-new-vm:disabled")

        # TODO: add use cases with start_vm=True and check that vm started
        # - for install when creating vm
        # - for create vm and then install
        # see https://github.com/cockpit-project/cockpit/issues/8385

        # console for try INSTALL
        self.allow_journal_messages('.*connection.*')
        self.allow_journal_messages('.*Connection.*')
        self.allow_journal_messages('.*session closed.*')

        # Deleting a running guest will disconnect the serial console
        self.allow_browser_errors("Disconnection timed out.")

        # See https://bugzilla.redhat.com/show_bug.cgi?id=1406979, this is a WONTFIX:
        # It suggests configure auditd to dontaudit these messages since selinux can't
        # offer whitelisting this directory for qemu process
        self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied .*for .* comm="qemu-.* dev="proc" .*')

        runner.destroy()

    class TestCreateConfig:
        VALID_URL = 'http://mirror.i3d.net/pub/centos/7/os/x86_64/'
        VALID_DISK_IMAGE_PATH = '/var/lib/libvirt/images/example.img'
        NOVELL_MOCKUP_ISO_PATH = '/var/lib/libvirt/novell.iso'  # libvirt in ubuntu-1604 does not accept /tmp
        NOT_EXISTENT_PATH = '/tmp/not-existent.iso'

        UNSPECIFIED_VENDOR = 'Unspecified'
        OTHER_OS = 'Other OS'

        NOVELL_VENDOR = 'Novell'
        NOVELL_NETWARE_4 = 'Novell Netware 4'
        NOVELL_NETWARE_5 = 'Novell Netware 5'
        NOVELL_NETWARE_6 = 'Novell Netware 6'

        OPENBSD_VENDOR = 'OpenBSD Project'
        OPENBSD_5_4 = 'OpenBSD 5.4'

        MICROSOFT_VENDOR = 'Microsoft Corporation'
        MICROSOFT_MILLENNIUM_OS = 'Microsoft Windows Millennium Edition'
        MICROSOFT_XP_OS = 'Microsoft Windows XP'
        MICROSOFT_VISTA = 'Microsoft Windows Vista'
        MICROSOFT_10_OS = 'Microsoft Windows 10'

        APPLE_VENDOR = 'Apple Inc.'
        MACOS_X_TIGER = 'MacOS X Tiger'
        MACOS_X_LEOPARD = 'MacOS X Leopard'

        # LINUX can be filtered if 3 years old
        REDHAT_VENDOR = 'Red Hat, Inc'
        REDHAT_RHEL_4_7_FILTERED_OS = 'Red Hat Enterprise Linux 4.9'

        MANDRIVA_FILTERED_VENDOR = 'Mandriva'
        MANDRIVA_2011_FILTERED_OS = 'Mandriva Linux 2011'

        MAGEIA_VENDOR = 'Mageia'
        MAGEIA_3_FILTERED_OS = 'Mageia 3'

        LIBVIRT_CONNECTION = {
            'session': 'QEMU/KVM User connection',
            'system': 'QEMU/KVM System connection'}

    class VmDialog:
        vmId = 0

        def __init__(self, test_obj, name=None,
                     sourceType='file', sourceTypeSecondChoice=None, location='',
                     memory_size=1, memory_size_unit='GiB',
                     storage_size=None, storage_size_unit='GiB',
                     os_vendor=None,
                     os_name=None,
                     storage_pool='Create New Volume', storage_volume='',
                     start_vm=False,
                     delete=True,
                     connection=None):

            TestMachines.VmDialog.vmId += 1 # This variable is static - don't use self here

            if name is None:
                self.name = 'subVmTestCreate' + str(TestMachines.VmDialog.vmId)
            else:
                self.name = name

            if sourceType == 'url' and start_vm:
                raise Exception("cannot start vm because url specified (no connection available in this test)")

            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue

            self.sourceType = sourceType
            self.sourceTypeSecondChoice = sourceTypeSecondChoice
            self.location = location
            self.memory_size = memory_size
            self.memory_size_unit = memory_size_unit
            self.storage_size = storage_size
            self.storage_size_unit = storage_size_unit
            self.os_vendor = os_vendor if os_vendor else TestMachines.TestCreateConfig.UNSPECIFIED_VENDOR
            self.os_name = os_name if os_name else TestMachines.TestCreateConfig.OTHER_OS
            self.start_vm = start_vm
            self.storage_pool = storage_pool
            self.storage_volume = storage_volume
            self.delete = delete
            self.connection = connection
            if self.connection:
                self.connectionText = TestMachines.TestCreateConfig.LIBVIRT_CONNECTION[connection]

        def open(self):
            b = self.browser

            b.wait_present("#create-new-vm:not([disabled])")
            b.click("#create-new-vm")
            b.wait_present("#create-vm-dialog")
            b.wait_in_text(".modal-dialog .modal-header .modal-title", "Create New Virtual Machine")

            if self.os_name != TestMachines.TestCreateConfig.OTHER_OS and self.os_vendor != TestMachines.TestCreateConfig.UNSPECIFIED_VENDOR:
                # check if there is os and vendor present in osinfo-query because it can be filtered out in the UI
                query_result = '{0}|{1}'.format(self.os_name, self.os_vendor)
                # throws exception if grep fails
                self.machine.execute(
                    "osinfo-query os --fields=name,vendor | tail -n +3 | sed -e 's/\s*|\s*/|/g; s/^\s*//g; s/\s*$//g' | grep '{0}'".format(
                        query_result))

            return self

        def checkOsOrVendorFiltered(self):
            b = self.browser

            vendor_selector = "#vendor-select"
            vendor_item_selector = "#vendor-select option[data-value*='{0}']".format(self.os_vendor)

            b.wait_visible(vendor_selector)
            if b.val(vendor_selector) != self.os_vendor:
                try:
                    with b.wait_timeout(1):
                        b.wait_present(vendor_item_selector)
                except Error:
                    # vendor not found which is ok
                    return self
                b.set_val(vendor_selector, self.os_vendor)
            b.wait_in_text(vendor_selector, self.os_vendor)
            # vendor successfully found

            system_selector = "#system-select"
            system_item_selector = "#system-select option[data-value*='{0}']".format(self.os_name)

            b.wait_visible(system_selector)
            try:
                with b.wait_timeout(1):
                    b.wait_visible(system_item_selector)
                # os found which is not ok
                raise AssertionError("{0} was not filtered".format(self.os_name))
            except AssertionError:
                raise
            except Error:
                # os not found which is ok
                return self

        def checkSourceNetworkAbsent(self):
            self.browser.wait_not_present("#network-select option[data-value*='{0}']".format(self.location))
            return self

        def fill(self):
            def getSourceTypeLabel(sourceType):
                if sourceType == 'file':
                    expected_source_type = 'Local Install Media'
                elif sourceType == 'disk_image':
                    expected_source_type = 'Existing Disk Image'
                elif sourceType == 'pxe':
                    expected_source_type = 'Network Boot (PXE)'
                else:
                    expected_source_type = 'URL'

                return expected_source_type

            b = self.browser
            b.set_input_text("#vm-name", self.name)

            b.select_from_dropdown("#source-type", getSourceTypeLabel(self.sourceType))
            if self.sourceType == 'file':
                b.set_file_autocomplete_val("#source-file", self.location)
            elif self.sourceType == 'disk_image':
                b.set_file_autocomplete_val("#source-disk", self.location)
            elif self.sourceType == 'pxe':
                b.select_from_dropdown("#network-select", self.location)
            else:
                b.set_input_text("#source-url", self.location)

            if self.sourceTypeSecondChoice:
                b.select_from_dropdown("#source-type", getSourceTypeLabel(self.sourceTypeSecondChoice))

            if not self.sourceType == 'disk_image' and not self.sourceTypeSecondChoice == 'disk_image':
                b.wait_visible("#storage-pool-select")
                b.select_from_dropdown("#storage-pool-select", self.storage_pool)

                if self.storage_pool == 'Create New Volume' or self.storage_pool == 'No Storage':
                    b.wait_not_present("#storage-volume-select")
                else:
                    b.wait_visible("#storage-volume-select")
                    b.select_from_dropdown("#storage-volume-select", self.storage_volume)

                if self.storage_size is None or self.storage_pool != 'Create New Volume':
                    b.wait_not_present("#storage-size")
                else:
                    b.select_from_dropdown("#storage-size-unit-select", self.storage_size_unit)
                    b.set_input_text("#storage-size", str(self.storage_size))

            b.select_from_dropdown("#vendor-select", self.os_vendor, substring=True)
            b.select_from_dropdown("#system-select", self.os_name, substring=True)

            # First select the unit so that UI will auto-adjust the memory input
            # value according to the available total memory on the host
            b.select_from_dropdown("#memory-size-unit-select", self.memory_size_unit)
            b.set_input_text("#memory-size", str(self.memory_size), value_check=False)
            help_block_line = b.text("label:contains(Memory) ~ .ct-validation-wrapper .help-block")
            host_total_memory = [int(s) for s in help_block_line.split() if s.isdigit()][0]
            # Write the final memory back to self so that other function can read it
            self.memory_size = min(self.memory_size, host_total_memory)
            b.wait_val("#memory-size", self.memory_size)

            b.wait_visible("#start-vm")
            if self.start_vm:
                b.click("#start-vm") # TODO: fix this, do not assume initial state of the checkbox
            # b.set_checked("#start-vm", self.start_vm)

            if (self.connection):
                b.select_from_dropdown("#connection", self.connectionText)

            return self

        def cancel(self, force=False):
            b = self.browser
            if b.is_present("#create-vm-dialog"):
                b.click(".modal-footer button:contains(Cancel)")
                b.wait_not_present("#create-vm-dialog")
            elif force:
                raise Exception("There is no dialog to cancel")
            return self

        def create(self):
            b = self.browser
            b.click(".modal-footer button:contains(Create)")
            init_state = "creating VM installation" if self.start_vm else "creating VM"
            second_state = "running" if self.start_vm else "shut off"

            TestMachines.CreateVmRunner.assertVmStates(self, self.name, init_state, second_state)
            b.wait_not_present("#create-vm-dialog")
            return self

        def createAndExpectInlineValidationErrors(self, errors):
            b = self.browser

            b.click(".modal-footer button:contains(Create)")

            for error, error_msg in errors.items():
                error_location = ".modal-body label:contains('{0}') + div.form-group.has-error span p".format(error)
                b.wait_visible(error_location)
                if (error_msg):
                    b.wait_in_text(error_location, error_msg)

            return self

        def createAndExpectError(self, errors):
            b = self.browser
            m = self.machine

            def waitForError(errors, error_location):
                for retry in range(0, 60):
                    error_message = b.text(error_location)
                    if any(error in error_message for error in errors):
                        break
                    time.sleep(5)
                else:
                    if m.image == "debian-stable" and "internal error: process exited while connecting to monitor" in error_message:
                        return unittest.skip("QEMU binary crashed in TCG code and error message from QEMU was not printed")
                    else:
                        raise Error("Retry limit exceeded: None of [%s] is part of the error message '%s'" % (
                            ', '.join(errors), b.text(error_location)))

            def allowBugErrors(location, original_exception):
                # CPU must be supported to detect errors
                # FIXME: "CPU is incompatible with host CPU" check should not be needed; happens only on fedora i386
                # see https://github.com/cockpit-project/cockpit/issues/8385
                error_message = b.text(location)

                if "CPU is incompatible with host CPU" not in error_message and \
                    "unsupported configuration: CPU mode" not in error_message and \
                        "CPU mode 'custom' for x86_64 kvm domain on x86_64 host is not supported by hypervisor" not in error_message:
                    raise original_exception

            b.click(".modal-footer button:contains(Create)")

            error_location = ".modal-footer div.alert"

            b.wait_present(".modal-footer .spinner")
            b.wait_not_present(".modal-footer .spinner")
            try:
                with b.wait_timeout(10):
                    b.wait_present(error_location)
                    b.wait_in_text("a.alert-link.more-button", "show more")
                    b.click("a.alert-link.more-button")
                    waitForError(errors, error_location)

                # dialog can complete if the error was not returned immediately
            except Error as x1:
                if b.is_present("#create-vm-dialog"):
                    # allow CPU errors in the dialog
                    allowBugErrors(error_location, x1)
                else:
                    # then error should be shown in the notification area
                    error_location = ".toast-notifications-list-pf div.alert"
                    try:
                        with b.wait_timeout(20):
                            b.wait_present(error_location)
                            b.wait_in_text("a.alert-link.more-button", "show more")
                            b.click("a.alert-link.more-button")
                            waitForError(errors, error_location)
                    except Error as x2:
                        # allow CPU errors in the notification area
                        allowBugErrors(error_location, x2)

            # Close the notificaton
            b.click(".toast-notifications-list-pf div.alert button.close")
            b.wait_not_present(".toast-notifications.list-pf div.alert")

            return self

    class CreateVmRunner:

        def __init__(self, test_obj):
            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue

            self.machine.execute("touch {0}".format(TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH))
            self.machine.execute("qemu-img create {0} 500M".format(TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))

        def destroy(self):
            self.machine.execute("rm -f {0}".format(TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH))
            self.machine.execute("rm -f {0}".format(TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))

        @staticmethod
        def assertVmStates(test_obj, name, before, after):
            b = test_obj.browser
            selector = "#vm-{0}-state".format(name)

            b.wait_in_text(selector, before)

            # Make sure that the initial state goes away and then try to check what the new state is
            # because we might end up checking the text for the new state the momment it dissapears
            def waitStateWentAway(selector, state):
                try:
                    b.wait_text_not(selector, state)
                    return True
                except Error:
                    return False

            wait(lambda: waitStateWentAway(selector, before), delay=3)
            b.wait_in_text(selector, after)

        def tryCreate(self, dialog):
            b = self.browser
            name = dialog.name

            dialog.open() \
                .fill() \
                .create()

            # successfully created
            b.wait_in_text("#vm-{0}-row".format(name), name)

            if dialog.start_vm:
                # wait for console tab to open
                b.wait_present("li.active #vm-{0}-consoles".format(name))
            else:
                # wait for Overview tab to open
                b.wait_present("#vm-{0}-memory".format(name))
                b.wait_present("#vm-{0}-vcpus".format(name))

            # check memory
            b.click("#vm-{0}-usage".format(name))
            # adjust to how cockpit_format_bytes() formats sizes > 1024 MiB -- this depends on how much RAM
            # the host has (less or more than 1 GiB), and thus needs to be dynamic
            if dialog.memory_size >= 1024 and dialog.memory_size_unit == "MiB":
                memory_text = "%.2f GiB" % (dialog.memory_size/1024)
            else:
                memory_text = "{0} {1}".format(dialog.memory_size, dialog.memory_size_unit)
            b.wait_in_text("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption", memory_text)

            # check disks
            b.click("#vm-{0}-disks".format(name)) # open the "Disks" subtab

            # Test disk got imported/created
            if dialog.sourceType == 'disk_image' or dialog.sourceTypeSecondChoice == 'disk_image':
                b.wait_present("#vm-{0}-disks-vda-device".format(name))
                b.wait_in_text("#vm-{0}-disks-vda-source-file".format(name), dialog.location)
            # New volume was created or existing volume was already chosen as destination
            elif (dialog.storage_size is not None and dialog.storage_size > 0) or dialog.storage_pool not in ["No Storage", "Create New Volume"]:
                if b.is_present("#vm-{0}-disks-vda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-vda-device".format(name), "disk")
                else:
                    b.wait_in_text("#vm-{0}-disks-hda-device".format(name), "disk")
            elif dialog.storage_pool == 'No Storage' and dialog.sourceType == 'file':
                b.wait_in_text("#vm-{0}-disks-hda-device".format(name), "cdrom")
            else:
                b.wait_in_text("tbody tr td div.listing-ct-body", "No disks defined")

            return self

        def tryInstallWithError(self, dialog):
            b = self.browser
            dialog.start_vm = False
            name = dialog.name

            dialog.open() \
                .fill() \
                .create()

            # should fail because of memory error
            b.click("#vm-{0}-install".format(name))
            b.wait_in_text("#vm-{0}-state".format(name), "shut off")
            b.wait_in_text("#app .listing-ct tbody:nth-of-type(1) th", name)
            b.wait_present("#app .listing-ct tbody:nth-of-type(1) tr td span span.pficon-warning-triangle-o")

            b.wait_present("#vm-{0}-install".format(name))
            # Overview should be opened
            b.click("#vm-{0}-overview".format(name)) # open the "overView" subtab

            b.wait_in_text("div.alert.alert-danger strong", "VM {0} failed to get installed".format(name))
            b.wait_in_text("a.alert-link.more-button", "show more")

            return self

        def deleteVm(self, dialog):
            b = self.browser
            vm_delete_button = "#vm-{0}-delete".format(dialog.name)

            b.click(vm_delete_button)
            b.wait_present("#vm-{0}-delete-modal-dialog".format(dialog.name))
            b.click("#vm-{0}-delete-modal-dialog button:contains(Delete)".format(dialog.name))
            b.wait_not_present("#vm-{0}-delete-modal-dialog".format(dialog.name))
            b.wait_not_present("vm-{0}-row".format(dialog.name))

            return self

        def _commandNotRunning(self, command):
            try:
                self.machine.execute("pgrep -c {0}".format(command))
                return False
            except subprocess.CalledProcessError as e:
                return hasattr(e, 'returncode') and e.returncode == 1

        def assertScriptFinished(self):
            with self.browser.wait_timeout(20):
                self.browser.wait(functools.partial(self._commandNotRunning, "virt-install"))

            return self

        def assertDomainDefined(self, name, connection):
            listCmd = ""
            if connection == "session":
                listCmd = "runuser -l admin -c 'virsh -c qemu:///session list --persistent --all'"
            else:
                # When creating VMs from the UI default connection is the system
                # In this case don't use runuser -l admin because we get errors 'authentication unavailable'
                listCmd = "virsh -c qemu:///system list --persistent --all"

            wait(lambda: name in self.machine.execute(listCmd))

            return self

        def assertOsInfoQueryFinished(self):
            with self.browser.wait_timeout(10):
                self.browser.wait(functools.partial(self._commandNotRunning, "osinfo-query"))
            return self

        def checkEnvIsEmpty(self):
            b = self.browser
            b.wait_in_text("#virtual-machines-listing thead tr td", "No VM is running")
            # wait for the vm and disks to be deleted
            b.wait(lambda: self.machine.execute("virsh list --all | wc -l") == '3\n')
            b.wait(lambda: self.machine.execute(
                "ls /home/admin/.local/share/libvirt/images/ 2>/dev/null | wc -l") == '0\n')

            if b.is_present(".toast-notifications.list-pf div.alert .close"):
                b.click(".toast-notifications.list-pf div.alert .close")

            b.wait_not_present(".toast-notifications.list-pf div.alert")

            return self


if __name__ == '__main__':
    test_main()
