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

import fcntl
import os
import re
import select
import socket
import subprocess
import tempfile
import time
import sys

DEFAULT_OS = "fedora-18"
DEFAULT_ARCH = "x86_64"

MEMORY_MB = 1024

class Failure(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class Machine:
    boot_hook = None

    def __init__(self, address=None, system=None, arch=None, verbose=False):
        self.verbose = verbose
        self.os = system or os.environ.get("TEST_OS") or DEFAULT_OS
        self.arch = arch or os.environ.get("TEST_ARCH") or DEFAULT_ARCH
        self.image = os.environ.get("TEST_IMAGE") or "%s-%s" % (self.os, self.arch)
        self.test_dir = os.path.abspath(os.path.dirname(__file__))
        self.address = address
        self.mac = None

    def message(self, *args):
        """Prints args if in verbose mode"""
        if not self.verbose:
            return
        print " ".join(args)

    def start(self, maintain=False, macaddr=None):
        """Overridden by machine classes to start the machine"""
        self.message("Assuming machine is already running")

    def stop(self):
        """Overridden by machine classes to stop the machine"""
        self.message("Not shutting down already running machine")

    def wait_boot(self):
        """Wait for a machine to boot and execute hooks

        This is usually overridden by derived classes.
        """
        if self.boot_hook:
            environ = os.environ.copy()
            environ["TEST_MACHINE"] = self.address
            subprocess.check_call([ "/bin/sh", "-c", arg_vm_start_hook ], env=environ)

    def wait_poweroff(self):
        """Overridden by machine classes to wait for a machine to stop"""
        assert False, "Cannot wait for a machine we didn't start"

    def kill(self):
        """Overridden by machine classes to unconditionally kill the running machine"""
        assert False, "Cannot kill a machine we didn't start"

    def shutdown(self):
        """Overridden by machine classes to gracefully shutdown the running machine"""
        assert False, "Cannot shutdown a machine we didn't start"

    def build(self, deps):
        """Build a machine image for running tests.

        This is usually overridden by derived classes. This should be
        called before running a machine.
        """
        pass

    def run_prepare_script(self, deps):
        """Prepare a test image further by running some commands in it."""
        self.start(maintain=True)
        try:
            self.wait_boot()
            env = {
                "TEST_OS": self.os,
                "TEST_ARCH": self.arch,
                "TEST_PACKAGES": " ".join(deps),
            }
            self.execute(script=PREPARE_SCRIPT, environment=env)
        finally:
            self.stop()

    def install(self, rpms):
        """Install rpms in the pre-built test image"""
        for rpm in rpms:
            if not os.path.exists(rpm):
                raise Failure("file does not exist: %s" % rpm)

        self.start(maintain=True)
        try:
            self.wait_boot()
            uploaded = []
            for rpm in rpms:
                base = os.path.basename(rpm)
                dest = os.path.join("/tmp", base)
                self.upload(rpm, dest)
                uploaded.append(dest)
            env = {
                "TEST_OS": self.os,
                "TEST_ARCH": self.arch,
                "TEST_PACKAGES": " ".join(uploaded),
            }
            self.execute(script=INSTALL_SCRIPT, environment=env)
        finally:
            self.stop()

    def execute(self, command=None, script=None, input=None, environment={}):
        """Execute a shell command in the test machine and return its output.

        Either specify @command or @script

        Arguments:
            command: The string to execute by /bin/sh.
            script: A multi-line script to execute in /bin/sh
            input: Input to send to the command
            environment: Additional environmetn variables
        Returns:
            The command/script output as a string.
        """
        assert command or script
        assert self.address

        cmd = [
            "ssh",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-l", "root",
            self.address
        ]

        if command:
            assert not environment, "Not yet supported"
            cmd += [command]
            self.message("+", command)
        else:
            assert not input, "input not supported to script"
            cmd += ["sh", "-s"]
            if self.verbose:
                cmd += ["-x"]
            input = ""
            for name, value in environment.items():
                input += "%s='%s'\n" % (name, value)
            input += script
            command = "<script>"

        output = ""
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        rset = [proc.stdout.fileno()]
        wset = [proc.stdin.fileno()]
        while proc.poll() is None:
            ret = select.select(rset, wset, [], 10)
            for fd in ret[0]:
                if fd == proc.stdout.fileno():
                    data = os.read(fd, 1024)
                    if self.verbose:
                        sys.stdout.write(data)
                    output += data
            for fd in ret[1]:
                if fd == proc.stdin.fileno():
                    if input:
                        num = os.write(fd, input)
                        input = input[num:]
                    if not input:
                        proc.stdin.close()
                        wset = []

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, command)
        return output

    def upload(self, source, dest):
        """Upload a file into the test machine

        Arguments:
            source: the path of the file to upload
            dest: the file path in the machine to upload to
        """
        assert source and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            source, "root@%s:%s" % (self.address, dest),
        ]

        self.message("Uploading", source)
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download_dir(self, source, dest):
        """Download a directory from the test machine, recursively.
        """
        assert source and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-r",
            "root@%s:%s" % (self.address, source), dest
        ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        subprocess.check_call([ "rm", "-rf", dest ])
        subprocess.check_call(cmd)

    def write(self, dest, content):
        """Write a file into the test machine

        Arguments:
            content: Raw data to write to file
            dest: The file name in the machine to write to
        """
        assert dest
        assert self.address

        cmd = "cat > '%s'" % dest
        self.execute(command=cmd, input=content)

    def spawn(self, shell_cmd, log_id):
        """Spawn a process in the test machine.

        Arguments:
           shell_cmd: The string to execute by /bin/sh.
           log_id: The name of the file, realtive to /var/log on the test
              machine, that will receive stdout and stderr of the command.
        Returns:
            The pid of the /bin/sh process that executes the command.
        """
        return int(self.execute("{ (%s) >/var/log/%s 2>&1 & }; echo $!" % (shell_cmd, log_id)))

    def _calc_identity(self):
        identity = os.path.join(self.test_dir, "identity")
        os.chmod(identity, 0600)
        return identity

    def journal_messages(self, units):
        """Return interesting journal messages"""
        unit_fields = [ "_SYSTEMD_UNIT", "UNIT", "COREDUMP_UNIT" ]
        matches = [ "%s=%s" % (f,u) for u in units for f in unit_fields ]
        cmd = "journalctl -o cat %s" % " + ".join(matches)
        return self.execute(cmd).splitlines()

class QemuMachine(Machine):
    macaddr_prefix = "52:54:00:9e:00"

    def __init__(self, **args):
        Machine.__init__(self, **args)
        self.run_dir = os.path.join(self.test_dir, "run")
        self._image_root = os.path.join(self.run_dir, "%s-root" % (self.image, ))
        self._image_kernel = os.path.join(self.run_dir, "%s-kernel" % (self.image, ))
        self._image_initrd = os.path.join(self.run_dir, "%s-initrd" % (self.image, ))
        self._process = None
        self._monitor = None
        self._disks = { }
        self._locks = [ ]

    def _setup_fstab(self,gf):
        gf.write("/etc/fstab", "/dev/vda / ext4 defaults\n")

    def _setup_ssh_keys(self, gf):
        def copy(fr, to):
            with open(os.path.join(self.test_dir, fr), "r") as f:
                gf.write(to, f.read())

        # We use a fixed host key for all test machines since things
        # get too annoying when it changes from run to run.
        #
        copy("host_key", "/etc/ssh/ssh_host_rsa_key")
        gf.chmod(0600, "/etc/ssh/ssh_host_rsa_key")
        copy("host_key.pub", "/etc/ssh/ssh_host_rsa_key.pub")

        if not gf.exists("/root/.ssh"):
            gf.mkdir_mode("/root/.ssh", 0700)
        copy("identity.pub", "/root/.ssh/authorized_keys")

    def _setup_fedora_network(self,gf):
        dispatcher = "/etc/NetworkManager/dispatcher.d/99-cockpit"
        gf.write(dispatcher, QEMU_ADDR_SCRIPT)
        gf.chmod(0755, dispatcher)
        ifcfg_eth0 = 'BOOTPROTO="dhcp"\nDEVICE="eth0"\nONBOOT="yes"\n'
        gf.write("/etc/sysconfig/network-scripts/ifcfg-eth0", ifcfg_eth0)

    def _setup_fedora_18(self, gf):
        self._setup_fstab(gf)
        self._setup_ssh_keys(gf)
        self._setup_fedora_network(gf)

        # Switch to ssh socket activated so no race on boot
        sshd_socket = "[Unit]\nDescription=SSH Socket\n[Socket]\nListenStream=22\nAccept=yes\n"
        gf.write("/etc/systemd/system/sockets.target.wants/sshd.socket", sshd_socket)
        sshd_service = "[Unit]\nDescription=SSH Server\n[Service]\nExecStart=-/usr/sbin/sshd -i\nStandardInput=socket\n"
        gf.write("/etc/systemd/system/sshd@.service", sshd_service)
        # systemctl disable sshd.service
        gf.rm_f("/etc/systemd/system/multi-user.target.wants/sshd.service")

    def _setup_fedora_20 (self, gf):
        self._setup_fstab(gf)
        self._setup_ssh_keys(gf)
        self._setup_fedora_network(gf)

        # systemctl disable sshd.service
        gf.rm_f("/etc/systemd/system/multi-user.target.wants/sshd.service")
        # systemctl enable sshd.socket
        gf.mkdir_p("/etc/systemd/system/sockets.target.wants/")
        gf.ln_sf("/usr/lib/systemd/system/sshd.socket", "/etc/systemd/system/sockets.target.wants/")

    def unpack(self, flavor=None, modify_func=None):
        assert not self._process

        if not os.path.exists(self.run_dir):
            os.makedirs(self.run_dir, 0750)

        data_dir = os.environ.get("TEST_DATA") or self.test_dir
        if flavor:
            data_dir = os.path.join(data_dir, flavor)
        tarball = os.path.join(data_dir, "%s.tar.gz" % (self.image, ))
        if not os.path.exists(tarball):
           raise Failure("Unsupported OS %s: %s not found." % (self.image, tarball))

        import guestfs
        gf = guestfs.GuestFS(python_return_dict=True)
        if self.verbose:
            gf.set_trace(1)

        try:
            # Create a raw-format sparse disk image
            self.message("Building disk:", self._image_root)
            with open(self._image_root, "w") as f:
                f.truncate(4 * 1024 * 1024 * 1024)
                f.close()

            # Attach the disk image to libguestfs.
            gf.add_drive_opts(self._image_root, format = "raw", readonly = 0)
            gf.launch()

            devices = gf.list_devices()
            assert len(devices) == 1

            gf.mkfs("ext2", devices[0])
            gf.mount(devices[0], "/")

            self.message("Unpacking %s into %s" % (tarball, self._image_root))
            gf.tgz_in(tarball, "/")

            kernels = gf.glob_expand ("/boot/vmlinuz-*")
            initrds = gf.glob_expand ("/boot/initramfs-*")
            self.message("Extracting:", kernels[0], initrds[0])
            gf.download(kernels[0], self._image_kernel)
            gf.download(initrds[0], self._image_initrd)

            if modify_func:
                modify_func(gf)

        finally:
            gf.close()

    def pack(self):
        assert not self._process

        tarball = os.path.join(self.test_dir, "%s.tar.gz" % (self.image, ))

        import guestfs
        gf = guestfs.GuestFS(python_return_dict=True)
        if self.verbose:
            gf.set_trace(1)

        try:
            # Attach the disk image to libguestfs.
            gf.add_drive_opts(self._image_root, format = "raw", readonly = 1)
            gf.launch()

            devices = gf.list_devices()
            assert len(devices) == 1

            gf.mount(devices[0], "/")

            self.message("Packing %s into %s" % (self._image_root, tarball))
            gf.tgz_out("/", tarball)

        finally:
            gf.close()

    def build(self, deps):
        def modify(gf):
            if self.os == "fedora-18":
                self._setup_fedora_18(gf)
            elif self.os == "fedora-20":
                self._setup_fedora_20(gf)
            else:
                self.message("Unsupported OS %s" % self.os)

        self.unpack("base", modify)
        self.run_prepare_script(deps)

    def _lock_resource(self, resource, exclusive=True):
        resources = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources")
        if not os.path.exists(resources):
            os.mkdir(resources, 0755)
        resource = resource.replace("/", "_")
        fd = os.open(os.path.join(resources, resource), os.O_WRONLY | os.O_CREAT)
        try:
            flags = fcntl.LOCK_NB
            if exclusive:
                flags |= fcntl.LOCK_EX
            else:
                flags |= fcntl.LOCK_SH
            fcntl.flock(fd, flags)
        except IOError, ex:
            os.close(fd)
            return False
        else:
            self._locks.append(fd)
            return True

    def _choose_macaddr(self):
        for i in range(0, 0xFF):
            macaddr = "%s:%02x" % (self.macaddr_prefix, i)
            if self._lock_resource(macaddr):
                return macaddr
        raise Failure("Couldn't find unused mac address in directory: %s" % resources)

    def _locate_qemu_kvm(self):
        rhel_qemu_kvm_path = '/usr/libexec/qemu-kvm'
        if os.path.exists(rhel_qemu_kvm_path):
            return rhel_qemu_kvm_path
        # Assume it's in $PATH
        return 'qemu-kvm'

    def _start_qemu(self, maintain=False, tty=False, monitor=None):
        if not self._lock_resource(self._image_root, exclusive=maintain):
            raise Failure("Already running this image: %s" % self.image)

        snapshot = maintain and "off" or "on"
        selinux = "enforcing=0"
        self.macaddr = self._choose_macaddr()
        cmd = [
            self._locate_qemu_kvm(),
            "-m", str(MEMORY_MB),
            "-drive", "if=virtio,file=%s,index=0,serial=ROOT,snapshot=%s" % (self._image_root, snapshot),
            "-kernel", self._image_kernel,
            "-initrd", self._image_initrd,
            "-append", "root=/dev/vda console=ttyS0 quiet %s" % (selinux, ),
            "-nographic",
            "-net", "nic,model=virtio,macaddr=%s" % self.macaddr,
            "-net", "bridge,vlan=0,br=cockpit0",
            "-device", "virtio-scsi-pci,id=hot"
        ]

        if monitor:
            cmd += "-monitor", monitor

        # Used by the qemu maintenance console
        if tty:
            return subprocess.Popen(cmd)

        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.PIPE)

    def _monitor_qemu(self, command):
        assert self._monitor
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        output = ""
        try:
            sock.connect(self._monitor)
            fd = sock.fileno()
            while True:
                wset = command and [fd] or []
                ret = select.select([fd], wset, [], 10)
                if fd in ret[0]:
                    data = os.read(fd, 1024)
                    if not data:
                        if command:
                            raise Failure("Couldn't send command to qemu monitor: %s" % command)
                        break
                    if self.verbose:
                        sys.stdout.write(data)
                    output += data
                if fd in ret[1]:
                    sock.sendall("%s\n" % command)
                    sock.shutdown(socket.SHUT_WR)
                    command = None
        except OSError, ex:
            if ex.errno == 104: # Connection reset
                pass
            else:
                raise
        finally:
            sock.close()
        return output

    # This is a special QEMU specific maintenance console
    def qemu_console(self):
        try:
            proc = self._start_qemu(maintain=True, tty=True)
        except:
            self._cleanup()
            raise
        proc.wait()

    def start(self, maintain=False):
        assert not self._process
        try:
            (unused, self._monitor) = tempfile.mkstemp(suffix='.mon', prefix="machine-", dir=self.run_dir)
            self._process = self._start_qemu(maintain=maintain, tty=False,
                                             monitor="unix:path=%s,server,nowait" % self._monitor)
            self._maintaining = maintain
        except:
            self._cleanup()
            raise

    # A canary is a string that the QEMU VM prints out on its console
    # We return the remainder of teh line after the canary, there is
    # always an equals between
    def _parse_cockpit_canary(self, canary, output):
        prefix = "%s=" % canary
        pos = output.find(prefix)
        if pos == -1:
            return None
        beg = pos + len(prefix)
        end = output.find("\n", beg)
        if end == -1:
            return None
        return output[beg:end].strip()

    def wait_boot(self):
        assert self._process
        output = ""
        address = None
        p = self._process
        while not address and p.poll() is None:
            ret = select.select([p.stdout.fileno()], [], [], 10)
            for fd in ret[0]:
                if fd == p.stdout.fileno():
                    data = os.read(fd, 1024)
                    if self.verbose:
                        sys.stdout.write(data)
                    output += data
                    if "emergency mode" in output:
                        raise Failure("qemu vm failed to boot, stuck in emergency mode")
                    address = self._parse_cockpit_canary("COCKPIT_ADDRESS", output)
                    (unused, sep, output) = output.rpartition("\n")

        if not address:
            raise Failure("qemu did not run successfully: %d" % (p.returncode, ))

        self.address = address
        Machine.wait_boot(self)

    def stop(self):
        if self._maintaining:
            self.shutdown()
        else:
            self.kill()

    def _cleanup(self):
        try:
            if self._monitor and os.path.exists(self._monitor):
                os.unlink(self._monitor)
            self._monitor = None
            for index in dict(self._disks):
                self.rem_disk(index)
            self._disks = { }
            for fd in self._locks:
                os.close(fd)
            self._locks = []
            self._process = None
            self.address = None
            self.macaddr = None
        except:
            (type, value, traceback) = sys.exc_info()
            print >> sys.stderr, "WARNING: Cleanup failed:", str(value)

    def kill(self):
        try:
            if self._process and self._process.poll() is None:
                self._monitor_qemu("quit")
        finally:
            if self._process and self._process.poll() is None:
                self._process.terminate()
            self._cleanup()

    def wait_poweroff(self):
        assert self._process
        while self._process.poll() is None:
            fd = self._process.stdout.fileno()
            ret = select.select([fd], [], [], 1)
            if fd in ret[0]:
                data = os.read(fd, 1024)
                if self.verbose:
                    sys.stdout.write(data)
        self._cleanup()

    def shutdown(self):
        assert self._process
        try:
            if self._process.poll() is None:
                self._monitor_qemu("system_powerdown")
                self.wait_poweroff()
        except:
            self._cleanup()
            raise

    def add_disk(self, size, speed=None, serial=None):
        index = 1
        while index in self._disks:
            index += 1

        if not serial:
            serial = "DISK%d" % index

        path = os.path.join(self.run_dir, "disk-%s-%d" % (self.address, index))
        if os.path.exists(path):
            os.unlink(path)

        subprocess.check_call(["qemu-img", "create", path, str(size)])

        if speed:
            (unused, nbd) = tempfile.mkstemp(suffix='.nbd', prefix="disk-", dir=self.run_dir)
            cmd = [
                "trickle", "-s", "-t", "0.1", "-w", "1024", "-l", "1024", "-u", str(speed), "-d", str(speed),
                "qemu-nbd", "-k", nbd, path
            ]
            proc = subprocess.Popen(cmd)
            file = "nbd+unix://?socket=%s" % nbd
            time.sleep(0.2)
        else:
            file = path
            proc = None
            nbd = None

        cmd = "drive_add auto file=%s,if=none,serial=%s,id=drive%d" % (file, serial, index)
        output = self._monitor_qemu(cmd)

        cmd = "device_add scsi-disk,bus=hot.0,drive=drive%d,id=device%d" % (index, index)
        output = self._monitor_qemu(cmd)

        self._disks[index] = {
            "path": path,
            "socket": nbd,
            "proc": proc,
        }

        return index

    def rem_disk(self, index):
        assert index in self._disks
        disk = self._disks.pop(index)

        if self._monitor:
            cmd = "device_del device%d" % (index, )
            self._monitor_qemu(cmd)

            cmd = "drive_del drive%d" % (index, )
            self._monitor_qemu(cmd)

        if "path" in disk and disk["path"] and os.path.exists(disk["path"]):
            os.unlink(disk["path"])
        if "socket" in disk and disk["socket"] and os.path.exists(disk["socket"]):
            os.unlink(disk["socket"])
        if "proc" in disk and disk["proc"] and disk["proc"].poll() is not None:
            disk["proc"].terminate()

TestMachine = QemuMachine

QEMU_ADDR_SCRIPT = """#!/bin/sh
if [ "$2" = "up" ]; then
    /usr/sbin/ip addr show $1 | sed -En 's|.*\\binet ([^/ ]+).*|COCKPIT_ADDRESS=\\1|p' > /dev/console
fi
"""

PREPARE_SCRIPT = """#!/bin/sh
set -euf

echo 'SELINUX=disabled' > /etc/selinux/config

rm -rf /etc/sysconfig/iptables

echo "[cockpit-deps]
name=Unreleased Cockpit dependencies
baseurl=http://cockpit-project.github.io/cockpit-deps/$TEST_OS/$TEST_ARCH
enabled=1
gpgcheck=0" > /etc/yum.repos.d/cockpit-deps.repo

echo '<?xml version="1.0" encoding="utf-8"?>
<zone>
  <short>Public</short>
  <description>For use in public areas. You do not trust the other computers on networks to not harm your computer. Only selected incoming connections are accepted.</description>
  <service name="ssh"/>
  <service name="mdns"/>
  <service name="dhcpv6-client"/>
  <port protocol="tcp" port="21064"/>
  <port protocol="tcp" port="8765"/>
</zone>' > /etc/firewalld/zones/public.xml

echo 'NETWORKING=yes' > /etc/sysconfig/network

if ! grep -q 'admin:' /etc/passwd; then
    echo 'admin:x:1000:1000:Administrator:/home/admin:/bin/bash' >> /etc/passwd
fi

# Password is "foobar"
if ! grep -q 'admin:' /etc/shadow; then
    echo 'admin:$6$03s8BUsPb6ahCTLG$sb/AvOIJopKrG7KPG7KIqM1bmhpwF/oHSWF8jAicXx9Q0Dghl8PdUNXF61C3pTxOM/3XBJypvIrQdwC5frTCP/:15853:0:99999:7:::' >> /etc/shadow
fi

if ! grep -q 'admin:' /etc/group; then
    echo 'admin:x:1000:' >> /etc/group
    sed -i 's/^wheel:.*/\\0admin/' /etc/group
fi

if ! [ -d /home/admin ]; then
    mkdir /home/admin
    chown 1000:1000 /home/admin
fi

# To enable persistent logging
mkdir -p /var/log/journal

yes | yum update -y
if [ -n "$TEST_PACKAGES" ]; then
  yes | yum install -y $TEST_PACKAGES
fi

# Stopping a user@.service at poweroff sometimes hangs and then times
# out, but that seems to be harmless otherwise.  We reduce the timeout
# so that we don't have to wait for the default 90 seconds.
#
f=/usr/lib/systemd/system/user@.service
if [ -f $f ] && ! grep -q TimeoutStopSec $f; then
  echo TimeoutStopSec=1 >>$f
  systemctl daemon-reload
fi

# We rely on the NetworkManager dispatcher, but it sometimes is
# disabled after the update above.  So let's make sure it is enabled.
#
systemctl enable NetworkManager-dispatcher

rm -rf /var/log/journal/*
"""

INSTALL_SCRIPT = """#!/bin/sh
set -euf

rpm -U --replacepkgs --oldpackage $TEST_PACKAGES

rm -rf /var/log/journal/*
"""
