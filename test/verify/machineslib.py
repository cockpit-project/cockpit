# This file is part of Cockpit.
#
# Copyright (C) 2021 Red Hat, Inc.
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

from testlib import *
from netlib import NetworkHelpers
from storagelib import StorageHelpers
from machinesxmls import *


class VirtualMachinesCaseHelpers:
    created_pool = False

    def goToVmPage(self, vmName, connectionName='system'):
        self.browser.click("tbody tr[data-row-id=vm-{0}-{1}] a.vm-list-item-name".format(vmName, connectionName)) # click on the row

    def goToMainPage(self):
        self.browser.click(".machines-listing-breadcrumb li:first-of-type a")

    def waitVmRow(self, vmName, connectionName='system', present=True):
        b = self.browser
        vm_row = "tbody tr[data-row-id=vm-{0}-{1}]".format(vmName, connectionName)
        if present:
            b.wait_visible(vm_row)
        else:
            b.wait_not_present(vm_row)

    def togglePoolRow(self, poolName, connectionName="system"):
        isExpanded = 'pf-m-expanded' in self.browser.attr("tbody tr[data-row-id=pool-{0}-{1}] + tr".format(poolName, connectionName), "class") # click on the row header
        self.browser.click("tbody tr[data-row-id=pool-{0}-{1}] .pf-c-table__toggle button".format(poolName, connectionName)) # click on the row header
        if isExpanded:
            self.browser.wait_not_present("tbody tr[data-row-id=pool-{0}-{1}] + tr.pf-m-expanded".format(poolName, connectionName)) # click on the row header
        else:
            self.browser.wait_visible("tbody tr[data-row-id=pool-{0}-{1}] + tr.pf-m-expanded".format(poolName, connectionName)) # click on the row header

    def waitPoolRow(self, poolName, connectionName="system", present="true"):
        b = self.browser
        pool_row = "tbody tr[data-row-id=pool-{0}-{1}]".format(poolName, connectionName)
        if present:
            b.wait_visible(pool_row)
        else:
            b.wait_not_present(pool_row)

    def toggleNetworkRow(self, networkName, connectionName="system"):
        isExpanded = 'pf-m-expanded' in self.browser.attr("tbody tr[data-row-id=network-{0}-{1}] + tr".format(networkName, connectionName), "class") # click on the row header
        self.browser.click("tbody tr[data-row-id=network-{0}-{1}] .pf-c-table__toggle button".format(networkName, connectionName)) # click on the row header
        if isExpanded:
            self.browser.wait_not_present("tbody tr[data-row-id=network-{0}-{1}] + tr.pf-m-expanded".format(networkName, connectionName)) # click on the row header
        else:
            self.browser.wait_visible("tbody tr[data-row-id=network-{0}-{1}] + tr.pf-m-expanded".format(networkName, connectionName)) # click on the row header

    def waitNetworkRow(self, networkName, connectionName="system", present="true"):
        b = self.browser
        network_row = "tbody tr[data-row-id=network-{0}-{1}]".format(networkName, connectionName)
        if present:
            b.wait_visible(network_row)
        else:
            b.wait_not_present(network_row)

    def startLibvirt(self):
        m = self.machine

        # Ensure everything has started correctly
        m.execute("systemctl start libvirtd.service")

        # Wait until we can get a list of domains
        m.execute("until virsh list; do sleep 1; done")

        # Wait for the network 'default' to become active
        m.execute("virsh net-define /etc/libvirt/qemu/networks/default.xml || true")
        m.execute("virsh net-start default || true")
        m.execute("until virsh net-info default | grep 'Active:\s*yes'; do sleep 1; done")

    def createVm(self, name, graphics='spice', ptyconsole=False, running=True):
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
        m.execute("echo \"{0}\" > /tmp/xml && virsh define /tmp/xml{1}".format(xml,
                                                                               " && virsh start {}".format(name) if running else ""))

        m.execute('[ "$(virsh domstate {0})" = {1} ] || {{ virsh dominfo {0} >&2; cat /var/log/libvirt/qemu/{0}.log >&2; exit 1; }}'.format(name,
                                                                                                                                            "running" if running else "\"shut off\""))

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

        self.addCleanup(m.execute, "targetcli /backstores/ramdisk delete test && targetcli /iscsi delete %s && (iscsiadm -m node -o delete || true)" % target_iqn)
        return orig_iqn


class VirtualMachinesCase(MachineCase, VirtualMachinesCaseHelpers, StorageHelpers, NetworkHelpers):

    def setUp(self):
        super().setUp()

        m = self.machine

        # Keep pristine state of libvirt
        self.restore_dir("/var/lib/libvirt")
        self.restore_dir("/etc/libvirt")

        if m.image in ["ubuntu-2004", "ubuntu-stable"]:
            # https://bugs.launchpad.net/ubuntu/+source/libvirt-dbus/+bug/1892757
            m.execute("usermod -a -G libvirt libvirtdbus")

        self.startLibvirt()
        self.addCleanup(m.execute, "systemctl stop libvirtd")

        # Stop all domains
        self.addCleanup(m.execute, "for d in $(virsh list --name); do virsh destroy $d || true; done")

        # Cleanup pools
        self.addCleanup(m.execute, "rm -rf /run/libvirt/storage/*")

        # Stop all pools
        self.addCleanup(m.execute, "for n in $(virsh pool-list --all --name); do virsh pool-destroy $n || true; done")

        # Cleanup networks
        self.addCleanup(m.execute, "rm -rf /run/libvirt/network/test_network*")

        # Stop all networks
        self.addCleanup(m.execute, "for n in $(virsh net-list --all --name); do virsh net-destroy $n || true; done")

        # we don't have configuration to open the firewall for local libvirt machines, so just stop firewalld
        m.execute("systemctl stop firewalld; systemctl try-restart libvirtd")

        # FIXME: report downstream; AppArmor noisily denies some operations, but they are not required for us
        self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="capable" profile="\S*libvirtd.* capname="sys_rawio".*')
        # AppArmor doesn't like the non-standard path for our storage pools
        self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="virt-aa-helper" name="%s.*' % self.vm_tmpdir)
        if m.image in ["ubuntu-2004", "ubuntu-stable"]:
            self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="libvirt.* name="/" .* denied_mask="r" .*')
            self.allow_journal_messages('.* type=1400 .* apparmor="DENIED" operation="open" profile="libvirt.* name="/sys/bus/nd/devices/" .* denied_mask="r" .*')

        # FIXME: testDomainMemorySettings on Fedora-32 reports this. Figure out where it comes from.
        # Ignoring just to unbreak tests for now
        self.allow_journal_messages("Failed to get COMM: No such process")

        m.execute("virsh net-define /etc/libvirt/qemu/networks/default.xml || true")

        # avoid error noise about resources getting cleaned up
        self.addCleanup(self.browser.logout)
