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
import xml.etree.ElementTree as ET

import parent
from testlib import *
from netlib import NetworkHelpers
from storagelib import StorageHelpers


def readFile(name):
    content = ''
    if os.path.exists(name):
        with open(name, 'r') as f:
            content = f.read().replace('\n', '')
    return content


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
    <disk type='file' snapshot='external'>
      <driver name='qemu' type='qcow2'/>
      <source file='{image}'/>
      <target dev='vda' bus='virtio'/>
      <serial>SECOND</serial>
    </disk>
    <controller type='scsi' model='virtio-scsi' index='0' id='hot'/>
    <interface type='network'>
      <source network='default' bridge='virbr0'/>
      <target dev='vnet0'/>
    </interface>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
      <address type='virtio-serial' controller='0' bus='0' port='1'/>
    </channel>
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
# rmmod kvm-intel && modprobe kvm-intel || true

@skipImage("Atomic cannot run virtual machines", "fedora-coreos")
@nondestructive
class TestMachines(MachineCase, StorageHelpers, NetworkHelpers):
    created_pool = False
    provider = None

    def setUp(self):
        super().setUp()
        m = self.machine

        # Keep pristine state of libvirt
        self.restore_dir("/var/lib/libvirt")
        self.restore_dir("/etc/libvirt")

        # Cleanup pools
        self.addCleanup(m.execute, "rm -rf /run/libvirt/storage/*")

        # Cleanup networks
        self.addCleanup(m.execute, "rm -rf /run/libvirt/network/test_network*")

        self.startLibvirt()
        self.addCleanup(m.execute, "systemctl stop libvirtd")

        # Stop all networks
        self.addCleanup(m.execute, "for n in $(virsh net-list --all --name); do virsh net-destroy $n || true; done")

        # Stop all domains
        self.addCleanup(m.execute, "for d in $(virsh list --name); do virsh destroy $d || true; done")

        # we don't have configuration to open the firewall for local libvirt machines, so just stop firewalld
        m.execute("systemctl stop firewalld; systemctl try-restart libvirtd")

        # FIXME: report downstream; AppArmor noisily denies some operations, but they are not required for us
        self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="capable" profile="\S*libvirtd.* capname="sys_rawio".*')
        # AppArmor doesn't like the non-standard path for our storage pools
        self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="virt-aa-helper" name="%s.*' % self.vm_tmpdir)
        if m.image in ["ubuntu-2004"]:
            self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="libvirt.* name="/" .* denied_mask="r" .*')
            self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="libvirt.* name="/sys/bus/nd/devices/" .* denied_mask="r" .*')

        # FIXME: report downstream: qemu often crashes in testAddDisk and testMultipleSettings
        if m.image in ["ubuntu-stable"]:
            self.allow_journal_messages('Process .*qemu-system-x86.* of user .* dumped core.')

        # FIXME: testDomainMemorySettings on Fedora-32 reports this. Figure out where it comes from.
        # Ignoring just to unbreak tests for now
        self.allow_journal_messages("Failed to get COMM: No such process")

    def startLibvirt(self):
        m = self.machine
        # Ensure everything has started correctly
        m.execute("systemctl start libvirtd.service")
        # Wait until we can get a list of domains
        m.execute("until virsh list; do sleep 1; done")
        # Wait for the network 'default' to become active
        m.execute("virsh net-start default || true")
        m.execute("until virsh net-info default | grep 'Active:\s*yes'; do sleep 1; done")

    def startVm(self, name, graphics='spice', ptyconsole=False):
        m = self.machine

        image_file = m.pull("cirros")
        img = "/var/lib/libvirt/images/{0}-2.img".format(name)
        m.upload([image_file], img)
        m.execute("chmod 777 {0}".format(img))

        args = {
            "name": name,
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
            m.execute("echo \"{0}\" > /tmp/xml && virsh pool-define /tmp/xml && virsh pool-start images".format(xml))
            self.created_pool = True

        xml = DOMAIN_XML.format(**args)
        m.execute("echo \"{0}\" > /tmp/xml && virsh define /tmp/xml && virsh start {1}".format(xml, name))

        m.execute('[ "$(virsh domstate {0})" = running ] || '
                  '{{ virsh dominfo {0} >&2; cat /var/log/libvirt/qemu/{0}.log >&2; exit 1; }}'.format(name))

        # TODO check if kernel is booted
        # Ideally we would like to check guest agent event for that
        # Libvirt has a signal for that too: VIR_DOMAIN_EVENT_ID_AGENT_LIFECYCLE
        # https://libvirt.org/git/?p=libvirt-python.git;a=blob;f=examples/guest-vcpus/guest-vcpu-daemon.py;h=30fcb9ce24165c59dec8d9bbe6039f56382e81e3;hb=HEAD

        self.allow_journal_messages('.*denied.*comm="pmsignal".*')

        return args

    # Preparations for iscsi storage pool; return the system's initiator name
    def prepareStorageDeviceOnISCSI(self, target_iqn):
        m = self.machine

        # ensure that we generate a /etc/iscsi/initiatorname.iscsi
        m.execute("systemctl start iscsid")

        orig_iqn = m.execute("sed -n '/^InitiatorName=/ { s/^.*=//; p }' /etc/iscsi/initiatorname.iscsi").strip()

        # Increase the iSCSI timeouts for heavy load during our testing
        self.sed_file(r"s|^\(node\..*log.*_timeout = \).*|\1 60|", "/etc/iscsi/iscsid.conf")

        # make sure this gets cleaned up, to avoid reboot hangs (https://bugzilla.redhat.com/show_bug.cgi?id=1817241)
        self.restore_dir("/var/lib/iscsi")

        # Setup a iSCSI target
        m.execute("""
                  targetcli /backstores/ramdisk create test 50M
                  targetcli /iscsi create %(tgt)s
                  targetcli /iscsi/%(tgt)s/tpg1/luns create /backstores/ramdisk/test
                  targetcli /iscsi/%(tgt)s/tpg1/acls create %(ini)s
                  """ % {"tgt": target_iqn, "ini": orig_iqn})

        self.addCleanup(m.execute, "targetcli /backstores/ramdisk delete test && targetcli /iscsi delete %s" % target_iqn)
        return orig_iqn

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
        b.wait_in_text("#vm-subVmTest1-vcpus-count", "1")

        b.wait_in_text("#vm-subVmTest1-boot-order", "disk,network")
        emulated_machine = b.text("#vm-subVmTest1-emulated-machine")
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
        m.execute('virsh resume subVmTest1 || { virsh destroy subVmTest1 && virsh start subVmTest1; }')
        b.wait_in_text("#vm-subVmTest1-state", "running")

        if args["logfile"] is not None:
            wait(lambda: "Linux version" in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Wait for the system to completely start
        if args["logfile"] is not None:
            wait(lambda: "login as 'cirros' user." in self.machine.execute("cat {0}".format(args["logfile"])), delay=3)

        # Send Non-Maskable Interrupt (no change in VM state is expected)
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-sendNMI")
        b.wait_attr("#vm-subVmTest1-off-caret", "aria-expanded", "false")

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
        b.wait_in_text("#vm-subVmTest2-vcpus-count", "1")
        b.wait_in_text("#vm-subVmTest2-boot-order", "disk,network")

        # restart libvirtd
        m.execute("systemctl stop libvirtd.service")
        b.wait_in_text(".pf-c-empty-state", "Virtualization Service (libvirt) is Not Active")
        m.execute("systemctl start libvirtd.service")
        # HACK: https://launchpad.net/bugs/1802005
        if m.image == "ubuntu-stable":
            m.execute("until test -e /run/libvirt/libvirt-sock; do sleep 1; done")
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
        b.wait_in_text("div.pf-c-alert.pf-m-danger .pf-c-alert__title", "VM subVmTest2 failed to start")

        message = "domain is already running"

        b.wait_in_text("button.alert-link.more-button", "show more") # more/less button
        b.click("button.alert-link.more-button")
        b.wait_in_text(".pf-c-alert__description", message)
        b.wait_in_text("button.alert-link.more-button", "show less")

        b.click("div.pf-c-alert.pf-m-danger button.pf-c-button") # close button
        # inline notification is gone
        b.wait_not_present("div.pf-c-alert.pf-m-danger")
        # triangle by status is gone
        b.wait_not_present(
            "tr.listing-ct-item.listing-ct-nonavigate span span.pficon-warning-triangle-o.machines-status-alert")

        # Check correctness of the toast notifications list
        # We 'll create errors by starting to start domains when the default network in inactive
        self.startVm("subVmTest3")
        m.execute("virsh destroy subVmTest2 && virsh destroy subVmTest3 && virsh net-destroy default")

        def tryRunDomain(index, name):
            b.wait_in_text("#virtual-machines-listing .listing-ct tbody:nth-of-type({0}) th".format(index), name)

            row_classes = b.attr("#virtual-machines-listing .listing-ct tbody:nth-of-type({0})".format(index), "class")
            expanded = row_classes and 'open' in row_classes
            if not expanded:
                b.click("#virtual-machines-listing .listing-ct tbody:nth-of-type({0}) th".format(index)) # click on the row header

            b.click("#vm-{0}-run".format(name))

        # Try to run subVmTest1 - it will fail because of inactive default network
        tryRunDomain(1, 'subVmTest1')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) h4", "VM subVmTest1 failed to start")

        # Try to run subVmTest2
        tryRunDomain(2, 'subVmTest2')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(2) h4", "VM subVmTest2 failed to start")

        # Delete the first notification and check notifications list again
        b.focus(".toast-notifications-list-pf")
        b.click(".toast-notifications-list-pf div:nth-child(1) button.pf-c-button")
        b.wait_not_present(".toast-notifications-list-pf div:nth-child(2) h4")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) h4", "VM subVmTest2 failed to start")

        # Add one more notification
        tryRunDomain(3, 'subVmTest3')
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) h4", "VM subVmTest2 failed to start")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(2) h4", "VM subVmTest3 failed to start")

        # Delete the last notification
        b.focus(".toast-notifications-list-pf")
        b.click(".toast-notifications-list-pf div:nth-child(2) button.pf-c-button")
        b.wait_not_present(".toast-notifications-list-pf div:nth-child(2) h4")
        b.wait_in_text(".toast-notifications-list-pf div:nth-child(1) h4", "VM subVmTest2 failed to start")

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

        # newer libvirtd versions use socket activation
        # we should test that separately, but here we test only using the service unit
        if m.image not in ["debian-stable", "ubuntu-1804", "ubuntu-stable", "rhel-8-2-distropkg", "rhel-8-2", "centos-8-stream"]:
            m.execute("systemctl stop libvirtd-ro.socket libvirtd.socket libvirtd-admin.socket")
            self.addCleanup(m.execute, "systemctl start libvirtd-ro.socket libvirtd.socket libvirtd-admin.socket")

        m.execute("systemctl disable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_in_text(".pf-c-empty-state", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")
        b.click(".pf-c-empty-state button.pf-m-primary")  # Start libvirt
        b.wait(lambda: checkLibvirtEnabled())
        # HACK: https://launchpad.net/bugs/1802005
        if m.image == "ubuntu-stable":
            m.execute("until test -e /run/libvirt/libvirt-sock; do sleep 1; done")
            m.execute("chmod o+rwx /run/libvirt/libvirt-sock")
        b.wait_in_text("body", "Virtual Machines")
        with b.wait_timeout(15):
            b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        m.execute("systemctl stop {0}".format(libvirtServiceName))
        b.wait_in_text(".pf-c-empty-state", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")
        b.click("#enable-libvirt") # uncheck it ; ; TODO: fix this, do not assume initial state of the checkbox
        b.click(".pf-c-empty-state button.pf-m-primary")  # Start libvirt
        b.wait(lambda: not checkLibvirtEnabled())
        # HACK: https://launchpad.net/bugs/1802005
        if m.image == "ubuntu-stable":
            m.execute("until test -e /run/libvirt/libvirt-sock; do sleep 1; done")
            m.execute("chmod o+rwx /run/libvirt/libvirt-sock")
        b.wait_in_text("body", "Virtual Machines")
        with b.wait_timeout(15):
            b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        m.execute("systemctl enable {0}".format(libvirtServiceName))
        m.execute("systemctl stop {0}".format(libvirtServiceName))

        b.wait_in_text(".pf-c-empty-state", "Virtualization Service (libvirt) is Not Active")
        b.wait_present("#enable-libvirt:checked")

        b.click(".pf-c-empty-state button.pf-m-secondary")  # Troubleshoot
        b.leave_page()
        url_location = "/system/services#/{0}".format(libvirtServiceName)
        b.wait(lambda: url_location in b.eval_js("window.location.href"))

        # Make sure that unprivileged users can see the VM list when libvirtd is not running
        m.execute("systemctl stop libvirtd.service")
        m.execute("useradd nonadmin; echo nonadmin:foobar | chpasswd")
        self.login_and_go("/machines", user="nonadmin", authorized=False)
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("#virtual-machines-listing thead tr td", "No VM is running")
        b.logout()

        self.allow_authorize_journal_messages()

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

        b.wait_in_text("#vm-subVmTest1-disks-vda-device", "disk")

        b.wait_in_text("#vm-subVmTest1-disks-vda-source-file", "/var/lib/libvirt/images/subVmTest1-2.img")

        # Test domstats
        self.wait_for_disk_stats("subVmTest1", "vda")
        if b.is_present("#vm-subVmTest1-disks-vda-used"):
            b.wait_in_text("#vm-subVmTest1-disks-vda-used", "0.0")

        # Test add disk by external action
        m.execute("qemu-img create -f raw /var/lib/libvirt/images/image3.img 128M")
        # attach to the virtio bus instead of ide
        m.execute("virsh attach-disk subVmTest1 /var/lib/libvirt/images/image3.img vdc")

        b.wait_present("#vm-subVmTest1-disks-vda-used")

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

        b.wait_present("#vm-subVmTest1-disks-vda-device")
        b.wait_not_present("#vm-subVmTest1-disks-vdc-device")

    # Test Add Disk via dialog
    @timeout(900)
    def testAddDisk(self):
        b = self.browser
        m = self.machine

        dev = self.add_ram_disk()

        class VMAddDiskDialog(object):
            def __init__(
                self, test_obj, pool_name=None, volume_name=None,
                vm_name='subVmTest1',
                volume_size=1, volume_size_unit='GiB',
                use_existing_volume=False,
                expected_target='vda', permanent=False, cache_mode=None,
                bus_type='virtio', verify=True, pool_type=None,
                volume_format=None,
                persistent_vm=True,
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
                self.bus_type = bus_type
                self.verify = verify
                self.pool_type = pool_type
                self.volume_format = volume_format
                self.persistent_vm = persistent_vm

            def execute(self):
                self.open()
                self.fill()
                if self.verify:
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
                    if not self.pool_type or self.pool_type not in ['iscsi', 'iscsi-direct']:
                        b.select_from_dropdown("#vm-{0}-disks-adddisk-new-select-pool".format(self.vm_name), self.pool_name)
                    else:
                        b.click("#vm-{0}-disks-adddisk-new-select-pool".format(self.vm_name))
                        b.wait_present(".modal-dialog option[data-value={0}]:disabled".format(self.pool_name))
                        return self

                    # Insert name for the new volume
                    b.set_input_text("#vm-{0}-disks-adddisk-new-name".format(self.vm_name), self.volume_name)
                    # Insert size for the new volume
                    b.set_input_text("#vm-{0}-disks-adddisk-new-size".format(self.vm_name), str(self.volume_size))
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-new-unit".format(self.vm_name), self.volume_size_unit)

                    if self.volume_format:
                        b.select_from_dropdown("#vm-{0}-disks-adddisk-new-format".format(self.vm_name), self.volume_format)

                    # Configure persistency - by default the check box in unchecked for running VMs
                    if self.permanent:
                        b.click("#vm-{0}-disks-adddisk-permanent".format(self.vm_name))
                else:
                    # Choose storage pool
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-existing-select-pool".format(self.vm_name), self.pool_name)
                    # Select from the available volumes
                    b.select_from_dropdown("#vm-{0}-disks-adddisk-existing-select-volume".format(self.vm_name), self.volume_name)

                    # Configure persistency - by default the check box in unchecked for running VMs
                    if self.permanent:
                        b.click("#vm-{0}-disks-adddisk-permanent".format(self.vm_name))

                # Check non-persistent VM cannot have permanent disk attached
                if not self.persistent_vm:
                    b.wait_not_present("#vm-{0}-disks-adddisk-new-permanent".format(self.vm_name))

                # Configure performance options
                if self.cache_mode:
                    b.click("div.modal-dialog button:contains(Show Additional Options)")
                    b.select_from_dropdown("div.modal-dialog #cache-mode", self.cache_mode)
                    b.click("div.modal-dialog button:contains(Hide Additional Options)")
                else:
                    b.wait_not_present("#div.modal-dialog #cache-mode")

                # Configure bus type
                if self.bus_type != "virtio":
                    b.click("div.modal-dialog button:contains(Show Additional Options)")
                    b.select_from_dropdown("div.modal-dialog #bus-type", self.bus_type)
                    b.click("div.modal-dialog button:contains(Hide Additional Options)")
                else:
                    b.wait_not_present("#div.modal-dialog #cache-mode")

                return self

            def add_disk(self):
                b.click(".modal-footer button:contains(Add)")
                b.wait_not_present("vm-{0}-disks-adddisk-dialog-modal-window".format(self.vm_name))

                return self

            def verify_disk_added(self):
                b.wait_in_text("#vm-{0}-disks-{1}-bus".format(self.vm_name, self.expected_target), self.bus_type)
                b.wait_in_text("#vm-{0}-disks-{1}-device".format(self.vm_name, self.expected_target), "disk")

                # Check volume was added to pool's volume list
                if not self.use_existing_volume:
                    b.click(".cards-pf .card-pf-title span:contains(Storage Pool)")

                    b.wait_present("tbody tr[data-row-id=pool-{0}-system] th".format(self.pool_name))
                    b.click("tbody tr[data-row-id=pool-{0}-system] th".format(self.pool_name))

                    b.wait_present("#pool-{0}-system-storage-volumes".format(self.pool_name))
                    b.click("#pool-{0}-system-storage-volumes".format(self.pool_name)) # open the "Storage Volumes" subtab
                    b.wait_present("#pool-{0}-system-volume-{1}-name".format(self.pool_name, self.volume_name))

                    b.click(".machines-listing-breadcrumb li a:contains(Virtual Machines)")
                    b.click("tbody tr[data-row-id=vm-subVmTest1] th")
                    b.click("#vm-subVmTest1-disks") # open the "Disks" subtab

                # Detect volume format
                detect_format_cmd = "virsh vol-dumpxml {0} {1} | xmllint --xpath '{2}' -"

                b.wait_in_text('#vm-{0}-disks-{1}-source-volume'.format(self.vm_name, self.expected_target), self.volume_name)
                if self.cache_mode:
                    b.wait_in_text("#vm-{0}-disks-{1}-cache".format(self.vm_name, self.expected_target), self.cache_mode)
                # Guess by the name of the pool it's format to avoid passing more parameters
                if self.pool_type == 'iscsi':
                    expected_format = 'unknown'
                else:
                    expected_format = 'qcow2'

                if self.pool_type == 'disk':
                    expected_format = 'none'

                # Unknown pool format isn't present in xml anymore
                if expected_format == "unknown" and m.execute("virsh --version") >= "5.6.0":
                    m.execute(detect_format_cmd.format(self.volume_name, self.pool_name, "/volume/target") + " | grep -qv format")
                else:
                    self.test_obj.assertEqual(
                        m.execute(detect_format_cmd.format(self.volume_name, self.pool_name, "/volume/target/format")).rstrip(),
                        '<format type="{0}"/>'.format(self.volume_format or expected_format)
                    )
                return self

        used_targets = ['vda']

        def get_next_free_target():
            i = 0
            while ("vd" + chr(97 + i) in used_targets):
                i += 1

            used_targets.append("vd" + chr(97 + i))
            return "vd" + chr(97 + i)

        def release_target(target):
            used_targets.remove(target)

        # prepare libvirt storage pools
        v1 = os.path.join(self.vm_tmpdir, "vm_one")
        v2 = os.path.join(self.vm_tmpdir, "vm_two")
        default_tmp = os.path.join(self.vm_tmpdir, "default_tmp")
        m.execute("mkdir --mode 777 {0} {1} {2}".format(v1, v2, default_tmp))
        m.execute("virsh pool-define-as default_tmp --type dir --target {0} && virsh pool-start default_tmp".format(default_tmp))
        m.execute("virsh pool-define-as myPoolOne --type dir --target {0} && virsh pool-start myPoolOne".format(v1))
        m.execute("virsh pool-define-as myPoolTwo --type dir --target {0} && virsh pool-start myPoolTwo".format(v2))

        m.execute("virsh vol-create-as default_tmp defaultVol --capacity 1G --format raw")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_temporary --capacity 1G --format qcow2")
        m.execute("virsh vol-create-as myPoolTwo mydiskofpooltwo_permanent --capacity 1G --format qcow2")
        wait(lambda: "mydiskofpooltwo_permanent" in m.execute("virsh vol-list myPoolTwo"))

        # Prepare a local NFS pool
        self.restore_file("/etc/exports")
        nfs_pool = os.path.join(self.vm_tmpdir, "nfs_pool")
        mnt_exports = os.path.join(self.vm_tmpdir, "mnt_exports")
        m.execute("mkdir {0} {1} && echo '{1} 127.0.0.1/24(rw,sync,no_root_squash,no_subtree_check,fsid=0)' > /etc/exports".format(nfs_pool, mnt_exports))
        m.execute("systemctl restart nfs-server")
        m.execute("virsh pool-define-as nfs-pool --type netfs --target {0} --source-host 127.0.0.1 --source-path {1} && virsh pool-start nfs-pool".format(nfs_pool, mnt_exports))
        # And create a volume on it in order to test use existing volume dialog
        m.execute("virsh vol-create-as --pool nfs-pool --name nfs-volume-0 --capacity 1M --format qcow2")

        # Prepare an iscsi pool
        # Debian images' -cloud kernel don't have target-cli-mod kmod
        # Ubuntu 19.10 is affected by https://bugzilla.redhat.com/show_bug.cgi?id=1659195
        if "debian" not in m.image and m.image != "ubuntu-stable":
            # Preparations for testing ISCSI pools

            target_iqn = "iqn.2019-09.cockpit.lan"
            self.prepareStorageDeviceOnISCSI(target_iqn)

            m.execute("virsh pool-define-as iscsi-pool --type iscsi --target /dev/disk/by-path --source-host 127.0.0.1 --source-dev {0} && virsh pool-start iscsi-pool".format(target_iqn))
            wait(lambda: "unit:0:0:0" in self.machine.execute("virsh pool-refresh iscsi-pool && virsh vol-list iscsi-pool"), delay=3)

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
            expected_target=get_next_free_target(),
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='mydiskofpoolone_permanent',
            use_existing_volume=False,
            volume_size=2,
            permanent=True,
            cache_mode='writeback',
            expected_target=get_next_free_target(),
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
            expected_target=get_next_free_target(),
        ).execute()

        # check the autoselected options
        # default_tmp pool should be autoselected since it's the first in alphabetical order
        # defaultVol volume should be autoselected since it's the only volume in default_tmp pool
        VMAddDiskDialog(
            self,
            pool_name='default_tmp',
            volume_name='defaultVol',
            use_existing_volume=True,
            expected_target=get_next_free_target(),
            volume_format='raw',
        ).open().add_disk().verify_disk_added()

        VMAddDiskDialog(
            self,
            pool_name='nfs-pool',
            volume_name='nfs-volume-0',
            use_existing_volume=True,
            volume_size=1,
            volume_size_unit='MiB',
            expected_target=get_next_free_target(),
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='nfs-pool',
            volume_name='nfs-volume-1',
            volume_size=1,
            volume_size_unit='MiB',
            expected_target=get_next_free_target(),
        ).execute()

        if "debian" not in m.image and "ubuntu" not in m.image:
            # ISCSI driver does not support virStorageVolCreate API
            VMAddDiskDialog(
                self,
                pool_name='iscsi-pool',
                pool_type='iscsi',
                verify=False
            ).execute()

            VMAddDiskDialog(
                self,
                pool_name='iscsi-pool',
                pool_type='iscsi',
                volume_name='unit:0:0:0',
                expected_target=get_next_free_target(),
                use_existing_volume='True',
            ).execute()

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='scsi_bus_disk',
            use_existing_volume=False,
            bus_type='scsi',
            expected_target='sda',
        ).execute()

        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='usb_bus_disk',
            use_existing_volume=False,
            bus_type='usb',
            expected_target='sdb',
        ).execute()

        # shut off
        b.click("#vm-subVmTest1-off-caret")
        b.click("#vm-subVmTest1-forceOff")
        b.wait_in_text("#vm-subVmTest1-state", "shut off")

        # check if the just added non-permanent disks are gone
        b.wait_not_present("#vm-subVmTest1-disks-vdb-device")
        b.wait_not_present("#vm-subVmTest1-disks-vde-device")
        release_target("vdb")
        release_target("vde")
        b.wait_present("#vm-subVmTest1-disks-vdc-device")
        b.wait_present("#vm-subVmTest1-disks-vdd-device")

        # testing sata disk after VM shutoff because sata disk cannot be hotplugged
        VMAddDiskDialog(
            self,
            pool_name='myPoolOne',
            volume_name='sata_bus_disk',
            use_existing_volume=False,
            bus_type='sata',
            expected_target='sda',
        ).execute()

        # Apparmor on debian and ubuntu may prevent access to /dev/sdb1 when starting VM,
        # https://bugs.launchpad.net/ubuntu/+source/libvirt/+bug/1677398
        if "debian" not in m.image and "ubuntu" not in m.image:
            # Run VM
            b.click("#vm-subVmTest1-run")
            b.wait_in_text("#vm-subVmTest1-state", "running")
            # Test disk attachment to non-persistent VM
            m.execute("virsh undefine subVmTest1")
            VMAddDiskDialog(
                self,
                pool_name='myPoolOne',
                volume_name='non-peristent-vm-disk',
                permanent=False,
                persistent_vm=False,
                expected_target=get_next_free_target(),
            ).execute()

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
        b.click(".modal-footer button:contains(Cancel)")

        # Make sure that trying to inspect the Disks tab will just show the fields that are available when a pool is inactive
        b.reload()
        b.enter_page('/machines')
        b.wait_in_text("body", "Virtual Machines")
        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.click("#vm-subVmTest1-disks") # open the "Disks" subtab
        # Check that usage information can't be fetched since the pool is inactive
        b.wait_not_present("#vm-subVmTest1-disks-vdd-used")

        cmds = [
            "virsh pool-define-as pool-disk disk - - %s - /tmp/poolDiskImages" % dev,
            "virsh pool-build pool-disk --overwrite",
            "virsh pool-start pool-disk",
        ]
        self.machine.execute(" && ".join(cmds))
        partition = os.path.basename(dev) + "1"
        VMAddDiskDialog(
            self,
            pool_name='pool-disk',
            pool_type='disk',
            volume_name=partition,
            volume_size=10,
            volume_size_unit='MiB',
            expected_target=get_next_free_target(),
        ).execute()

        # avoid error noise about resources getting cleaned up
        b.logout()

        # AppArmor doesn't like the non-standard path for our storage pools
        if m.image in ["debian-testing", "ubuntu-stable"]:
            self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="libvirt.* name="%s.*' % self.vm_tmpdir)

    def testVmNICs(self):
        b = self.browser
        m = self.machine

        self.startVm("subVmTest1")

        self.login_and_go("/machines")
        b.wait_in_text("body", "Virtual Machines")
        b.wait_in_text("tbody tr[data-row-id=vm-subVmTest1] th", "subVmTest1")

        b.click("tbody tr[data-row-id=vm-subVmTest1] th") # click on the row header
        b.wait_in_text("#vm-subVmTest1-state", "running")

        # Wait for the dynamic IP address to be assigned before logging in
        # If the IP will change or get assigned after fetching the domain data the user will not see any
        # changes until they refresh the page, since there is not any signal associated with this change
        wait(lambda: "1" in self.machine.execute("virsh domifaddr subVmTest1  | grep 192.168.122. | wc -l"), delay=3)
        b.click("#vm-subVmTest1-networks") # open the "Networks" subtab

        b.wait_in_text("#vm-subVmTest1-network-1-type", "network")
        b.wait_in_text("#vm-subVmTest1-network-1-source", "default")

        b.wait_in_text("#vm-subVmTest1-network-1-ipaddress", "192.168.122.")

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

        # non-persistent VM doesn't have configurable vcpu
        m.execute("virsh undefine subVmTest1")
        b.wait_present("button#vm-subVmTest1-vcpus-count:disabled")

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
            self.machine.execute('mkdir -p /etc/cockpit/ && echo "[WebService]\nUrlRoot=%s" > /etc/cockpit/cockpit.conf' % urlroot)

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
            b.wait_present("#vm-subVmTest1-disks-adddisk-dialog-modal-window")
            b.wait_present("label:contains(Create New)") # radio button label in the modal dialog

            b.select_from_dropdown("#vm-subVmTest1-disks-adddisk-new-select-pool", poolName)
            b.set_input_text("#vm-subVmTest1-disks-adddisk-new-name", volName)
            b.set_input_text("#vm-subVmTest1-disks-adddisk-new-size", "10")
            b.select_from_dropdown("#vm-subVmTest1-disks-adddisk-new-unit", "MiB")
            b.click("#vm-subVmTest1-disks-adddisk-permanent")

            b.click("#vm-subVmTest1-disks-adddisk-dialog-add")
            b.wait_not_present("#vm-subVmTest1-disks-adddisk-dialog-modal-window")

            b.wait_present("#vm-subVmTest1-disks-vdb-source-volume")
            b.wait_present("#vm-subVmTest1-disks-vdb-source-pool")

        secondDiskVolName = "mydisk"
        poolName = "images"
        secondDiskPoolPath = "/var/lib/libvirt/images/"

        addDisk(secondDiskVolName, poolName)

        b.click("#vm-{0}-delete".format(name))

        b.wait_present("#vm-{0}-delete-modal-dialog div:contains(The VM is running)".format(name))
        b.wait_present("#vm-{1}-delete-modal-dialog ul li:first-child #disk-source-file:contains({0})".format(img2, name))
        # virsh attach-disk does not create disks of type volume
        b.wait_present("#vm-{1}-delete-modal-dialog #disk-source-volume:contains({0})".format(secondDiskVolName, name))
        b.wait_present("#vm-{1}-delete-modal-dialog #disk-source-pool:contains({0})".format(poolName, name))
        b.click("#vm-{0}-delete-modal-dialog button:contains(Delete)".format(name))
        b.wait_not_present("#vm-{0}-delete-modal-dialog".format(name))

        b.wait_not_present("#vm-{0}-row".format(name))

        m.execute("while test -f {0}; do sleep 1; done".format(img2))
        m.execute("while test -f {0}; do sleep 1; done".format(secondDiskPoolPath + secondDiskVolName))

        self.assertNotIn(name, m.execute("virsh list --all --name"))

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

        # Try to delete a transient VM
        name = "transient-VM"
        args = self.startVm(name)
        m.execute("virsh undefine {0}".format(name))
        b.reload()
        self.browser.enter_page('/machines')
        b.click("tbody tr[data-row-id=vm-{0}] th".format(name)) # click on the row header
        b.wait_present("#vm-{0}-delete:disabled".format(name))
        b.click("#vm-{0}-off-caret".format(name))
        b.click("#vm-{0}-forceOff".format(name))
        b.wait_not_present("tbody tr[data-row-id=vm-{0}] th".format(name))
        b.wait_not_present(".toast-notifications.list-pf div.pf-c-alert")

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
        b.wait_in_text("#{0}-terminal .xterm-accessibility-tree > div:nth-child(1)".format(name), "Connected to domain")

        b.click("#{0}-serialconsole-disconnect".format(name))
        b.wait_text("#{0}-terminal".format(name), "Disconnected from serial console. Click the Connect button.")

        b.click("#{0}-serialconsole-connect".format(name))
        b.wait_in_text("#{0}-terminal .xterm-accessibility-tree > div:nth-child(1)".format(name), "Connected to domain")

        # disconnecting the serial console closes the pty channel
        self.allow_journal_messages("connection unexpectedly closed by peer",
                                    ".*Connection reset by peer")
        self.allow_browser_errors("Disconnection timed out.")

    @timeout(1200)
    def testCreate(self):
        """
        this test will print many expected error messages
        """

        runner = TestMachines.CreateVmRunner(self)
        config = TestMachines.TestCreateConfig

        self.login_and_go("/machines")
        self.browser.wait_in_text("body", "Virtual Machines")

        def cancelDialogTest(dialog):
            dialog.open() \
                .fill() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkFilteredOsTest(dialog):
            dialog.open() \
                .checkOsFiltered() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkPXENotAvailableSessionTest(dialog):
            dialog.open() \
                .checkPXENotAvailableSession() \
                .cancel(True)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def checkDialogFormValidationTest(dialog, errors):
            dialog.open() \
                .fill() \
                .createAndExpectInlineValidationErrors(errors) \
                .cancel(True)
            if dialog.check_script_finished:
                runner.assertScriptFinished()
            if dialog.env_is_empty:
                runner.checkEnvIsEmpty()

        def checkDialogErrorTest(dialog, errors):
            dialog.open() \
                .fill() \
                .createAndExpectError(errors) \
                .cancel(False)
            runner.assertScriptFinished() \
                .checkEnvIsEmpty()

        def createDownloadAnOSTest(dialog):
            dialog.open() \
                .fill() \
                .createAndVerifyVirtInstallArgs()
            if dialog.delete:
                self.machine.execute("killall -9 virt-install")
                runner.checkEnvIsEmpty()

        def createTest(dialog):
            runner.tryCreate(dialog) \

            # When not booting the actual OS from either existing image or PXE
            # configure virt-install to wait for the installation to complete.
            # Thus we should only check that virt-install exited when using existing disk images.
            if dialog.sourceType == 'disk_image' or dialog.sourceType == 'pxe':
                runner.assertScriptFinished() \
                    .assertDomainDefined(dialog.name, dialog.connection)

            if dialog.delete:
                runner.deleteVm(dialog) \
                      .checkEnvIsEmpty()

        def createThenInstallTest(dialog):
            runner.tryCreateThenInstall(dialog) \
                  .assertScriptFinished() \
                  .assertDomainDefined(dialog.name, dialog.connection) \
                  .deleteVm(dialog) \
                  .checkEnvIsEmpty()

        def installWithErrorTest(dialog):
            runner.tryInstallWithError(dialog) \
                .assertScriptFinished() \
                .deleteVm(dialog) \
                .checkEnvIsEmpty()

        runner.checkEnvIsEmpty()

        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        # Check that when there is no storage pool defined a VM can still be created
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         storage_pool="No Storage",
                                         start_vm=True))

        self.browser.switch_to_top()
        self.browser.wait_not_visible("#navbar-oops")

        # define default storage pool for system connection
        cmds = [
            "virsh pool-define-as default --type dir --target /var/lib/libvirt/images",
            "virsh pool-start default"
        ]
        self.machine.execute(" && ".join(cmds))

        # Fake the osinfo-db data in order that it will allow spawn the installation - of course we don't expect it to succeed -
        # we just need to check that the VM was spawned
        fedora_28_xml = self.machine.execute("cat /usr/share/osinfo/os/fedoraproject.org/fedora-28.xml")
        root = ET.fromstring(fedora_28_xml)
        root.find('os').find('resources').find('minimum').find('ram').text = '134217750'
        root.find('os').find('resources').find('minimum').find('storage').text = '134217750'
        root.find('os').find('resources').find('recommended').find('ram').text = '268435500'
        root.find('os').find('resources').find('recommended').find('storage').text = '268435500'
        new_fedora_28_xml = ET.tostring(root)
        self.machine.execute("echo \'{0}\' > /tmp/fedora-28.xml".format(str(new_fedora_28_xml, 'utf-8')))
        self.machine.execute("mount -o bind /tmp/fedora-28.xml /usr/share/osinfo/os/fedoraproject.org/fedora-28.xml")
        self.addCleanup(self.machine.execute, "umount /usr/share/osinfo/os/fedoraproject.org/fedora-28.xml || true")

        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         storage_size=1))

        # test just the DIALOG CREATION and cancel
        print("    *\n    * validation errors and ui info/warn messages expected:\n    * ")
        cancelDialogTest(TestMachines.VmDialog(self, sourceType='file',
                                               location=config.NOVELL_MOCKUP_ISO_PATH,
                                               memory_size=128, memory_size_unit='MiB',
                                               storage_size=12500, storage_size_unit='GiB',
                                               start_vm=True))

        cancelDialogTest(TestMachines.VmDialog(self, sourceType='url',
                                               location=config.VALID_URL,
                                               memory_size=256, memory_size_unit='MiB',
                                               os_name=config.FEDORA_28,
                                               start_vm=False))

        # check if older os are filtered
        checkFilteredOsTest(TestMachines.VmDialog(self, os_name=config.REDHAT_RHEL_4_7_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, os_name=config.MANDRIVA_2011_FILTERED_OS))

        checkFilteredOsTest(TestMachines.VmDialog(self, os_name=config.MAGEIA_3_FILTERED_OS))

        # try to CREATE WITH DIALOG ERROR
        # name
        checkDialogFormValidationTest(TestMachines.VmDialog(self, "", storage_size=1), {"Name": "Name must not be empty"})

        # name already exists
        createTest(TestMachines.VmDialog(self, name='existing-name', sourceType='url',
                                         location=config.VALID_URL, storage_size=1,
                                         delete=False))

        self.machine.execute("virsh undefine existing-name")

        # name already used from a VM that is currently being created
        # https://bugzilla.redhat.com/show_bug.cgi?id=1780451
        # downloadOS option exists only in virt-install >= 2.2.1 which is the reason we have the condition for the OSes list below
        if self.machine.image in ['debian-stable', 'debian-testing', 'ubuntu-stable', 'ubuntu-1804', 'centos-8-stream']:
            self.browser.wait_not_present('select option[data-value="Download an OS"]')
        else:
            createDownloadAnOSTest(TestMachines.VmDialog(self, name='existing-name', sourceType='downloadOS',
                                                         expected_memory_size=256,
                                                         expected_storage_size=256,
                                                         os_name=config.FEDORA_28,
                                                         os_short_id=config.FEDORA_28_SHORTID,
                                                         start_vm=True, delete=False))

            checkDialogFormValidationTest(TestMachines.VmDialog(self, "existing-name", storage_size=1,
                                                                check_script_finished=False, env_is_empty=False), {"Name": "already exists"})

            self.machine.execute("killall -9 virt-install")

            # Close the notificaton which will appear for the failed installation
            self.browser.click(".toast-notifications-list-pf div.pf-c-alert button.pf-c-button")
            self.browser.wait_not_present(".toast-notifications-list-pf div.pf-c-alert")

        # location
        checkDialogFormValidationTest(TestMachines.VmDialog(self, sourceType='url',
                                                            location="invalid/url",
                                                            os_name=config.FEDORA_28), {"Source": "Source should start with"})

        # memory
        checkDialogFormValidationTest(TestMachines.VmDialog(self, memory_size=0, os_name=None), {"Memory": "Memory must not be 0"})

        # storage
        checkDialogFormValidationTest(TestMachines.VmDialog(self, storage_size=0), {"Size": "Storage size must not be 0"})

        # start vm
        checkDialogFormValidationTest(TestMachines.VmDialog(self, storage_size=1,
                                                            os_name=config.FEDORA_28, start_vm=True),
                                      {"Source": "Installation Source must not be empty"})

        # disallow empty OS
        checkDialogFormValidationTest(TestMachines.VmDialog(self, sourceType='url', location=config.VALID_URL,
                                                            storage_size=100, storage_size_unit='MiB',
                                                            start_vm=False, os_name=None),
                                      {"Operating System": "You need to select the most closely matching Operating System"})

        # try to CREATE few machines
        if self.machine.image in ['debian-stable', 'debian-testing', 'ubuntu-stable', 'ubuntu-1804', 'centos-8-stream']:
            self.browser.wait_not_present('select option[data-value="Download an OS"]')
        else:
            createDownloadAnOSTest(TestMachines.VmDialog(self, sourceType='downloadOS',
                                                         expected_memory_size=256,
                                                         expected_storage_size=256,
                                                         os_name=config.FEDORA_28,
                                                         os_short_id=config.FEDORA_28_SHORTID))

            createDownloadAnOSTest(TestMachines.VmDialog(self, sourceType='downloadOS',
                                                         is_unattended=True, profile="Workstation",
                                                         user_password="catsaremybestfr13nds", root_password="dogsaremybestfr13nds",
                                                         storage_size=246, storage_size_unit='MiB',
                                                         os_name=config.FEDORA_28,
                                                         os_short_id=config.FEDORA_28_SHORTID))

            # Don't create user account
            createDownloadAnOSTest(TestMachines.VmDialog(self, sourceType='downloadOS',
                                                         is_unattended=True, profile="Server",
                                                         root_password="catsaremybestfr13nds",
                                                         storage_size=256, storage_size_unit='MiB',
                                                         os_name=config.FEDORA_28,
                                                         os_short_id=config.FEDORA_28_SHORTID))

            # Don't create root account
            createDownloadAnOSTest(TestMachines.VmDialog(self, sourceType='downloadOS',
                                                         is_unattended=True, profile="Workstation",
                                                         user_password="catsaremybestfr13nds",
                                                         storage_size=256, storage_size_unit='MiB',
                                                         os_name=config.FEDORA_28,
                                                         os_short_id=config.FEDORA_28_SHORTID))

            self.machine.execute("umount /usr/share/osinfo/os/fedoraproject.org/fedora-28.xml || true")

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         memory_size=512, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         os_name=config.MICROSOFT_SERVER_2016))

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         memory_size=512, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         os_name=config.MICROSOFT_SERVER_2016,
                                         start_vm=False))

        createTest(TestMachines.VmDialog(self, sourceType='url',
                                         location=config.VALID_URL,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=100, storage_size_unit='MiB',
                                         start_vm=False))
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         start_vm=False,
                                         connection='session'))

        # Try setting the storage size to value bigger than it's available
        # The dialog should auto-adjust it to match the pool's available space
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_size=100000, storage_size_unit='GiB',
                                         start_vm=False))

        # Try setting the memory to value bigger than it's available on the OS
        # The dialog should auto-adjust it to match the OS'es total memory
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=100000, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         os_name=config.OPENBSD_6_3,
                                         start_vm=False))

        # Start of tests for import existing disk as installation option
        createTest(TestMachines.VmDialog(self, sourceType='disk_image',
                                         location=config.VALID_DISK_IMAGE_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         start_vm=False))

        # Recreate the image the previous test just deleted to reuse it
        self.machine.execute("qemu-img create {0} 500M".format(TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))

        # Unload KVM module, otherwise we get errors getting the nested VMs
        # to start properly.
        # This is applicable for all tests that we want to really successfully run a nested VM.
        # in order to allow the rest of the tests to run faster with QEMU KVM
        # Stop pmcd service if available which is invoking pmdakvm and is keeping KVM module used
        self.machine.execute("(systemctl stop pmcd || true) && modprobe -r kvm_intel && modprobe -r kvm_amd && modprobe -r kvm")

        createTest(TestMachines.VmDialog(self, sourceType='disk_image',
                                         location=config.VALID_DISK_IMAGE_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         start_vm=True))
        # End of tests for import existing disk as installation option

        cmds = [
            "mkdir -p /var/lib/libvirt/pools/tmpPool; chmod a+rwx /var/lib/libvirt/pools/tmpPool",
            "virsh pool-define-as tmpPool --type dir --target /var/lib/libvirt/pools/tmpPool",
            "virsh pool-start tmpPool",
            "qemu-img create -f qcow2 /var/lib/libvirt/pools/tmpPool/vmTmpDestination.qcow2 128M",
            "virsh pool-refresh tmpPool"
        ]
        self.machine.execute(" && ".join(cmds))

        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        # Check choosing existing volume as destination storage
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_pool="tmpPool",
                                         storage_volume="vmTmpDestination.qcow2",
                                         start_vm=True,))

        # Check "No Storage" option (only define VM)
        createTest(TestMachines.VmDialog(self, sourceType='file',
                                         location=config.NOVELL_MOCKUP_ISO_PATH,
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         start_vm=True,))

        # Test create VM with disk of type "block"
        dev = self.add_ram_disk()
        cmds = [
            "virsh pool-define-as poolDisk disk - - {0} - {1}".format(dev, os.path.join(self.vm_tmpdir, "poolDiskImages")),
            "virsh pool-build poolDisk --overwrite",
            "virsh pool-start poolDisk",
            "virsh vol-create-as poolDisk sda1 1024"
        ]
        self.machine.execute(" && ".join(cmds))

        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        # Check choosing existing volume as destination storage
        createThenInstallTest(TestMachines.VmDialog(self, sourceType='file',
                                                    location=config.NOVELL_MOCKUP_ISO_PATH,
                                                    memory_size=256, memory_size_unit='MiB',
                                                    storage_pool="poolDisk",
                                                    storage_volume="sda1"))

        if "debian" not in self.machine.image and "ubuntu" not in self.machine.image:
            # Test create VM with disk of type "network"
            target_iqn = "iqn.2019-09.cockpit.lan"
            self.prepareStorageDeviceOnISCSI(target_iqn)

            cmds = [
                "virsh pool-define-as --name poolIscsi --type iscsi --source-host 127.0.0.1 --source-dev {0} --target /dev/disk/by-path/".format(target_iqn),
                "virsh pool-build poolIscsi",
                "virsh pool-start poolIscsi",
                "virsh pool-refresh poolIscsi", # pool-start takes too long, libvirt's pool-refresh might not catch all volumes, so we do pool-refresh separately
            ]
            self.machine.execute(" && ".join(cmds))
            self.addCleanup(self.machine.execute, "virsh pool-destroy poolIscsi; virsh pool-delete pool-delete; virsh pool-undefine poolIscsi")

            self.browser.reload()
            self.browser.enter_page('/machines')
            self.browser.wait_in_text("body", "Virtual Machines")

            # Check choosing existing volume as destination storage
            createThenInstallTest(TestMachines.VmDialog(self, sourceType='file',
                                                        location=config.NOVELL_MOCKUP_ISO_PATH,
                                                        memory_size=256, memory_size_unit='MiB',
                                                        storage_pool="poolIscsi",
                                                        storage_volume="unit:0:0:0"))

        virtInstallVersion = self.machine.execute("virt-install --version")
        if virtInstallVersion >= "2":
            self.machine.upload(["verify/files/min-openssl-config.cnf", "verify/files/mock-range-server.py"], "/tmp/")

            # Test detection of ISO file in URL
            cmds = [
                # Generate certificate for https server
                "cd /tmp",
                "openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -subj '/CN=localhost' -nodes -config /tmp/min-openssl-config.cnf",
                "cat cert.pem key.pem > server.pem"
            ]

            if self.machine.image.startswith("ubuntu") or self.machine.image.startswith("debian"):
                cmds += [
                    "cp /tmp/cert.pem /usr/local/share/ca-certificates/cert.crt",
                    "update-ca-certificates"
                ]
            else:
                cmds += [
                    "cp /tmp/cert.pem /etc/pki/ca-trust/source/anchors/cert.pem",
                    "update-ca-trust"
                ]
            self.machine.execute(" && ".join(cmds))

            # Run https server with range option support. QEMU uses range option
            # see: https://lists.gnu.org/archive/html/qemu-devel/2013-06/msg02661.html
            # or
            # https://github.com/qemu/qemu/blob/master/block/curl.c
            #
            # and on certain distribution supports only https (not http)
            # see: block-drv-ro-whitelist option in qemu-kvm.spec for certain distribution
            server = self.machine.spawn("cd /var/lib/libvirt && exec python3 /tmp/mock-range-server.py /tmp/server.pem", "httpsserver")
            self.addCleanup(self.machine.execute, "kill {0}".format(server))

            createTest(TestMachines.VmDialog(self, sourceType='url',
                                             location=config.ISO_URL,
                                             memory_size=256, memory_size_unit='MiB',
                                             storage_pool="No Storage",
                                             start_vm=True))

            # This functionality works on debian only because of extra dep.
            # Check error is returned if dependency is missing
            if self.machine.image.startswith("debian"):
                # remove package
                self.machine.execute("dpkg -P qemu-block-extra")
                checkDialogErrorTest(TestMachines.VmDialog(self, sourceType='url',
                                                           location=config.ISO_URL,
                                                           memory_size=256, memory_size_unit='MiB',
                                                           storage_pool="No Storage",
                                                           start_vm=True), ["qemu", "protocol"])

            # End of test detection of ISO file in URL

        # test PXE Source
        # check that the pxe booting is not available on session connection
        checkPXENotAvailableSessionTest(TestMachines.VmDialog(self, name='pxe-guest',
                                                              sourceType='pxe',
                                                              storage_pool="No Storage",
                                                              connection="session"))

        # test PXE Source
        self.machine.execute("virsh net-destroy default && virsh net-undefine default")

        # Set up the PXE server configuration files
        cmds = [
            "mkdir -p /var/lib/libvirt/pxe-config",
            "echo \"{0}\" > /var/lib/libvirt/pxe-config/pxe.cfg".format(PXE_SERVER_CFG),
            "chmod 666 /var/lib/libvirt/pxe-config/pxe.cfg"
        ]
        self.machine.execute(" && ".join(cmds))

        # Define and start a NAT network with tftp server configuration
        cmds = [
            "echo \"{0}\" > /tmp/pxe-nat.xml".format(NETWORK_XML_PXE),
            "virsh net-define /tmp/pxe-nat.xml",
            "virsh net-start pxe-nat"
        ]
        self.machine.execute(" && ".join(cmds))

        # Add an extra network interface that should appear in the PXE source dropdown
        iface = "eth42"
        self.add_veth(iface)

        # We don't handle events for networks yet, so reload the page to refresh the state
        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_in_text("body", "Virtual Machines")

        # First create the PXE VM but do not start it. We 'll need to tweak a bit the XML
        # to have serial console at bios and also redirect serial console to a file
        createTest(TestMachines.VmDialog(self, name='pxe-guest', sourceType='pxe',
                                         location="Virtual Network pxe-nat: NAT",
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_pool="No Storage",
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
        bios = ET.SubElement(root.find('os'), 'bios')
        bios.set('useserial', 'yes')

        # Add a serial console of type file
        console = ET.fromstring(self.machine.execute("virt-xml --build --console file,path=/tmp/serial.txt,target_type=serial"))
        devices = root.find('devices')
        devices.append(console)

        # Redefine the domain with the new XML
        xmlstr = ET.tostring(root, encoding='unicode', method='xml')

        self.machine.execute("echo \'{0}\' > /tmp/domain.xml && virsh define --file /tmp/domain.xml".format(xmlstr))

        self.machine.execute("virsh start pxe-guest")

        # The file is full of ANSI control characters in between every letter, filter them out
        wait(lambda: self.machine.execute(r"sed 's,\x1B\[[0-9;]*[a-zA-Z],,g' /tmp/serial.txt | grep 'Rebooting in 60'"), delay=3)

        self.machine.execute("virsh destroy pxe-guest && virsh undefine pxe-guest")

        # Check that host network devices are appearing in the options for PXE boot sources
        createTest(TestMachines.VmDialog(self, sourceType='pxe',
                                         location="Host Device {0}: macvtap".format(iface),
                                         memory_size=256, memory_size_unit='MiB',
                                         storage_pool="No Storage",
                                         start_vm=False))

        # When switching from PXE mode to anything else make sure that the source input is empty
        checkDialogFormValidationTest(TestMachines.VmDialog(self, storage_size=1,
                                                            sourceType='pxe',
                                                            location="Host Device {0}: macvtap".format(iface),
                                                            sourceTypeSecondChoice='url',
                                                            start_vm=False),
                                      {"Source": "Installation Source must not be empty"})

        # TODO: add use cases with start_vm=True and check that vm started
        # - for install when creating vm
        # - for create vm and then install
        # see https://github.com/cockpit-project/cockpit/issues/8385

        # console for try INSTALL
        self.allow_journal_messages('.*connection.*')
        self.allow_journal_messages('.*Connection.*')
        self.allow_journal_messages('.*session closed.*')

        self.allow_browser_errors("Failed when connecting: Connection closed")
        self.allow_browser_errors("Tried changing state of a disconnected RFB object")

        # Deleting a running guest will disconnect the serial console
        self.allow_browser_errors("Disconnection timed out.")

        # See https://bugzilla.redhat.com/show_bug.cgi?id=1406979, this is a WONTFIX:
        # It suggests configure auditd to dontaudit these messages since selinux can't
        # offer whitelisting this directory for qemu process
        self.allowed_messages.append('audit: type=1400 audit(.*): avc:  denied .*for .* comm="qemu-.* dev="proc" .*')

    def testDisabledCreate(self):
        self.login_and_go("/machines")
        self.browser.wait_in_text("body", "Virtual Machines")
        self.browser.wait_visible("#create-new-vm:not(:disabled)")

        virt_install_bin = self.machine.execute("which virt-install").strip()
        self.machine.execute('mount -o bind /dev/null {0}'.format(virt_install_bin))
        self.addCleanup(self.machine.execute, "umount {0}".format(virt_install_bin))

        self.browser.reload()
        self.browser.enter_page('/machines')
        self.browser.wait_visible("#create-new-vm:disabled")
        # There are many reasons why the button would be disabled, so check if it's correct one
        self.browser.wait_attr("#create-new-vm", "testdata", "disabledVirtInstall")

    class TestCreateConfig:
        VALID_URL = 'http://mirror.i3d.net/pub/centos/7/os/x86_64/'
        VALID_DISK_IMAGE_PATH = '/var/lib/libvirt/images/example.img'
        NOVELL_MOCKUP_ISO_PATH = '/var/lib/libvirt/novell.iso'
        NOT_EXISTENT_PATH = '/tmp/not-existent.iso'
        ISO_URL = 'https://localhost:8000/novell.iso'

        OPENBSD_6_3 = 'OpenBSD 6.3'

        MICROSOFT_SERVER_2016 = 'Microsoft Windows Server 2016'

        # LINUX can be filtered if 3 years old
        REDHAT_RHEL_4_7_FILTERED_OS = 'Red Hat Enterprise Linux 4.9'

        FEDORA_28 = 'Fedora 28'
        FEDORA_28_SHORTID = 'fedora28'

        CIRROS = 'CirrOS'

        MANDRIVA_2011_FILTERED_OS = 'Mandriva Linux 2011'

        MAGEIA_3_FILTERED_OS = 'Mageia 3'

    class VmDialog:
        vmId = 0

        def __init__(self, test_obj, name=None,
                     sourceType='file', sourceTypeSecondChoice=None, location='',
                     memory_size=256, memory_size_unit='MiB',
                     expected_memory_size=None,
                     storage_size=None, storage_size_unit='GiB',
                     expected_storage_size=None,
                     os_name='CirrOS',
                     os_short_id=None,
                     is_unattended=None,
                     profile=None,
                     root_password=None,
                     user_password=None,
                     storage_pool='Create New Volume', storage_volume='',
                     start_vm=False,
                     delete=True,
                     env_is_empty=True,
                     check_script_finished=True,
                     connection=None):

            TestMachines.VmDialog.vmId += 1 # This variable is static - don't use self here

            if name is None:
                self.name = 'subVmTestCreate' + str(TestMachines.VmDialog.vmId)
            else:
                self.name = name

            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue
            self.assertIn = test_obj.assertIn

            self.sourceType = sourceType
            self.sourceTypeSecondChoice = sourceTypeSecondChoice
            self.location = location
            self.memory_size = memory_size
            self.memory_size_unit = memory_size_unit
            self.expected_memory_size = expected_memory_size
            self.storage_size = storage_size
            self.storage_size_unit = storage_size_unit
            self.expected_storage_size = expected_storage_size
            self.os_name = os_name
            self.os_short_id = os_short_id
            self.is_unattended = is_unattended
            self.profile = profile
            self.root_password = root_password
            self.user_password = user_password
            self.start_vm = start_vm
            self.storage_pool = storage_pool
            self.storage_volume = storage_volume
            self.delete = delete
            self.env_is_empty = env_is_empty
            self.check_script_finished = check_script_finished
            self.connection = connection
            if self.connection:
                self.connectionText = connection.capitalize()

        def getMemoryText(self):
            return "{0} {1}".format(self.memory_size, self.memory_size_unit)

        def open(self):
            b = self.browser

            if self.sourceType == 'disk_image':
                b.click("#import-vm-disk")
            else:
                b.click("#create-new-vm")

            b.wait_present("#create-vm-dialog")
            if self.sourceType == 'disk_image':
                b.wait_in_text(".modal-dialog .modal-header .modal-title", "Import A Virtual Machine")
            else:
                b.wait_in_text(".modal-dialog .modal-header .modal-title", "Create New Virtual Machine")

            if self.os_name is not None:
                # check if there is os present in osinfo-query because it can be filtered out in the UI
                query_result = '{0}'.format(self.os_name)
                # throws exception if grep fails
                self.machine.execute(
                    "osinfo-query os --fields=name | tail -n +3 | sed -e 's/\s*|\s*/|/g; s/^\s*//g; s/\s*$//g' | grep '{0}'".format(
                        query_result))

            return self

        def checkOsFiltered(self):
            b = self.browser

            b.focus("label[for=os-select] + div > div > div > input")
            b.key_press(self.os_name)
            try:
                with b.wait_timeout(5):
                    b.wait_in_text("#os-select li a", "No matches found")
                return self
            except AssertionError:
                # os found which is not ok
                raise AssertionError("{0} was not filtered".format(self.os_name))

        def checkPXENotAvailableSession(self):
            self.browser.click("#connection label:contains('{0}')".format(self.connectionText))
            self.browser.wait_present("#source-type option[value*='{0}']:disabled".format(self.sourceType))
            return self

        def createAndVerifyVirtInstallArgs(self):
            self.browser.click(".modal-footer button:contains(Create)")
            self.browser.wait_not_present("#create-vm-dialog")

            virt_install_cmd = "ps aux | grep 'virt\-install\ \-\-connect'"
            wait(lambda: self.machine.execute(virt_install_cmd), delay=3)
            virt_install_cmd_out = self.machine.execute(virt_install_cmd)
            self.assertIn("--install os={}".format(self.os_short_id), virt_install_cmd_out)
            if self.is_unattended:
                self.assertIn("profile={0}".format('desktop' if self.profile == 'Workstation' else 'jeos'), virt_install_cmd_out)
                if self.root_password:
                    root_password_file = virt_install_cmd_out.split("admin-password-file=", 1)[1].split(",")[0]
                    self.assertIn(self.machine.execute("cat {0}".format(root_password_file)).rstrip(), self.root_password)
                if self.user_password:
                    user_password_file = virt_install_cmd_out.split("user-password-file=", 1)[1].split(",")[0]
                    self.assertIn(self.machine.execute("cat {0}".format(user_password_file)).rstrip(), self.user_password)

        def fill(self):
            def getSourceTypeLabel(sourceType):
                if sourceType == 'file':
                    expected_source_type = 'Local Install Media'
                elif sourceType == 'disk_image':
                    expected_source_type = 'Existing Disk Image'
                elif sourceType == 'pxe':
                    expected_source_type = 'Network Boot (PXE)'
                elif sourceType == 'downloadOS':
                    expected_source_type = 'Download an OS'
                else:
                    expected_source_type = 'URL'

                return expected_source_type

            b = self.browser
            b.set_input_text("#vm-name", self.name)

            if self.sourceType != 'disk_image':
                b.select_from_dropdown("#source-type", getSourceTypeLabel(self.sourceType))
            else:
                b.wait_not_present("#source-type")
            if self.sourceType == 'file':
                b.set_file_autocomplete_val("source-file", self.location)
            elif self.sourceType == 'disk_image':
                b.set_file_autocomplete_val("source-disk", self.location)
            elif self.sourceType == 'pxe':
                b.select_from_dropdown("#network-select", self.location)
            elif self.sourceType == 'url':
                b.set_input_text("#source-url", self.location)

            if self.sourceTypeSecondChoice:
                b.select_from_dropdown("#source-type", getSourceTypeLabel(self.sourceTypeSecondChoice))

            if self.os_name:
                b.focus("label:contains('Operating System') + div > div > div > input")
                b.key_press(self.os_name)
                b.key_press("\t")

            if self.sourceType != 'disk_image':
                if not self.expected_storage_size:
                    b.wait_visible("#storage-pool-select")
                    b.select_from_dropdown("#storage-pool-select", self.storage_pool)

                    if self.storage_pool == 'Create New Volume' or self.storage_pool == 'No Storage':
                        b.wait_not_present("#storage-volume-select")
                    else:
                        b.wait_visible("#storage-volume-select")
                        b.select_from_dropdown("#storage-volume-select", self.storage_volume)

                    if self.storage_pool != 'Create New Volume':
                        b.wait_not_present("#storage-size")
                    else:
                        b.select_from_dropdown("#storage-size-unit-select", self.storage_size_unit)
                        if self.storage_size:
                            b.set_input_text("#storage-size", str(self.storage_size), value_check=False)
                            b.blur("#storage-size")
                            # helpblock will be missing if available storage size could not be calculated (no default storage pool found)
                            # test images sometimes may not have default storage pool defined for session connection
                            if self.connection != "session":
                                space_available = int(b.text("#storage-size-slider ~ b"))
                                # Write the final storage size back to self so that other function can read it
                                self.storage_size = min(self.storage_size, space_available)
                                b.wait_val("#storage-size", self.storage_size)
                else:
                    b.wait_val("#storage-size", self.expected_storage_size)

            # First select the unit so that UI will auto-adjust the memory input
            # value according to the available total memory on the host
            if not self.expected_memory_size:
                b.select_from_dropdown("#memory-size-unit-select", self.memory_size_unit)
                b.set_input_text("#memory-size", str(self.memory_size), value_check=True)
                b.blur('#memory-size')
                host_total_memory = int(b.text("#memory-size-slider ~ b"))
                # Write the final memory back to self so that other function can read it
                self.memory_size = min(self.memory_size, host_total_memory)
                b.wait_val("#memory-size", self.memory_size)
            else:
                b.wait_val("#memory-size", self.expected_memory_size)

            # check minimum memory is correctly set in the slider - the following are fake data
            if self.os_name in [TestMachines.TestCreateConfig.CIRROS, TestMachines.TestCreateConfig.FEDORA_28]:
                b.wait_attr("#memory-size-slider  div[role=slider].hide", "aria-valuemin", "128")

            b.wait_visible("#start-vm")
            if not self.start_vm:
                b.click("#start-vm") # TODO: fix this, do not assume initial state of the checkbox
            # b.set_checked("#start-vm", self.start_vm)

            if (self.connection):
                b.click("#connection label:contains('{0}')".format(self.connectionText))

            if self.is_unattended:
                b.click("#unattended-installation")
                if self.profile:
                    b.select_from_dropdown("#profile-select", self.profile)
                if self.user_password:
                    b.set_input_text("#user-password", self.user_password)
                if self.root_password:
                    b.set_input_text("#root-password", self.root_password)

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
            if self.sourceType == 'disk_image':
                b.click(".modal-footer button:contains(Import)")
            else:
                b.click(".modal-footer button:contains(Create)")
            init_state = "creating VM installation" if self.start_vm else "creating VM"
            second_state = "running" if self.start_vm else "shut off"

            TestMachines.CreateVmRunner.assertVmStates(self, self.name, init_state, second_state)
            b.wait_not_present("#create-vm-dialog")
            return self

        def createAndExpectInlineValidationErrors(self, errors):
            b = self.browser

            if self.sourceType == 'disk_image':
                b.click(".modal-footer button:contains(Import)")
            else:
                b.click(".modal-footer button:contains(Create)")

            for error, error_msg in errors.items():
                error_location = ".modal-body label:contains('{0}') + div.form-group.has-error span.help-block".format(error)
                b.wait_visible(error_location)
                if (error_msg):
                    b.wait_in_text(error_location, error_msg)

            if self.sourceType == 'disk_image':
                b.wait_present(".modal-footer button:contains(Import):disabled")
            else:
                b.wait_present(".modal-footer button:contains(Create):disabled")

            return self

        def createAndExpectError(self, errors):
            b = self.browser

            def waitForError(errors, error_location):
                for retry in range(0, 60):
                    error_message = b.text(error_location)
                    if any(error in error_message for error in errors):
                        break
                    time.sleep(5)
                else:
                    raise Error("Retry limit exceeded: None of [%s] is part of the error message '%s'" % (
                        ', '.join(errors), b.text(error_location)))

            b.click(".modal-footer button:contains(Create)")

            error_location = ".modal-footer div.pf-c-alert"

            b.wait_present(".modal-footer .spinner")
            b.wait_not_present(".modal-footer .spinner")
            try:
                with b.wait_timeout(10):
                    b.wait_present(error_location)
                    b.wait_in_text("button.alert-link.more-button", "show more")
                    b.click("button.alert-link.more-button")
                    waitForError(errors, error_location)

                # dialog can complete if the error was not returned immediately
            except Error:
                if b.is_present("#create-vm-dialog"):
                    raise
                else:
                    # then error should be shown in the notification area
                    error_location = ".toast-notifications-list-pf div.pf-c-alert"
                    with b.wait_timeout(20):
                        b.wait_present(error_location)
                        b.wait_in_text("button.alert-link.more-button", "show more")
                        b.click("button.alert-link.more-button")
                        waitForError(errors, error_location)

            # Close the notificaton
            b.click(".toast-notifications-list-pf div.pf-c-alert button.pf-c-button")
            b.wait_not_present(".toast-notifications-list-pf div.pf-c-alert")

            return self

    class CreateVmRunner:

        def __init__(self, test_obj):
            self.browser = test_obj.browser
            self.machine = test_obj.machine
            self.assertTrue = test_obj.assertTrue

            self.machine.execute("touch {0}".format(TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH))
            self.machine.execute("qemu-img create {0} 500M".format(TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))
            test_obj.addCleanup(test_obj.machine.execute, "rm -f {0} {1}".format(
                TestMachines.TestCreateConfig.NOVELL_MOCKUP_ISO_PATH,
                TestMachines.TestCreateConfig.VALID_DISK_IMAGE_PATH))

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
                b.wait_present("#vm-{0}-memory-count".format(name))
                b.wait_present("#vm-{0}-vcpus-count".format(name))

            self.assertCorrectConfiguration(dialog)

            return self

        def tryCreateThenInstall(self, dialog):
            b = self.browser
            dialog.start_vm = False
            name = dialog.name

            dialog.open() \
                .fill() \
                .create()

            b.wait_in_text("#vm-{0}-row".format(name), name)
            b.click("#vm-{0}-install".format(name))
            b.wait_present("li.active #vm-{0}-consoles".format(name))

            self.assertCorrectConfiguration(dialog)

            # unfinished install script runs indefinitelly, so we need to force it off
            b.click("#vm-{0}-off-caret".format(name))
            b.click("#vm-{0}-forceOff".format(name))
            b.wait_in_text("#vm-{0}-state".format(name), "shut off")

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

            b.wait_in_text("div.pf-c-alert.pf-m-danger strong", "VM {0} failed to get installed".format(name))
            b.wait_in_text("button.alert-link.more-button", "show more")

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
                self.machine.execute("pgrep -fc {0}".format(command))
                return False
            except subprocess.CalledProcessError as e:
                return hasattr(e, 'returncode') and e.returncode == 1

        def assertCorrectConfiguration(self, dialog):
            b = self.browser
            name = dialog.name

            # check memory
            b.click("#vm-{0}-usage".format(name))
            b.wait_in_text("tbody.open .listing-ct-body td:nth-child(1) .usage-donut-caption", dialog.getMemoryText())

            # check disks
            b.click("#vm-{0}-disks".format(name)) # open the "Disks" subtab

            # Test disk got imported/created
            if dialog.sourceType == 'disk_image':
                if b.is_present("#vm-{0}-disks-vda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-vda-source-file".format(name), dialog.location)
                elif b.is_present("#vm-{0}-disks-hda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-hda-source-file".format(name), dialog.location)
                else:
                    raise AssertionError("Unknown disk device")
            # New volume was created or existing volume was already chosen as destination
            elif (dialog.storage_size is not None and dialog.storage_size > 0) or dialog.storage_pool not in ["No Storage", "Create New Volume"]:
                if b.is_present("#vm-{0}-disks-vda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-vda-device".format(name), "disk")
                elif b.is_present("#vm-{0}-disks-hda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-hda-device".format(name), "disk")
                elif b.is_present("#vm-{0}-disks-sda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-sda-device".format(name), "disk")
                else:
                    raise AssertionError("Unknown disk device")
            elif dialog.start_vm and (((dialog.storage_pool == 'No Storage' or dialog.storage_size == 0) and dialog.sourceType == 'file') or dialog.sourceType == 'url'):
                if b.is_present("#vm-{0}-disks-sda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-sda-device".format(name), "cdrom")
                elif b.is_present("#vm-{0}-disks-hda-device".format(name)):
                    b.wait_in_text("#vm-{0}-disks-hda-device".format(name), "cdrom")
                else:
                    raise AssertionError("Unknown disk device")
            else:
                b.wait_in_text("div.listing-ct-body", "No disks defined")
                b.click("#vm-{0}-disks-adddisk".format(name))
                b.click("#vm-{0}-disks-adddisk-dialog-cancel".format(name))
            return self

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
            self.machine.execute("until test -z $(virsh list --all --name); do sleep 1; done")
            self.machine.execute("until test -z $(ls /home/admin/.local/share/libvirt/images/ 2>/dev/null); do sleep 1; done")

            if b.is_present(".toast-notifications-list-pf div.pf-c-alert .pf-c-button"):
                b.click(".toast-notifications-list-pf div.pf-c-alert .pf-c-button")

            b.wait_not_present(".toast-notifications-list-pf div.pf-c-alert")

            return self


if __name__ == '__main__':
    test_main()
