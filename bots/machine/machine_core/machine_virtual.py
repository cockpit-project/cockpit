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

import contextlib
import errno
import fcntl
import libvirt
import libvirt_qemu
import os
import string
import socket
import subprocess
import tempfile
import sys
import time

from .exceptions import Failure, RepeatableFailure
from .machine import Machine
from .constants import TEST_DIR, BOTS_DIR
from .directories import get_temp_dir

MEMORY_MB = 1024


# The Atomic variants can't build their own packages, so we build in
# their non-Atomic siblings.  For example, fedora-atomic is built
# in fedora-29
def get_build_image(image):
    (test_os, unused) = os.path.splitext(os.path.basename(image))
    if test_os == "fedora-atomic":
        image = "fedora-29"
    elif test_os == "rhel-atomic":
        image = "rhel-7-6"
    elif test_os == "continuous-atomic":
        image = "centos-7"
    return image


# some tests have suffixes that run the same image in different modes; map a
# test context image to an actual physical image name
def get_test_image(image):
    return image.replace("-distropkg", "")


# based on http://stackoverflow.com/a/17753573
# we use this to quieten down calls
@contextlib.contextmanager
def stdchannel_redirected(stdchannel, dest_filename):
    """
    A context manager to temporarily redirect stdout or stderr
    e.g.:
    with stdchannel_redirected(sys.stderr, os.devnull):
        noisy_function()
    """
    try:
        stdchannel.flush()
        oldstdchannel = os.dup(stdchannel.fileno())
        dest_file = open(dest_filename, 'w')
        os.dup2(dest_file.fileno(), stdchannel.fileno())
        yield
    finally:
        if oldstdchannel is not None:
            os.dup2(oldstdchannel, stdchannel.fileno())
        if dest_file is not None:
            dest_file.close()


TEST_CONSOLE_XML="""
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
"""

TEST_GRAPHICS_XML="""
    <video>
      <model type='qxl' ram='65536' vram='65536' vgamem='16384' heads='1' primary='yes'/>
      <alias name='video0'/>
      <address type='pci' domain='0x0000' bus='0x00' slot='0x02' function='0x0'/>
    </video>
    <graphics type='vnc' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
"""

TEST_DOMAIN_XML="""
<domain type='{type}' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>{label}</name>
  {cpu}
  <os>
    <type arch='{arch}'>hvm</type>
    <boot dev='hd'/>
    {loader}
  </os>
  <memory unit='MiB'>{memory_in_mib}</memory>
  <currentMemory unit='MiB'>{memory_in_mib}</currentMemory>
  <features>
    <acpi/>
  </features>
  <devices>
    <disk type='file' snapshot='external'>
      <driver name='qemu' type='qcow2'/>
      <source file='{drive}'/>
      <target dev='vda' bus='{disk}'/>
      <serial>ROOT</serial>
    </disk>
    <controller type='scsi' model='virtio-scsi' index='0' id='hot'/>
    {console}
    <disk type='file' device='cdrom'>
      <source file='{iso}'/>
      <target dev='hdb' bus='ide'/>
      <readonly/>
    </disk>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
    {bridgedev}
  </devices>
  <qemu:commandline>
    {ethernet}
    {redir}
  </qemu:commandline>
</domain>
"""

TEST_DISK_XML="""
<disk type='file'>
  <driver name='qemu' type='%(type)s'/>
  <source file='%(file)s'/>
  <serial>%(serial)s</serial>
  <address type='drive' controller='0' bus='0' target='2' unit='%(unit)d'/>
  <target dev='%(dev)s' bus='scsi'/>
</disk>
"""

TEST_KVM_XML="""
  <cpu mode='host-passthrough'/>
  <vcpu>{cpus}</vcpu>
"""

# The main network interface which we use to communicate between VMs
TEST_MCAST_XML="""
    <qemu:arg value='-netdev'/>
    <qemu:arg value='socket,mcast=230.0.0.1:{mcast},id=mcast0'/>
    <qemu:arg value='-device'/>
    <qemu:arg value='rtl8139,netdev=mcast0,mac={mac},bus=pci.0,addr=0x0f'/>
"""

TEST_BRIDGE_XML="""
    <interface type="bridge">
      <source bridge="{bridge}"/>
      <mac address="{mac}"/>
      <model type="rtl8139"/>
    </interface>
"""

# Used to access SSH from the main host into the virtual machines
TEST_REDIR_XML="""
    <qemu:arg value='-netdev'/>
    <qemu:arg value='user,id=base0,restrict={restrict},net=172.27.0.0/24,hostname={name},{forwards}'/>
    <qemu:arg value='-device'/>
    <qemu:arg value='rtl8139,netdev=base0,bus=pci.0,addr=0x0e'/>
"""

class VirtNetwork:
    def __init__(self, network=None, bridge=None):
        self.locked = [ ]
        self.bridge = bridge

        if network is None:
            offset = 0
            force = False
        else:
            offset = network * 100
            force = True

        # This is a shared port used as the identifier for the socket mcast network
        self.network = self._lock(5500 + offset, step=100, force=force)

        # An offset for other ports allocated later
        self.offset = (self.network - 5500)

        # The last machine we allocated
        self.last = 0

        # Unique hostnet identifiers
        self.hostnet = 8

    def _lock(self, start, step=1, force=False):
        resources = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources")
        try:
            os.mkdir(resources, 0o755)
        except FileExistsError:
            pass
        for port in range(start, start + (100 * step), step):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            lockpath = os.path.join(resources, "network-{0}".format(port))
            try:
                lockf = os.open(lockpath, os.O_WRONLY | os.O_CREAT)
                fcntl.flock(lockf, fcntl.LOCK_NB | fcntl.LOCK_EX)
                sock.bind(("127.0.0.1", port))
                self.locked.append(lockf)
            except IOError:
                if force:
                    return port
                os.close(lockf)
                continue
            else:
                return port
            finally:
                sock.close()
        raise Failure("Couldn't find unique network port number")

    # Create resources for an interface, returns address and XML
    def interface(self, number=None):
        if number is None:
            number = self.last + 1
        if number > self.last:
            self.last = number
        mac = self._lock(10000 + self.offset + number) - (10000 + self.offset)
        hostnet = self.hostnet
        self.hostnet += 1
        result = {
            "number": self.offset + number,
            "mac": '52:54:01:{:02x}:{:02x}:{:02x}'.format((mac >> 16) & 0xff, (mac >> 8) & 0xff, mac & 0xff),
            "name": "m{0}.cockpit.lan".format(mac),
            "mcast": self.network,
            "hostnet": "hostnet{0}".format(hostnet)
        }
        return result

    # Create resources for a host, returns address and XML
    def host(self, number=None, restrict=False, isolate=False, forward={ }):
        result = self.interface(number)
        result["mcast"] = self.network
        result["restrict"] = restrict and "on" or "off"
        result["forward"] = { "22": 2200, "9090": 9090 }
        result["forward"].update(forward)
        forwards = []
        for remote, local in result["forward"].items():
            local = self._lock(int(local) + result["number"])
            result["forward"][remote] = "127.0.0.2:{}".format(local)
            forwards.append("hostfwd=tcp:{}-:{}".format(result["forward"][remote], remote))
            if remote == "22":
                result["control"] = result["forward"][remote]
            elif remote == "9090":
                result["browser"] = result["forward"][remote]

        if isolate:
            result["bridge"] = ""
            result["bridgedev"] = ""
            result["ethernet"] = ""
        elif self.bridge:
            result["bridge"] = self.bridge
            result["bridgedev"] = TEST_BRIDGE_XML.format(**result)
            result["ethernet"] = ""
        else:
            result["bridge"] = ""
            result["bridgedev"] = ""
            result["ethernet"] = TEST_MCAST_XML.format(**result)
        result["forwards"] = ",".join(forwards)
        result["redir"] = TEST_REDIR_XML.format(**result)
        return result

    def kill(self):
        locked = self.locked
        self.locked = [ ]
        for x in locked:
            os.close(x)

class VirtMachine(Machine):
    network = None
    memory_mb = None
    cpus = None

    def __init__(self, image, networking=None, maintain=False, memory_mb=None, cpus=None, graphics=False, **args):
        self.maintain = maintain

        # Currently all images are run on x86_64. When that changes we will have
        # an override file for those images that are not
        self.arch = "x86_64"

        self.memory_mb = memory_mb or VirtMachine.memory_mb or MEMORY_MB
        self.cpus = cpus or VirtMachine.cpus or 1
        self.graphics = graphics or "windows" in image

        # Set up some temporary networking info if necessary
        if networking is None:
            networking = VirtNetwork().host()

        # Allocate network information about this machine
        self.networking = networking
        args["address"] = networking["control"]
        args["browser"] = networking["browser"]
        self.forward = networking["forward"]

        # The path to the image file to load, and parse an image name
        if "/" in image:
            self.image_file = image = os.path.abspath(image)
        else:
            self.image_file = os.path.join(TEST_DIR, "images", image)
            if not os.path.lexists(self.image_file):
                self.image_file = os.path.join(BOTS_DIR, "images", image)
        (image, extension) = os.path.splitext(os.path.basename(image))

        Machine.__init__(self, image=image, **args)

        base_dir = os.path.dirname(BOTS_DIR)
        self.run_dir = os.path.join(get_temp_dir(), "run")

        self.virt_connection = self._libvirt_connection(hypervisor = "qemu:///session")

        self._disks = [ ]
        self._domain = None

        # init variables needed for running a vm
        self._cleanup()

    def _libvirt_connection(self, hypervisor, read_only = False):
        tries_left = 5
        connection = None
        if read_only:
            open_function = libvirt.openReadOnly
        else:
            open_function = libvirt.open
        while not connection and (tries_left > 0):
            try:
                connection = open_function(hypervisor)
            except:
                # wait a bit
                time.sleep(1)
                pass
            tries_left -= 1
        if not connection:
            # try again, but if an error occurs, don't catch it
            connection = open_function(hypervisor)
        return connection

    def _start_qemu(self):
        self._cleanup()

        try:
            os.makedirs(self.run_dir, 0o750)
        except OSError as ex:
            if ex.errno != errno.EEXIST:
                raise

        def execute(*args):
            self.message(*args)
            return subprocess.check_call(args)

        image_to_use = self.image_file
        if not self.maintain:
            (unused, self._transient_image) = tempfile.mkstemp(suffix='.qcow2', prefix="", dir=self.run_dir)
            execute("qemu-img", "create", "-q", "-f", "qcow2",
                    "-o", "backing_file=%s" % self.image_file, self._transient_image)
            image_to_use = self._transient_image

        keys = {
            "label": self.label,
            "image": self.image,
            "type": "qemu",
            "arch": self.arch,
            "cpu": "",
            "cpus": self.cpus,
            "memory_in_mib": self.memory_mb,
            "drive": image_to_use,
            "iso": os.path.join(BOTS_DIR, "machine", "cloud-init.iso"),
        }

        if os.path.exists("/dev/kvm"):
            keys["type"] = "kvm"
            keys["cpu"] = TEST_KVM_XML.format(**keys)
        else:
            sys.stderr.write("WARNING: Starting virtual machine with emulation due to missing KVM\n")
            sys.stderr.write("WARNING: Machine will run about 10-20 times slower\n")

        keys.update(self.networking)
        keys["name"] = "{image}-{control}".format(**keys)

        # No need or use for redir network on windows
        if "windows" in self.image:
            keys["disk"] = "ide"
            keys["redir"] = ""
        else:
            keys["disk"] = "virtio"
        if self.graphics:
            keys["console"] = TEST_GRAPHICS_XML.format(**keys)
        else:
            keys["console"] = TEST_CONSOLE_XML.format(**keys)
        if "windows-10" in self.image:
            keys["loader"] = "<loader readonly='yes' type='pflash'>/usr/share/edk2/ovmf/OVMF_CODE.fd</loader>"
        else:
            keys["loader"] = ""
        test_domain_desc = TEST_DOMAIN_XML.format(**keys)

        # add the virtual machine
        try:
            # print >> sys.stderr, test_domain_desc
            self._domain = self.virt_connection.createXML(test_domain_desc, libvirt.VIR_DOMAIN_START_AUTODESTROY)
        except libvirt.libvirtError as le:
            if 'already exists with uuid' in str(le):
                raise RepeatableFailure("libvirt domain already exists: " + str(le))
            else:
                raise

    # start virsh console
    def qemu_console(self, extra_message=""):
        self.message("Started machine {0}".format(self.label))
        if self.maintain:
            message = "\nWARNING: Uncontrolled shutdown can lead to a corrupted image\n"
        else:
            message = "\nWARNING: All changes are discarded, the image file won't be changed\n"
        message += self.diagnose() + extra_message + "\nlogin: "
        message = message.replace("\n", "\r\n")

        try:
            proc = subprocess.Popen("virsh -c qemu:///session console %s" % str(self._domain.ID()), shell=True)

            # Fill in information into /etc/issue about login access
            pid = 0
            while pid == 0:
                if message:
                    try:
                        with stdchannel_redirected(sys.stderr, os.devnull):
                            Machine.wait_boot(self)
                        sys.stderr.write(message)
                    except (Failure, subprocess.CalledProcessError):
                        pass
                    message = None
                (pid, ret) = os.waitpid(proc.pid, message and os.WNOHANG or 0)

            try:
                if self.maintain:
                    self.shutdown()
                else:
                    self.kill()
            except libvirt.libvirtError as le:
                # the domain may have already been freed (shutdown) while the console was running
                self.message("libvirt error during shutdown: %s" % (le.get_error_message()))

        except OSError as ex:
            raise Failure("Failed to launch virsh command: {0}".format(ex.strerror))
        finally:
            self._cleanup()

    def graphics_console(self):
        self.message("Started machine {0}".format(self.label))
        if self.maintain:
            message = "\nWARNING: Uncontrolled shutdown can lead to a corrupted image\n"
        else:
            message = "\nWARNING: All changes are discarded, the image file won't be changed\n"
        if "bridge" in self.networking:
            message += "\nIn the machine a web browser can access Cockpit on parent host:\n\n"
            message += "    https://10.111.112.1:9090\n"
        message = message.replace("\n", "\r\n")

        try:
            proc = subprocess.Popen(["virt-viewer", str(self._domain.ID())])
            sys.stderr.write(message)
            proc.wait()
        except OSError as ex:
            raise Failure("Failed to launch virt-viewer command: {0}".format(ex.strerror))
        finally:
            self._cleanup()

    def pull(self, image):
        if "/" in image:
            image_file = os.path.abspath(image)
        else:
            image_file = os.path.join(BOTS_DIR, "images", image)
        if not os.path.exists(image_file):
            try:
                subprocess.check_call([ os.path.join(BOTS_DIR, "image-download"), image_file ])
            except OSError as ex:
                if ex.errno != errno.ENOENT:
                    raise
        return image_file

    def start(self):
        tries = 0
        while True:
            try:
                self._start_qemu()
                if not self._domain.isActive():
                    self._domain.start()
            except RepeatableFailure:
                self.kill()
                if tries < 10:
                    tries += 1
                    time.sleep(tries)
                    continue
                else:
                    raise
            except:
                self.kill()
                raise

            # Normally only one pass
            break

    def _diagnose_no_address(self):
        SCRIPT = """
            spawn virsh -c qemu:///session console $argv
            set timeout 300
            expect "Escape character"
            send "\r"
            expect " login: "
            send "root\r"
            expect "Password: "
            send "foobar\r"
            expect " ~]# "
            send "ip addr\r\n"
            expect " ~]# "
            exit 0
        """
        expect = subprocess.Popen(["expect", "--", "-", str(self._domain.ID())], stdin=subprocess.PIPE,
                                  universal_newlines=True)
        expect.communicate(SCRIPT)

    def wait_boot(self, timeout_sec=120):
        """Wait for a machine to boot"""
        try:
            Machine.wait_boot(self, timeout_sec)
        except Failure:
            self._diagnose_no_address()
            raise

    def stop(self, timeout_sec=120):
        if self.maintain:
            self.shutdown(timeout_sec=timeout_sec)
        else:
            self.kill()

    def _cleanup(self, quick=False):
        self.disconnect()
        try:
            for disk in self._disks:
                self.rem_disk(disk, quick)

            self._domain = None
            if hasattr(self, '_transient_image') and self._transient_image and os.path.exists(self._transient_image):
                os.unlink(self._transient_image)
        except:
            (type, value, traceback) = sys.exc_info()
            sys.stderr.write("WARNING: Cleanup failed:%s\n" % value)

    def kill(self):
        # stop system immediately, with potential data loss
        # to shutdown gracefully, use shutdown()
        try:
            self.disconnect()
        except Exception:
            pass
        if self._domain:
            try:
                # not graceful
                with stdchannel_redirected(sys.stderr, os.devnull):
                    self._domain.destroyFlags(libvirt.VIR_DOMAIN_DESTROY_DEFAULT)
            except:
                pass
        self._cleanup(quick=True)

    def wait_poweroff(self, timeout_sec=120):
        # shutdown must have already been triggered
        if self._domain:
            start_time = time.time()
            while (time.time() - start_time) < timeout_sec:
                try:
                    with stdchannel_redirected(sys.stderr, os.devnull):
                        if not self._domain.isActive():
                            break
                except libvirt.libvirtError as le:
                    if 'no domain' in str(le) or 'not found' in str(le):
                        break
                    raise
                time.sleep(1)
            else:
                raise Failure("Waiting for machine poweroff timed out")
            try:
                with stdchannel_redirected(sys.stderr, os.devnull):
                    self._domain.destroyFlags(libvirt.VIR_DOMAIN_DESTROY_DEFAULT)
            except libvirt.libvirtError as le:
                if 'not found' not in str(le):
                    raise
        self._cleanup(quick=True)

    def shutdown(self, timeout_sec=120):
        # shutdown the system gracefully
        # to stop it immediately, use kill()
        self.disconnect()
        try:
            if self._domain:
                self._domain.shutdown()
            self.wait_poweroff(timeout_sec=timeout_sec)
        finally:
            self._cleanup()

    def add_disk(self, size=None, serial=None, path=None, type='raw'):
        index = len(self._disks)

        try:
            os.makedirs(self.run_dir, 0o750)
        except OSError as ex:
            if ex.errno != errno.EEXIST:
                raise

        if path:
            (unused, image) = tempfile.mkstemp(suffix='.qcow2', prefix=os.path.basename(path), dir=self.run_dir)
            subprocess.check_call([ "qemu-img", "create", "-q", "-f", "qcow2",
                                    "-o", "backing_file=" + os.path.realpath(path), image ])

        else:
            assert size is not None
            name = "disk-{0}".format(self._domain.name())
            (unused, image) = tempfile.mkstemp(suffix='qcow2', prefix=name, dir=self.run_dir)
            subprocess.check_call(["qemu-img", "create", "-q", "-f", "raw", image, str(size)])

        if not serial:
            serial = "DISK{0}".format(index)
        dev = 'sd' + string.ascii_lowercase[index]
        disk_desc = TEST_DISK_XML % {
            'file': image,
            'serial': serial,
            'unit': index,
            'dev': dev,
            'type': type,
        }

        if self._domain.attachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE) != 0:
            raise Failure("Unable to add disk to vm")

        disk = {
            "path": image,
            "serial": serial,
            "filename": image,
            "dev": dev,
            "index": index,
            "type": type,
        }

        self._disks.append(disk)
        return disk

    def rem_disk(self, disk, quick=False):
        if not quick:
            disk_desc = TEST_DISK_XML % {
                'file': disk["filename"],
                'serial': disk["serial"],
                'unit': disk["index"],
                'dev': disk["dev"],
                'type': disk["type"]
            }

            if self._domain:
                if self._domain.detachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE ) != 0:
                    raise Failure("Unable to remove disk from vm")

    def _qemu_monitor(self, command):
        self.message("& " + command)
        # you can run commands manually using virsh:
        # virsh -c qemu:///session qemu-monitor-command [domain name/id] --hmp [command]
        output = libvirt_qemu.qemuMonitorCommand(self._domain, command, libvirt_qemu.VIR_DOMAIN_QEMU_MONITOR_COMMAND_HMP)
        self.message(output.strip())
        return output

    def add_netiface(self, networking=None):
        if not networking:
            networking = VirtNetwork().interface()
        self._qemu_monitor("netdev_add socket,mcast=230.0.0.1:{mcast},id={id}".format(mcast=networking["mcast"], id=networking["hostnet"]))
        cmd = "device_add virtio-net-pci,mac={0},netdev={1}".format(networking["mac"], networking["hostnet"])
        self._qemu_monitor("device_add virtio-net-pci,mac={0},netdev={1}".format(networking["mac"], networking["hostnet"]))
        return networking["mac"]

    def needs_writable_usr(self):
        # On atomic systems, we need a hack to change files in /usr/lib/systemd
        if self.atomic_image:
            self.execute(command="mount -o remount,rw /usr")
