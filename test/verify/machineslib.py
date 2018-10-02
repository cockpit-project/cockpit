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

import parent
from testlib import *
import subprocess
import unittest

import os
import functools
import time

def readFile(name):
    content = ''
    if os.path.exists(name):
        with open(name, 'r') as f:
            content = f.read().replace('\n', '')
    return content

SPICE_XML="""
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='spice' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
      <image compression='off'/>
    </graphics>
"""

VNC_XML="""
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='vnc' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
"""

CONSOLE_XML="""
    <console type='file'>
      <target type='serial' port='0'/>
      <source path='{log}'/>
    </console>
"""

PTYCONSOLE_XML="""
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

DOMAIN_XML="""
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
      <target dev='hda' bus='ide'/>
      <serial>ROOT</serial>
    </disk>
    <disk type='file' snapshot='external'>
      <driver name='qemu' type='qcow2'/>
      <source file='{image}'/>
      <target dev='hdb' bus='ide'/>
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

POOL_XML="""
<pool type='dir'>
  <name>images</name>
  <target>
    <path>{path}</path>
  </target>
</pool>
"""

VOLUME_XML="""
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

# If this test fails to run, the host machine needs:
# echo "options kvm-intel nested=1" > /etc/modprobe.d/kvm-intel.conf
# rmmod kvm-intel && modprobe kvm-intel || true

@skipImage("Atomic cannot run virtual machines", "fedora-atomic", "rhel-atomic", "continuous-atomic")
class TestMachines(MachineCase):
    created_pool = False
    provider = None

    def setUp(self):
        MachineCase.setUp(self)
        self.startLibvirt()

        # enforce use of cockpit-machines instead of cockpit-machines-ovirt
        m = self.machine
        m.execute("sed -i 's/\"priority\".*$/\"priority\": 100,/' {0}".format("/usr/share/cockpit/machines/manifest.json"))
        m.execute("[ ! -e {0} ] || sed -i 's/\"priority\".*$/\"priority\": 0,/' {0}".format("/usr/share/cockpit/ovirt/manifest.json"))

    def getLibvirtName(self):
        return "libvirt-bin.service" if self.machine.image == "ubuntu-1604" else "libvirtd.service"

    def startLibvirt(self):
        m = self.machine
        # Ensure everything has started correctly
        m.execute("systemctl start {0}".format(self.getLibvirtName()))
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
            m.execute("echo \"{0}\" > /tmp/xml && virsh pool-create /tmp/xml".format(xml))
            self.created_pool = True

        xml = VOLUME_XML.format(name=os.path.basename(img), image=img)
        m.execute("echo \"{0}\" > /tmp/xml && virsh vol-create images /tmp/xml".format(xml))

        xml = DOMAIN_XML.format(**args)
        m.execute("echo \"{0}\" > /tmp/xml && virsh define /tmp/xml && virsh start {1}".format(xml, name))

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
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
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
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running")
        b.wait_present("#vm-subVmTest1-vcpus")
        b.wait_in_text("#vm-subVmTest1-vcpus", "1")

        b.wait_in_text("#vm-subVmTest1-bootorder", "disk,network")
        emulated_machine = b.text("#vm-subVmTest1-emulatedmachine")
        self.assertTrue(len(emulated_machine) > 0) # emulated machine varies across test machines

        # switch to and check Usage
        b.wait_present("#vm-subVmTest1-usage")
        b.click("#vm-subVmTest1-usage")
        b.wait_present("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption")
        b.wait_in_text("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption", "256 MiB")
        b.wait_present("#chart-donut-0 .donut-title-big-pf")
        b.wait(lambda: float(b.text("#chart-donut-0 .donut-title-big-pf")) > 0.0)
        b.wait_present("tbody.open .listing-ct-body td:nth-child(2) .usage-donut-caption")
        b.wait_in_text("tbody.open .listing-ct-body td:nth-child(2) .usage-donut-caption", "1 vCPU")
        # CPU usage cannot be nonzero with blank image, so just ensure it's a percentage
        b.wait_present("#chart-donut-1 .donut-title-big-pf")
        self.assertLessEqual(float(b.text("#chart-donut-1 .donut-title-big-pf")), 100.0)

        # suspend/resume
        m.execute("virsh suspend subVmTest1")
        b.wait_in_text("#vm-subVmTest1-state", "paused")
        # resume sometimes fails with "unable to execute QEMU command 'cont': Resetting the Virtual Machine is required"
        m.execute('virsh resume subVmTest1 || { virsh destroy subVmTest1 && virsh start subVmTest1; }')
        b.wait_in_text("#vm-subVmTest1-state", "running")

        if args["logfile"] is not None:
            wait(lambda: "Linux version" in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Wait for the system to completely start
        if args["logfile"] is not None:
            wait(lambda: "login as 'cirros' user." in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Send Non-Maskable Interrupt (no change in VM state is expected)
        b.click("#vm-subVmTest1-off-caret")
        b.wait_visible("#vm-subVmTest1-sendNMI")
        b.click("#vm-subVmTest1-sendNMI")
        b.wait_not_visible("#vm-subVmTest1-sendNMI")

        if args["logfile"] is not None:
            b.wait(lambda: "NMI received" in self.machine.execute("cat {0}".format(args["logfile"])))

        # shut off
        b.click("#vm-subVmTest1-off-caret")
        b.wait_visible("#vm-subVmTest1-forceOff")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # continue shut off validation - usage should drop to zero
        b.wait_in_text("#chart-donut-0 .donut-title-big-pf", "0.00")
        b.wait_in_text("#chart-donut-1 .donut-title-big-pf", "0.0")

        # start another one, should appear automatically
        self.startVm("subVmTest2")
        b.wait_present("#app .listing-ct tbody:nth-of-type(2) th")
        b.wait_in_text("#app .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.click("#app .listing-ct tbody:nth-of-type(2) th") # click on the row header
        b.wait_present("#vm-subVmTest2-state")
        b.wait_in_text("#vm-subVmTest2-state", "running")
        b.wait_present("#vm-subVmTest2-vcpus")
        b.wait_in_text("#vm-subVmTest2-vcpus", "1")
        b.wait_in_text("#vm-subVmTest2-bootorder", "disk,network")

        # restart libvirtd
        m.execute("systemctl stop {0}".format(self.getLibvirtName()))
        b.wait_present("#slate-header")
        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        m.execute("systemctl start {0}".format(self.getLibvirtName()))
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_present("#app .listing-ct tbody:nth-of-type(1) th")
        b.wait_in_text("#app .listing-ct tbody:nth-of-type(1) th", "subVmTest1")
        b.wait_present("#app .listing-ct tbody:nth-of-type(2) th")
        b.wait_in_text("#app .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")
        b.wait_present("#vm-subVmTest2-state")
        b.wait_in_text("#vm-subVmTest2-state", "running")

        # stop second VM, event handling should still work
        b.wait_present("#app .listing-ct tbody:nth-of-type(2) th")
        b.wait_in_text("#app .listing-ct tbody:nth-of-type(2) th", "subVmTest2")
        b.click("#app .listing-ct tbody:nth-of-type(2) th") # click on the row header
        b.click("#vm-subVmTest2-off-caret")
        b.wait_visible("#vm-subVmTest2-forceOff")
        b.click("#vm-subVmTest2-forceOff")
        b.wait_in_text("#vm-subVmTest2-state", "shut off")

        # test VM error messages
        b.wait_visible("#vm-subVmTest2-run")
        b.click("#vm-subVmTest2-run")
        b.click("#vm-subVmTest2-run") # make use of slow processing - the button is still present; will cause error
        b.wait_present("tr.listing-ct-item.listing-ct-nonavigate span span.pficon-warning-triangle-o.machines-status-alert") # triangle by status
        b.wait_present("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning") # inline notification with error
        b.wait_in_text("#vm-subVmTest2-last-message", "VM START action failed")

        b.wait_present("a.alert-link.machines-more-button") # more/less button
        b.wait_in_text("a.alert-link.machines-more-button", "show more")
        b.click("a.alert-link.machines-more-button")
        b.wait_present("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning div > p")
        b.wait_in_text("a.alert-link.machines-more-button", "show less")

        # the message when trying to start active VM differs between virsh and libvirt-dbus provider
        if (self.provider == "libvirt-dbus"):
            b.wait_in_text("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning div > p", "domain is already running")
        else:
            b.wait_in_text("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning div > p", "Domain is already active")

        b.click("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning button") # close button
        b.wait_not_present("tr.listing-ct-panel div.listing-ct-body div.alert.alert-warning") # inline notification is gone
        b.wait_not_present("tr.listing-ct-item.listing-ct-nonavigate span span.pficon-warning-triangle-o.machines-status-alert") # triangle by status is gone

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

        libvirtServiceName = self.getLibvirtName()

        def checkLibvirtEnabled():
            try:
                m.execute("systemctl -q is-enabled {0}".format(libvirtServiceName))
                return True
            except subprocess.CalledProcessError:  # return code != 0
                return False

        self.startVm("subVmTest1")
        self.login_and_go("/machines")

        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        m.execute("systemctl disable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_present("#slate-header")
        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:not(:checked)")
        b.click("#enable-libvirt") # check it ; TODO: fix this, do not assume initial state of the checkbox
        b.click("#start-libvirt")

        b.wait_in_text("body", "Virtual Machines")
        b.wait(lambda: checkLibvirtEnabled())
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        m.execute("systemctl stop {0}".format(libvirtServiceName))
        b.wait_present("#slate-header")
        b.wait_in_text("#slate-header", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")
        b.click("#enable-libvirt") # uncheck it ; ; TODO: fix this, do not assume initial state of the checkbox
        b.click("#start-libvirt")
        b.wait_in_text("body", "Virtual Machines")
        b.wait(lambda: not checkLibvirtEnabled())
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        m.execute("systemctl enable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_present("#slate-header")
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
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.wait_present("#vm-subVmTest1-disks") # wait for the tab
        b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

        # Test basic disk properties
        b.wait_in_text("#vm-subVmTest1-disks-hda-target", "hda")
        b.wait_in_text("#vm-subVmTest1-disks-hdb-target", "hdb")

        b.wait_in_text("#vm-subVmTest1-disks-hda-bus", "ide")
        b.wait_in_text("#vm-subVmTest1-disks-hdb-bus", "ide")

        b.wait_in_text("#vm-subVmTest1-disks-hda-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-hdb-device", "disk")

        b.wait_in_text("#vm-subVmTest1-disks-hdb-source", "/var/lib/libvirt/images/subVmTest1-2.img")

        # Test domstats
        self.wait_for_disk_stats("subVmTest1", "hda")
        if b.is_present("#vm-subVmTest1-disks-hda-used"):
            b.wait_in_text("#vm-subVmTest1-disks-hda-used", "0.0")
            b.wait_present("#vm-subVmTest1-disks-hdb-used")
            b.wait_in_text("#vm-subVmTest1-disks-hdb-used", "0.0")

            b.wait_in_text("#vm-subVmTest1-disks-hdb-capacity", "1")

        # Test add disk by external action
        m.execute("qemu-img create -f raw /var/lib/libvirt/images/image3.img 128M")
        m.execute("virsh attach-disk subVmTest1 /var/lib/libvirt/images/image3.img vdc") # attach to the virtio bus instead of ide

        b.wait_in_text("#vm-subVmTest1-disks-hda-target", "hda")
        b.wait_in_text("#vm-subVmTest1-disks-hdb-target", "hdb")
        b.wait_present("#vm-subVmTest1-disks-hdb-used")
        b.wait_present("#vm-subVmTest1-disks-vdc-target")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-target", "vdc")

        b.wait_in_text("#vm-subVmTest1-disks-hda-bus", "ide")

        b.wait_in_text("#vm-subVmTest1-disks-vdc-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-source", "/var/lib/libvirt/images/image3.img")

        self.wait_for_disk_stats("subVmTest1", "vdc")
        if b.is_present("#vm-subVmTest1-disks-vdc-used"):
            b.wait_in_text("#vm-subVmTest1-disks-vdc-used", "0.00")
            b.wait_in_text("#vm-subVmTest1-disks-vdc-capacity", "0.13") # 128 MB

        # Test remove disk - by external action
        m.execute("virsh detach-disk subVmTest1 vdc")
        print("Restarting vm-subVmTest1, might take a while")
        b.click("#vm-subVmTest1-reboot-caret")
        b.wait_visible("#vm-subVmTest1-forceReboot")
        b.click("#vm-subVmTest1-forceReboot")

        b.wait_not_present("#vm-subVmTest1-disks-vdc-target")
        b.wait_in_text("#vm-subVmTest1-disks-hda-target", "hda")
        b.wait_in_text("#vm-subVmTest1-disks-hdb-target", "hdb")

     # Test Add Disk via dialog
    def testAddDisk(self):
        b = self.browser
        m = self.machine

        # prepare libvirt storage pools
        m.execute("mkdir /mnt/vm_one ; mkdir /mnt/vm_two ; mkdir /mnt/default_tmp ; chmod a+rwx /mnt/vm_one /mnt/vm_two /mnt/default_tmp")
        m.execute("virsh pool-create-as default_tmp --type dir --target /mnt/default_tmp")
        m.execute("virsh pool-create-as myPoolOne --type dir --target /mnt/vm_one")
        m.execute("virsh pool-create-as myPoolTwo --type dir --target /mnt/vm_two")

        m.execute("virsh vol-create-as default_tmp defaultVol --capacity 1G --format qcow2")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_temporary --capacity 1G --format qcow2")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_permanent --capacity 1G --format qcow2")
        wait(lambda: "mydiskofpooltwo_permanent" in m.execute("virsh vol-list myPoolTwo"))

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.wait_present("#vm-subVmTest1-disks") # wait for the tab
        b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

        b.wait_present("#vm-subVmTest1-disks-adddisk") # button
        b.click("#vm-subVmTest1-disks-adddisk")
        b.wait_present(".add-disk-dialog label:contains(Create New)") # radio button label in the modal dialog
        b.wait_present("#vm-subVmTest1-disks-adddisk-new-select-pool")

        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-select-pool", "myPoolOne")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-target", "vde")
        self._setVal("#vm-subVmTest1-disks-adddisk-new-name", "mydiskofpoolone_temporary")
        self._setVal("#vm-subVmTest1-disks-adddisk-new-size", 2048)
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-select-pool", "myPoolOne")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-unit", "MiB")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-diskfileformat", "raw") # verify content of the dropdown box
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-diskfileformat", "qcow2") # and switch it back
        # keep "Attach permanently" un-checked (by default)
        b.wait_in_text("#vm-subVmTest1-state", "running") # re-check
        b.click(".modal-footer button:contains(Add)")
        b.wait_not_present("#cockpit_modal_dialog")
        b.wait_present("#vm-subVmTest1-disks-vde-target") # verify after modal dialog close
        b.wait_in_text("#vm-subVmTest1-disks-vde-target", "vde")
        b.wait_in_text("#vm-subVmTest1-disks-vde-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vde-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vde-source", "/mnt/vm_one/mydiskofpoolone_temporary") # should be gone after shut down

        b.click("#vm-subVmTest1-disks-adddisk")
        b.wait_present("#vm-subVmTest1-disks-adddisk-new-permanent")
        b.wait_present("#vm-subVmTest1-disks-adddisk-new-name")
        b.click("#vm-subVmTest1-disks-adddisk-new-permanent")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-select-pool", "myPoolOne")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-new-target", "vda")
        self._setVal("#vm-subVmTest1-disks-adddisk-new-name", "mydiskofpoolone_permanent")
        self._setVal("#vm-subVmTest1-disks-adddisk-new-size", 2) # keep GiB and qcow2 format
        b.click(".modal-footer button:contains(Add)")
        b.wait_not_present("#cockpit_modal_dialog")
        b.wait_present("#vm-subVmTest1-disks-vda-target") # verify after modal dialog close
        b.wait_in_text("#vm-subVmTest1-disks-vda-target", "vda")
        b.wait_in_text("#vm-subVmTest1-disks-vda-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vda-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vda-source", "/mnt/vm_one/mydiskofpoolone_permanent") # should survive the shut down

        b.click("#vm-subVmTest1-disks-adddisk")
        b.wait_present(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        b.click(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        b.wait_present("#vm-subVmTest1-disks-adddisk-existing-select-pool")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-select-pool", "myPoolOne")
        b.wait_present("#vm-subVmTest1-disks-adddisk-existing-select-volume button.disabled span i:contains(The pool is empty)") # since both disks are already attached
        b.click(".modal-footer button:contains(Cancel)")
        b.wait_not_present("#cockpit_modal_dialog")

        b.click("#vm-subVmTest1-disks-adddisk")
        b.wait_present(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        b.click(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        b.wait_present("#vm-subVmTest1-disks-adddisk-existing-select-volume")
        b.wait_present("#vm-subVmTest1-disks-adddisk-existing-permanent")
        b.click("#vm-subVmTest1-disks-adddisk-existing-permanent")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-select-pool", "myPoolTwo")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-select-volume", "mydiskofpooltwo_permanent")
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-target", "vdd")
        b.click(".modal-footer button:contains(Add)")
        b.wait_not_present("#cockpit_modal_dialog")
        b.wait_present("#vm-subVmTest1-disks-vdd-target") # verify after modal dialog close
        b.wait_in_text("#vm-subVmTest1-disks-vdd-target", "vdd")
        b.wait_in_text("#vm-subVmTest1-disks-vdd-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vdd-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vdd-source", "/mnt/vm_two/mydiskofpooltwo_permanent")

        # FIXME: This causes either "unable to execute QEMU command 'device_add': Failed to get "write" lock"
        # or adding the _temporary volume results in showing that the _permanent one actually gets added
        # See https://github.com/cockpit-project/cockpit/issues/9945
        # b.click("#vm-subVmTest1-disks-adddisk")
        # b.wait_present(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        # b.click(".add-disk-dialog label:contains(Use Existing)") # radio button label in the modal dialog
        # self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-select-pool", "myPoolTwo")
        # self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-select-volume", "mydiskofpooltwo_temporary")
        # self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-target", "vdb")
        # b.click(".modal-footer button:contains(Add)")
        # b.wait_not_present("#cockpit_modal_dialog")
        # b.wait_present("#vm-subVmTest1-disks-vdb-target") # verify after modal dialog close
        # b.wait_in_text("#vm-subVmTest1-disks-vdb-target", "vdb")
        # b.wait_in_text("#vm-subVmTest1-disks-vdb-bus", "virtio")
        # b.wait_in_text("#vm-subVmTest1-disks-vdb-device", "disk")
        # b.wait_in_text("#vm-subVmTest1-disks-vdb-source", "/mnt/vm_two/mydiskofpooltwo_temporary")

        # check the autoselected options
        b.click("#vm-subVmTest1-disks-adddisk")
        b.wait_present(".add-disk-dialog label:contains(Use Existing)") # radio button label in modal dialog
        b.click(".add-disk-dialog label:contains(Use Existing)")
        # default_tmp pool should be autoselected since it's the first in alphabetical order
        # defaultVol volume should be autoselected since it's the only volume in default_tmp pool
        self._selectFromDropdown("#vm-subVmTest1-disks-adddisk-existing-target", "vdc")
        b.click(".modal-footer button:contains(Add)")
        b.wait_not_present("#cockpit_modal_dialog")
        b.wait_present("#vm-subVmTest1-disks-vdc-target") # verify after modal dialog close
        b.wait_in_text("#vm-subVmTest1-disks-vdc-target", "vdc")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-bus", "virtio")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-device", "disk")
        b.wait_in_text("#vm-subVmTest1-disks-vdc-source", "/mnt/default_tmp/defaultVol")

        # shut off
        b.click("#vm-subVmTest1-off-caret")
        b.wait_visible("#vm-subVmTest1-forceOff")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # check if the just added non-permanent disks are gone
        b.wait_not_present("#vm-subVmTest1-disks-vdb-target")
        b.wait_not_present("#vm-subVmTest1-disks-vde-target")
        b.wait_present("#vm-subVmTest1-disks-vda-target")
        b.wait_present("#vm-subVmTest1-disks-vdd-target")

    def _selectFromDropdown(self, selector, value):
        selectFromDropdown(self.browser, selector, value)

    def _setVal(self, selector, value):
        setValToElement(self.browser, selector, value)

    def testNetworks(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.wait_present("#vm-subVmTest1-networks") # wait for the tab
        b.click("#vm-subVmTest1-networks") # open the "Networks" subtab

        b.wait_present("#vm-subVmTest1-network-1-type")
        b.wait_in_text("#vm-subVmTest1-network-1-type", "network")
        b.wait_in_text("#vm-subVmTest1-network-1-source", "default")
        b.wait_in_text("#vm-subVmTest1-network-1-target", "vnet0")

        b.wait_in_text("#vm-subVmTest1-network-1-state span", "up")

        # Test add network
        m.execute("virsh attach-interface --domain subVmTest1 --type network --source default --model virtio --mac 52:54:00:4b:73:5f --config --live")

        b.wait_present("#vm-subVmTest1-network-2-type")
        b.wait_in_text("#vm-subVmTest1-network-2-type", "network")
        b.wait_in_text("#vm-subVmTest1-network-2-source", "default")
        b.wait_in_text("#vm-subVmTest1-network-2-target", "vnet1")
        b.wait_in_text("#vm-subVmTest1-network-2-model", "virtio")
        b.wait_in_text("#vm-subVmTest1-network-2-mac", "52:54:00:4b:73:5f")

        b.wait_in_text("#vm-subVmTest1-network-2-state span", "up")

    def testVCPU(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")
        b.click("tbody tr th") # click on the row header

        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        b.wait_present("#vm-subVmTest1-vcpus-count") # wait for the tab
        b.click("#vm-subVmTest1-vcpus-count") # open VCPU modal detail window

        b.wait_present(".vcpu-detail-modal-table")
        b.is_present(".machines-vcpu-caution")

        # Test basic vCPU properties
        b.wait_val("#machines-vcpu-count-field", "1")
        b.wait_val("#machines-vcpu-max-field", "1")

        # Set new values
        b.set_input_text("#machines-vcpu-max-field", "4")
        b.set_input_text("#machines-vcpu-count-field", "3")

        # Set new socket value
        b.wait_present("#socketsSelect li[data-value=2] a")
        b.click("#socketsSelect button");
        b.click("#socketsSelect li[data-value=2] a")
        b.wait_in_text("#socketsSelect button", "2")
        b.wait_in_text("#coresSelect button", "1")
        b.wait_in_text("#threadsSelect button", "2")

        # Save
        b.click(".apply")
        b.wait_not_present("#cockpit_modal_dialog")

        # Shut off VM for applying changes after save
        b.click("#vm-subVmTest1-off-caret")
        b.wait_visible("#vm-subVmTest1-forceOff")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # Check changes
        b.wait_visible("#vm-subVmTest1-vcpus-count")
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "3")

        # Check after boot
        # Run VM
        b.click("#vm-subVmTest1-run")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        # Check VCPU count
        b.wait_visible("#vm-subVmTest1-vcpus-count")
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "3")

        # Open dialog window
        b.click("#vm-subVmTest1-vcpus-count")
        b.wait_present(".vcpu-detail-modal-table")

        # Check basic values
        b.wait_val("#machines-vcpu-count-field", "3")
        b.wait_val("#machines-vcpu-max-field", "4")

        # Check sockets, cores and threads
        b.wait_in_text("#socketsSelect button", "2")
        b.wait_in_text("#coresSelect button", "1")
        b.wait_in_text("#threadsSelect button", "2")

        b.click(".cancel")
        b.wait_not_present("#cockpit_modal_dialog")

        # Shut off VM
        b.click("#vm-subVmTest1-off-caret")
        b.wait_visible("#vm-subVmTest1-forceOff")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # Open dialog
        b.wait_present("#vm-subVmTest1-vcpus-count")
        b.click("#vm-subVmTest1-vcpus-count")

        b.wait_present(".vcpu-detail-modal-table")
        b.wait_not_present(".machines-vcpu-caution")

        b.set_input_text("#machines-vcpu-count-field", "2")

        # Set new socket value
        b.wait_present("#coresSelect li[data-value=2] a")
        b.click("#coresSelect button");
        b.click("#coresSelect li[data-value=2] a")
        b.wait_in_text("#coresSelect button", "2")
        b.wait_in_text("#socketsSelect button", "2")
        b.wait_in_text("#threadsSelect button", "1")

        # Save
        b.click(".apply")
        b.wait_not_present("#cockpit_modal_dialog")

        wait(lambda: m.execute("virsh dumpxml subVmTest1 | tee /tmp/subVmTest1.xml | xmllint --xpath '/domain/cpu/topology[@sockets=\"2\"][@threads=\"1\"][@cores=\"2\"]' -"))

        # Run VM - this ensures that the internal state is updated before we move on.
        # We need this here because we can't wait for UI updates after we open the modal dialog.
        b.click("#vm-subVmTest1-run")
        b.wait_in_text("#vm-subVmTest1-state", "running")

        # Open dialog
        b.wait_present("#vm-subVmTest1-vcpus-count")
        b.click("#vm-subVmTest1-vcpus-count")

        b.wait_present(".vcpu-detail-modal-table")

        # Set new socket value
        b.wait_in_text("#coresSelect button", "2")
        b.wait_in_text("#socketsSelect button", "2")
        b.wait_in_text("#threadsSelect button", "1")

        b.wait_in_text("#vm-subVmTest1-vcpus-count", "2")

        # Check value of sockets, threads and cores from VM dumpxml
        m.execute("virsh dumpxml subVmTest1 | xmllint --xpath '/domain/cpu/topology[@sockets=\"2\"][@threads=\"1\"][@cores=\"2\"]' -")

    # HACK: broken with Chromium > 63, see https://github.com/cockpit-project/cockpit/pull/9229
    @unittest.skip("Broken with current chromium, see PR #9229")
    def testExternalConsole(self):
        b = self.browser

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running") # running or paused

        b.wait_present("#vm-subVmTest1-consoles") # wait for the tab
        b.click("#vm-subVmTest1-consoles") # open the "Console" subtab

        # since VNC is not defined for this VM, the view for "Desktop Viewer" is rendered by default
        b.wait_present("#vm-subVmTest1-consoles-manual-address") # wait for the tab
        b.wait_in_text("#vm-subVmTest1-consoles-manual-address", "127.0.0.1")
        b.wait_in_text("#vm-subVmTest1-consoles-manual-port-spice", "5900")

        b.wait_present("#vm-subVmTest1-consoles-launch") # "Launch Remote Viewer" button
        b.click("#vm-subVmTest1-consoles-launch")
        b.wait_present("#dynamically-generated-file") # is .vv file generated for download?
        self.assertEqual(b.attr("#dynamically-generated-file", "href"), u"data:application/x-virt-viewer,%5Bvirt-viewer%5D%0Atype%3Dspice%0Ahost%3D127.0.0.1%0Aport%3D5900%0Adelete-this-file%3D1%0Afullscreen%3D0%0A")

    def testInlineConsole(self):
        b = self.browser

        self.startVm("subVmTest1", graphics='vnc')

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", "subVmTest1")

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-subVmTest1-state")
        b.wait_in_text("#vm-subVmTest1-state", "running") # running or paused

        b.wait_present("#vm-subVmTest1-consoles") # wait for the tab
        b.click("#vm-subVmTest1-consoles") # open the "Console" subtab

        # since VNC is defined for this VM, the view for "In-Browser Viewer" is rendered by default
        b.wait_present(".toolbar-pf-results canvas")

    def testDelete(self):
        b = self.browser
        m = self.machine

        name = "subVmTest1"
        img2 = "/var/lib/libvirt/images/{0}-2.img".format(name)

        self.startVm(name, graphics='vnc')

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", name)

        m.execute("test -f {0}".format(img2))

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-{0}-delete".format(name))
        b.click("#vm-{0}-delete".format(name))

        b.wait_present("#cockpit_modal_dialog")
        b.wait_present("#cockpit_modal_dialog div:contains(The VM is running)")
        b.wait_present("#cockpit_modal_dialog tr:contains({0})".format(img2))
        b.click("#cockpit_modal_dialog button:contains(Delete)")
        b.wait_not_present("#cockpit_modal_dialog")

        b.wait_not_present("#vm-{0}-row".format(name))

        m.execute("while test -f {0}; do sleep 1; done".format(img2))

        self.assertNotIn(name, m.execute("virsh list --all"))

    def testSerialConsole(self):
        b = self.browser
        name = "vmWithSerialConsole"

        self.startVm(name, graphics='vnc', ptyconsole=True)

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_present("tbody tr th")
        b.wait_in_text("tbody tr th", name)

        b.click("tbody tr th") # click on the row header
        b.wait_present("#vm-{0}-state".format(name))
        b.wait_in_text("#vm-{0}-state".format(name), "running") # running or paused

        b.wait_present("#vm-{0}-consoles".format(name)) # wait for the tab
        b.click("#vm-{0}-consoles".format(name)) # open the "Console" subtab

        b.wait_present("#console-type-select > button > span.caret") # switch from noVnc to Serial Console
        b.click("#console-type-select > button > span.caret")
        b.wait_present("#console-type-select li > a:contains(Serial Console)")
        b.click("#console-type-select li > a:contains(Serial Console)")

        b.wait_present("div.terminal canvas.xterm-text-layer") # if connected the xterm canvas is rendered

        b.wait_present("#{0}-serialconsole-reconnect".format(name))
        b.click("#{0}-serialconsole-reconnect".format(name))
        b.wait_present("div.terminal canvas.xterm-text-layer")

        b.wait_present("#{0}-serialconsole-disconnect".format(name))
        b.click("#{0}-serialconsole-disconnect".format(name))
        b.wait_not_present("div.terminal canvas.xterm-text-layer")
        b.wait_present("div.blank-slate-pf")
        b.wait_present("p.blank-slate-pf-info:contains(Disconnected from serial console. Click the Reconnect button.)")

        b.click("#{0}-serialconsole-reconnect".format(name))
        b.wait_present("div.terminal canvas.xterm-text-layer")

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
            has_vendor = dialog.hasVendor()
            dialog.cancel()
            return has_vendor

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

        def checkDialogErrorTest(dialog, errors, ui_validation=True):
            dialog.open() \
                .fill() \
                .createAndExpectError(errors, ui_validation) \
                .cancel(ui_validation)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def createTest(dialog):
            runner.tryCreate(dialog) \
                .assertScriptFinished() \
                .deleteVm(dialog) \
                .checkEnvIsEmpty()

        def installWithErrorTest(dialog):
            runner.tryInstallWithError(dialog) \
                .assertScriptFinished() \
                .deleteVm(dialog) \
                .checkEnvIsEmpty()

        # wait for os and vendors to load.
        runner.assertOsInfoQueryFinished()
        rhDialog = TestMachines.VmDialog(self, "loadVendors", os_vendor=config.REDHAT_VENDOR)
        with self.browser.wait_timeout(10):
            self.browser.wait(functools.partial(checkVendorsLoadedInUi, rhDialog))

        runner.checkEnvIsEmpty()

        # test just the DIALOG CREATION and cancel
        print("    *\n    * validation errors and ui info/warn messages expected:\n    * ")
        cancelDialogTest(TestMachines.VmDialog(self, "subVmTestCreate1", is_filesystem_location=True,
                                               location=config.NOVELL_MOCKUP_ISO_PATH,
                                               memory_size=1, memory_size_unit='MiB',
                                               storage_size=12500, storage_size_unit='GiB',
                                               os_vendor=config.UNSPECIFIED_VENDOR,
                                               os_name=config.OTHER_OS,
                                               start_vm=True))
        cancelDialogTest(TestMachines.VmDialog(self, "subVmTestCreate2", is_filesystem_location=False,
                                               location=config.VALID_URL,
                                               memory_size=12654, memory_size_unit='GiB',
                                               storage_size=0, storage_size_unit='MiB',
                                               os_vendor=config.NOVELL_VENDOR,
                                               os_name=config.NOVELL_NETWARE_4,
                                               start_vm=False))

        # check if older os are filtered
        checkFilteredOsTest(TestMachines.VmDialog(self, "subVmTestCreate3", os_vendor=config.REDHAT_VENDOR,
                                                  os_name=config.REDHAT_RHEL_4_7_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, "subVmTestCreate4", os_vendor=config.MANDRIVA_FILTERED_VENDOR,
                                                  os_name=config.MANDRIVA_2011_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, "subVmTestCreate5", os_vendor=config.MAGEIA_VENDOR,
                                                  os_name=config.MAGEIA_3_FILTERED_OS))

        # try to CREATE WITH DIALOG ERROR

        # name
        checkDialogErrorTest(TestMachines.VmDialog(self, ""), ["Name"])

        # location
        checkDialogErrorTest(TestMachines.VmDialog(self, "subVmTestCreate7", is_filesystem_location=False,
                                                   location="invalid/url",
                                                   os_vendor=config.NOVELL_VENDOR,
                                                   os_name=config.NOVELL_NETWARE_4), ["Source"])

        # memory
        checkDialogErrorTest(TestMachines.VmDialog(self, "subVmTestCreate8", location=config.NOVELL_MOCKUP_ISO_PATH,
                                                   memory_size=100, memory_size_unit='GiB',
                                                   storage_size=100, storage_size_unit='MiB',
                                                   os_vendor=config.NOVELL_VENDOR,
                                                   os_name=config.NOVELL_NETWARE_6,
                                                   start_vm=True), ["memory", "RAM", "buffer"], ui_validation=False)

        # disk
        checkDialogErrorTest(TestMachines.VmDialog(self, "subVmTestCreate9", location=config.NOVELL_MOCKUP_ISO_PATH,
                                                   storage_size=10000, storage_size_unit='GiB',
                                                   os_vendor=config.NOVELL_VENDOR,
                                                   os_name=config.NOVELL_NETWARE_6,
                                                   start_vm=True), ["space"], ui_validation=False)

        # start vm
        checkDialogErrorTest(TestMachines.VmDialog(self, "subVmTestCreate10",
                                                   os_vendor=config.NOVELL_VENDOR,
                                                   os_name=config.NOVELL_NETWARE_6, start_vm=True),
                             ["Installation Source should not be empty"], ui_validation=True)

        # try to CREATE few machines
        createTest(TestMachines.VmDialog(self, "subVmTestCreate11", is_filesystem_location=False,
                                         location=config.VALID_URL,
                                         storage_size=1,
                                         os_vendor=config.MICROSOFT_VENDOR,
                                         os_name=config.MICROSOFT_VISTA))

        createTest(TestMachines.VmDialog(self, "subVmTestCreate12", is_filesystem_location=False,
                                         location=config.VALID_URL,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=100, storage_size_unit='MiB',
                                         os_vendor=config.MICROSOFT_VENDOR,
                                         os_name=config.MICROSOFT_XP_OS,
                                         start_vm=False))

        createTest(TestMachines.VmDialog(self, "subVmTestCreate13", is_filesystem_location=False,
                                         location=config.VALID_URL,
                                         memory_size=900, memory_size_unit='GiB',
                                         storage_size=100, storage_size_unit='MiB',
                                         os_vendor=config.APPLE_VENDOR,
                                         os_name=config.MACOS_X_TIGER,
                                         start_vm=False))

        createTest(TestMachines.VmDialog(self, "subVmTestCreate14", is_filesystem_location=True,
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=0, storage_size_unit='MiB',
                                         os_vendor=config.APPLE_VENDOR,
                                         os_name=config.MACOS_X_TIGER,
                                         start_vm=False))
        # try to INSTALL WITH ERROR
        installWithErrorTest(TestMachines.VmDialog(self, "subVmTestCreate15", is_filesystem_location=True,
                                                   location=config.NOVELL_MOCKUP_ISO_PATH,
                                                   memory_size=900, memory_size_unit='GiB',
                                                   storage_size=10, storage_size_unit='MiB',
                                                   os_vendor=config.APPLE_VENDOR,
                                                   os_name=config.MACOS_X_LEOPARD))

        # TODO: add use cases with start_vm=True and check that vm started
        # - for install when creating vm
        # - for create vm and then install
        # see https://github.com/cockpit-project/cockpit/issues/8385

        # console for try INSTALL
        self.allow_journal_messages('.*connection.*')
        self.allow_journal_messages('.*Connection.*')
        self.allow_journal_messages('.*session closed.*')

        runner.destroy()

    class TestCreateConfig:
        VALID_URL = 'http://mirror.i3d.net/pub/centos/7/os/x86_64/'
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

    class VmDialog:
        def __init__(self, test_obj, name, is_filesystem_location=True, location='',
                     memory_size=1, memory_size_unit='GiB',
                     storage_size=1, storage_size_unit='GiB',
                     os_vendor=None,
                     os_name=None,
                     start_vm=False):

            if not is_filesystem_location and start_vm:
                raise Exception("cannot start vm because url specified (no connection available in this test)")

            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue

            self.name = name
            self.is_filesystem_location = is_filesystem_location
            self.location = location
            self.memory_size = memory_size
            self.memory_size_unit = memory_size_unit
            self.storage_size = storage_size
            self.storage_size_unit = storage_size_unit
            self.os_vendor = os_vendor if os_vendor else TestMachines.TestCreateConfig.UNSPECIFIED_VENDOR
            self.os_name = os_name if os_name else TestMachines.TestCreateConfig.OTHER_OS
            self.start_vm = start_vm

        def getMemoryText(self):
            return "{0} {1}".format(self.memory_size, self.memory_size_unit)

        def open(self):
            b = self.browser

            b.wait_present("#create-new-vm")
            b.click("#create-new-vm")
            b.wait_present("#cockpit_modal_dialog")
            b.wait_in_text(".modal-dialog .modal-header .modal-title", "Create New Virtual Machine")

            if self.os_name != TestMachines.TestCreateConfig.OTHER_OS and self.os_vendor != TestMachines.TestCreateConfig.UNSPECIFIED_VENDOR:
                # check if there is os and vendor present in osinfo-query because it can be filtered out in the UI
                query_result = '{0}|{1}'.format(self.os_name, self.os_vendor)
                # throws exception if grep fails
                self.machine.execute(
                    "osinfo-query os --fields=name,vendor | tail -n +3 | sed -e 's/\s*|\s*/|/g; s/^\s*//g; s/\s*$//g' | grep '{0}'".format(
                        query_result))

            return self

        def hasVendor(self):
            b = self.browser

            vendor_selector = "#vendor-select button span:nth-of-type(1)"
            vendor_item_selector = "#vendor-select ul li[data-value*='{0}'] a".format(self.os_vendor)

            b.wait_visible(vendor_selector)
            b.click(vendor_selector)

            has_vendor = True
            try:
                with b.wait_timeout(1):
                    b.wait_present(vendor_item_selector)
            except Exception:
                has_vendor = False

            b.click(vendor_selector)  # close
            return has_vendor

        def checkOsOrVendorFiltered(self):
            b = self.browser

            vendor_selector = "#vendor-select button span:nth-of-type(1)"
            vendor_item_selector = "#vendor-select ul li[data-value*='{0}'] a".format(self.os_vendor)

            b.wait_visible(vendor_selector)
            if not b.text(vendor_selector) == self.os_vendor:
                b.click(vendor_selector)
                try:
                    with b.wait_timeout(1):
                        b.wait_present(vendor_item_selector)
                        b.wait_visible(vendor_item_selector)
                        b.click(vendor_item_selector)
                except Exception:
                    # vendor not found which is ok
                    b.click(vendor_selector)  # close
                    return self
            b.wait_in_text(vendor_selector, self.os_vendor)
            # vendor successfully found

            system_selector = "#system-select button span:nth-of-type(1)"
            system_item_selector = "#system-select ul li[data-value*='{0}'] a".format(self.os_name)

            b.wait_visible(system_selector)
            b.click(system_selector)
            try:
                with b.wait_timeout(1):
                    b.wait_present(system_item_selector)
                    b.wait_visible(system_item_selector)
                # os found which is not ok
                raise AssertionError("{0} was not filtered".format(self.os_name))
            except AssertionError as e:
                raise
            except Exception:
                # os not found which is ok
                b.click(system_selector)  # close
                return self

        def fill(self):
            b = self.browser
            self._setVal("#vm-name", self.name)

            expected_source_type = 'Filesystem' if self.is_filesystem_location else 'URL'
            self._selectFromDropdown("#source-type", expected_source_type)
            if self.is_filesystem_location:
                self._setFileAutocompleteVal("#source-file", self.location)
            else:
                self._setVal("#source-url", self.location)

            self._selectFromDropdown("#vendor-select", self.os_vendor)
            self._selectFromDropdown("#system-select", self.os_name)

            self._setVal("#memory-size", self.memory_size)
            self._selectFromDropdown("#memory-size-unit-select", self.memory_size_unit)

            self._setVal("#storage-size", self.storage_size)
            self._selectFromDropdown("#storage-size-unit-select", self.storage_size_unit)

            b.wait_visible("#start-vm")
            if self.start_vm:
                b.click("#start-vm") # TODO: fix this, do not assume initial state of the checkbox
            # b.set_checked("#start-vm", self.start_vm)

            return self

        def cancel(self, force=False):
            b = self.browser
            if b.is_present("#cockpit_modal_dialog"):
                b.click(".modal-footer button:contains(Cancel)")
                b.wait_not_present("#cockpit_modal_dialog")
            elif force:
                raise Exception("There is no dialog to cancel")
            return self

        def create(self):
            b = self.browser
            b.click(".modal-footer button:contains(Create)")
            init_state = "creating VM installation" if self.start_vm else "creating VM"
            second_state = "running" if self.start_vm else "shut off"

            TestMachines.CreateVmRunner.assertVmStates(self, self.name, None, init_state, second_state)
            b.wait_not_present("#cockpit_modal_dialog")
            return self

        def createAndExpectError(self, errors, ui_validation):
            b = self.browser

            def waitForError(errors, error_location):
                for retry in range(0, 60):
                    error_message = b.text(error_location)
                    if any(error in error_message for error in errors):
                        break
                    time.sleep(5)
                else:
                    raise Error("Retry limit exceeded: None of [%s] is part of the error message '%s'" % (', '.join(errors), b.text(error_location)))

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

            if ui_validation:
                b.wait_present(error_location)
                waitForError(errors, error_location)
            else:
                b.wait_present(".modal-footer .spinner")
                b.wait_not_present(".modal-footer .spinner")
                try:
                    with b.wait_timeout(10):
                        b.wait_present(error_location)
                        waitForError(errors, error_location)

                    # dialog can complete if the error was not returned immediately
                except Exception as x1:
                    if b.is_present("#cockpit_modal_dialog"):
                        # allow CPU errors in the dialog
                        allowBugErrors(error_location, x1)
                    else:
                        # then error should be shown in the notification area
                        error_location = "#notification-area-notification-1 div.notification-message"
                        try:
                            with b.wait_timeout(20):
                                b.wait_present(error_location)
                                waitForError(errors, error_location)
                        except Exception as x2:
                            # allow CPU errors in the notification area
                            allowBugErrors(error_location, x2)

            return self

        def _selectFromDropdown(self, selector, value):
            selectFromDropdown(self.browser, selector, value)

        def _setFileAutocompleteVal(self, selector, location):
            b = self.browser
            caret_selector = "{0} span.caret".format(selector)
            spinner_selector = "{0} .spinner".format(selector)
            file_item_selector_template = "{0} ul li a:contains({1})"

            b.wait_present(selector)
            b.wait_visible(selector)

            for path_part in location.split('/')[1:]:
                b.wait_not_present(spinner_selector)
                file_item_selector = file_item_selector_template.format(selector, path_part)
                if not b.is_present(file_item_selector) or not b.is_visible(file_item_selector):
                    b.click(caret_selector)
                b.wait_visible(file_item_selector)
                b.click(file_item_selector)

            b.wait_not_present(spinner_selector)
            b.wait_val(selector + " input", location)

        def _setVal(self, selector, value):
            setValToElement(self.browser, selector, value)

    class CreateVmRunner:
        def __init__(self, test_obj):
            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue

            self.machine.execute("touch {0}".format(TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH))

        def destroy(self):
            self.machine.execute("rm -f {0}".format(TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH))

        @staticmethod
        def assertVmStates(test_obj, name, before, wanted, after):
            b = test_obj.browser
            selector = "#vm-{0}-state".format(name)

            def waitForWanted(accepted, wanted):
                b.wait_present(selector)
                try:
                    text = b.text(selector)
                except:  # if selector disappears
                    return False

                if (accepted and accepted in text) or text == 'in transition':
                    return False
                elif wanted in text:
                    return True
                else:
                    raise Exception("invalid vm state")

            with b.wait_timeout(4):
                b.wait_present(selector)
                b.wait(lambda: waitForWanted(before, wanted))

            b.wait(lambda: waitForWanted(wanted, after))

        def tryCreate(self, dialog):
            b = self.browser
            name = dialog.name

            dialog.open() \
                .fill() \
                .create()

            # successfully created
            b.wait_present("#vm-{0}-row".format(name))
            b.wait_in_text("#vm-{0}-row".format(name), name)

            if dialog.start_vm:
                # wait for console tab to open
                b.expect_load_frame("vm-{0}-novnc-frame-container".format(name))
            else:
                # wait for Overview tab to open
                b.wait_present("#vm-{0}-memory".format(name))
                b.wait_present("#vm-{0}-vcpus".format(name))

            # check memory
            b.wait_present("#vm-{0}-usage".format(name))
            b.click("#vm-{0}-usage".format(name))
            b.wait_present("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption")
            b.wait_in_text("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption", dialog.getMemoryText())

            # check disks
            b.wait_present("#vm-{0}-disks".format(name))  # wait for the tab
            b.click("#vm-{0}-disks".format(name))  # open the "Disks" subtab

            # Test disk creation
            if dialog.storage_size > 0:
                if b.is_present("#vm-{0}-disks-vda-target".format(name)):
                    b.wait_in_text("#vm-{0}-disks-vda-target".format(name), "vda")
                else:
                    b.wait_in_text("#vm-{0}-disks-hda-target".format(name), "hda")

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

            b.wait_present("#vm-{0}-install".format(name))
            # should fail because of memory error
            b.click("#vm-{0}-install".format(name))
            # install script redefines vm
            self.assertVmStates(self, name, "shut off", "creating VM installation", "shut off")
            # install
            b.wait_present("#app .listing-ct tbody:nth-of-type(1) th")
            b.wait_in_text("#app .listing-ct tbody:nth-of-type(1) th", name)
            b.wait_present("#app .listing-ct tbody:nth-of-type(1) tr td span span.pficon-warning-triangle-o")

            b.wait_present("#vm-{0}-install".format(name))
            # Overview should be opened
            b.wait_present("#vm-{0}-overview".format(name)) # wait for the tab
            b.click("#vm-{0}-overview".format(name)) # open the "overView" subtab

            b.wait_present("#vm-{0}-last-message".format(name))
            b.wait_in_text("#vm-{0}-last-message".format(name), "INSTALL VM action failed")
            b.click("#app .listing-ct tbody:nth-of-type(1) a:contains(show more)")

            return self

        def deleteVm(self, dialog):
            b = self.browser
            vm_delete_button = "#vm-{0}-delete".format(dialog.name)

            b.wait_present(vm_delete_button)
            b.click(vm_delete_button)
            b.wait_present("#cockpit_modal_dialog")
            b.click("#cockpit_modal_dialog button:contains(Delete)")
            b.wait_not_present("#cockpit_modal_dialog")
            b.wait_not_present("vm-{0}-row".format(dialog.name))

            return self

        def _commandNotRunning(self, command):
            try:
                self.machine.execute("pgrep -fc {0}".format(command))
                return False
            except Exception as e:
                return hasattr(e, 'returncode') and e.returncode == 1

        def assertScriptFinished(self):
            with self.browser.wait_timeout(20):
                self.browser.wait(functools.partial(self._commandNotRunning, "virt-install"))

            return self

        def assertOsInfoQueryFinished(self):
            with self.browser.wait_timeout(10):
                self.browser.wait(functools.partial(self._commandNotRunning, "osinfo-query"))
            return self

        def checkEnvIsEmpty(self):
            b = self.browser
            b.wait_present("thead tr td")
            b.wait_in_text("thead tr td", "No VM is running")
            # wait for the vm and disks to be deleted
            b.wait(lambda: self.machine.execute("virsh list --all | wc -l") == '3\n')
            b.wait(lambda: self.machine.execute(
                "ls /home/admin/.local/share/libvirt/images/ 2>/dev/null | wc -l") == '0\n')

            if b.is_present("#notification-area-notification-1-close"):
                b.click("#notification-area-notification-1-close")

            b.wait_not_present("#notification-area")

            return self


def selectFromDropdown(b, selector, value):
    button_text_selector = "{0} button span:nth-of-type(1)".format(selector)

    b.wait_visible(selector)
    if not b.text(button_text_selector) == value:
        item_selector = "{0} ul li[data-value*='{1}'] a".format(selector, value)
        b.click(selector)
        b.wait_visible(item_selector)
        b.click(item_selector)
        b.wait_in_text(button_text_selector, value)

def setValToElement(b, selector, value):
    value = str(value)

    b.wait_present(selector)
    b.wait_visible(selector)
    b.click(selector)
    b.focus(selector)
    b.set_val(selector, '')  # clear value
    b.key_press(value)
    b.wait_val(selector, value)

if __name__ == '__main__':
    test_main()
