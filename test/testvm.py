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
import shutil
from lxml import etree

DEFAULT_FLAVOR="cockpit"
DEFAULT_OS = "fedora-22"
DEFAULT_ARCH = "x86_64"

MEMORY_MB = 1024

SSH_WARNING = re.compile(r'Warning: Permanently added .* to the list of known hosts.*\n')

class Failure(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class RepeatThis(Failure):
    pass

class Machine:
    boot_hook = None

    def __init__(self, address=None, flavor=None, system=None, arch=None, verbose=False, label=None):
        self.verbose = verbose
        self.flavor = flavor or DEFAULT_FLAVOR

        conf_file = "%s.conf" % self.flavor
        if os.path.exists(conf_file):
            with open(conf_file, "r") as f:
                self.conf = eval(f.read())
        else:
            self.conf = { }

        self.os = system or self.getconf('os') or os.environ.get("TEST_OS") or DEFAULT_OS
        self.arch = arch or os.environ.get("TEST_ARCH") or DEFAULT_ARCH
        self.image = "%s-%s-%s" % (self.flavor, self.os, self.arch)
        self.test_dir = os.path.abspath(os.path.dirname(__file__))
        self.test_data = os.environ.get("TEST_DATA") or self.test_dir
        self.address = address
        self.mac = None
        self.label = label or "UNKNOWN"

    def getconf(self, key):
        return key in self.conf and self.conf[key]

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

    def wait_ssh(self):
        """Try to connect to self.address on port 22"""
        tries_left = 60
        while (tries_left > 0):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            try:
                sock.connect((self.address, 22))
                return True
            except:
                pass
            finally:
                sock.close()
            tries_left = tries_left - 1
            time.sleep(1)
        return False

    def wait_user_login(self):
        """Wait until logging in as non-root works.

           Most tests run as the "admin" user, so we make sure that
           user sessions are allowed (and cockit-ws will let "admin"
           in) before declaring a test machine as "booted".
        """
        tries_left = 5
        while (tries_left > 0):
            try:
                self.execute("! test -f /run/nologin")
                return
            except:
                pass
            tries_left = tries_left - 1
            time.sleep(1)
        raise Failure("Timed out waiting for /run/nologin to disappear")

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

    def build(self, args):
        """Build a machine image for running tests.

        This is usually overridden by derived classes. This should be
        called before running a machine.
        """
        pass

    def run_setup_script(self, script, args):
        """Prepare a test image further by running some commands in it."""
        self.start(maintain=True)
        try:
            self.wait_boot()
            self.upload([script], "/var/tmp/SETUP")
            env = {
                "TEST_OS": self.os,
                "TEST_ARCH": self.arch,
                "TEST_FLAVOR": self.flavor,
                "TEST_SETUP_ARGS": " ".join(args),
            }
            self.execute(script="/var/tmp/SETUP", environment=env)
        finally:
            self.stop()

    def run_selinux_relabel(self):
        """Boot an image the first time which allows relabeling"""
        self.start(maintain=True)
        try:
            self.wait_boot()
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
            self.upload(rpms, "/tmp")
            uploaded = []
            for rpm in rpms:
                base = os.path.basename(rpm)
                dest = os.path.join("/tmp", base)
                uploaded.append(dest)
            env = {
                "TEST_OS": self.os,
                "TEST_ARCH": self.arch,
                "TEST_FLAVOR": self.flavor,
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
            "-o", "UserKnownHostsFile=/dev/null",
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
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdin_fd = proc.stdin.fileno()
        stdout_fd = proc.stdout.fileno()
        stderr_fd = proc.stderr.fileno()
        rset = [stdout_fd, stderr_fd]
        wset = [stdin_fd]
        while len(rset) > 0 or len(wset) > 0:
            ret = select.select(rset, wset, [], 10)
            for fd in ret[0]:
                if fd == stdout_fd:
                    data = os.read(fd, 1024)
                    if data == "":
                        rset.remove(stdout_fd)
                        proc.stdout.close()
                    else:
                        if self.verbose:
                            sys.stdout.write(data)
                        output += data
                elif fd == stderr_fd:
                    data = os.read(fd, 1024)
                    if data == "":
                        rset.remove(stderr_fd)
                        proc.stderr.close()
                    else:
                        data = SSH_WARNING.sub("", data)
                        sys.stderr.write(data)
            for fd in ret[1]:
                if fd == stdin_fd:
                    if input:
                        num = os.write(fd, input)
                        input = input[num:]
                    if not input:
                        wset.remove(stdin_fd)
                        proc.stdin.close()
        proc.wait()

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, command)
        return output

    def upload(self, sources, dest):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        assert sources and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
        ] + sources + [ "root@%s:%s" % (self.address, dest), ]

        self.message("Uploading", " ,".join(sources))
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
            "-o", "UserKnownHostsFile=/dev/null",
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

    def journal_messages(self, syslog_ids, log_level):
        """Return interesting journal messages"""

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead

        matches = " ".join(map(lambda id: "SYSLOG_IDENTIFIER=" + id, syslog_ids))

        # Some versions of journalctl terminate unsuccessfully when
        # the output is empty.  We work around this by ignoring the
        # exit status and including error messages from journalctl
        # itself in the returned messages.

        cmd = "journalctl 2>&1 -o cat -p %d %s || true" % (log_level, matches)
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            # No messages
            return [ ]
        else:
            return messages

    def audit_messages(self, type_pref):
        cmd = "journalctl -o cat SYSLOG_IDENTIFIER=kernel 2>&1 | grep 'type=%s.*audit' || true" % (type_pref, )
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            messages = [ ]
        return messages


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

    def _setup_fedora_21 (self, gf):
        self._setup_fstab(gf)
        self._setup_ssh_keys(gf)
        self._setup_fedora_network(gf)

        # systemctl disable sshd.service
        gf.rm_f("/etc/systemd/system/multi-user.target.wants/sshd.service")
        # systemctl enable sshd.socket
        gf.mkdir_p("/etc/systemd/system/sockets.target.wants/")
        gf.ln_sf("/usr/lib/systemd/system/sshd.socket", "/etc/systemd/system/sockets.target.wants/")

    def _setup_fedora_22 (self, gf):
        self._setup_fstab(gf)
        self._setup_ssh_keys(gf)
        self._setup_fedora_network(gf)

        # systemctl disable sshd.service
        gf.rm_f("/etc/systemd/system/multi-user.target.wants/sshd.service")
        # systemctl enable sshd.socket
        gf.mkdir_p("/etc/systemd/system/sockets.target.wants/")
        gf.ln_sf("/usr/lib/systemd/system/sshd.socket", "/etc/systemd/system/sockets.target.wants/")

    def _setup_rhel_7 (self, gf):
        self._setup_fstab(gf)
        self._setup_ssh_keys(gf)
        self._setup_fedora_network(gf)

        # systemctl disable sshd.service
        gf.rm_f("/etc/systemd/system/multi-user.target.wants/sshd.service")
        # systemctl enable sshd.socket
        gf.mkdir_p("/etc/systemd/system/sockets.target.wants/")
        gf.ln_sf("/usr/lib/systemd/system/sshd.socket", "/etc/systemd/system/sockets.target.wants/")

        # upload subscription information
        gf.mkdir_p("/root/.rhel")
        gf.upload(os.path.expanduser("~/.rhel/login"), "/root/.rhel/login")
        gf.upload(os.path.expanduser("~/.rhel/pass"), "/root/.rhel/pass")

    def unpack_base(self, modify_func=None):
        assert not self._process

        if not os.path.exists(self.run_dir):
            os.makedirs(self.run_dir, 0750)

        image = "%s-%s" % (self.os, self.arch)
        tarball = os.path.join(self.test_data, "%s.tar.gz" % (image, ))
        if not os.path.exists(tarball):
           raise Failure("Unsupported configuration %s: %s not found." % (image, tarball))

        import guestfs
        gf = guestfs.GuestFS(python_return_dict=True)
        if self.verbose:
            gf.set_trace(1)

        try:
            # Create a qcow2-format disk image
            self.message("Building disk:", self._image_root)
            subprocess.check_call([ "qemu-img", "create", "-q", "-f", "qcow2", self._image_root, "4G" ])

            # Attach the disk image to libguestfs.
            gf.add_drive_opts(self._image_root, format = "qcow2", readonly = 0)
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

    def save(self):
        assert not self._process

        if (not os.path.exists(self._image_kernel)
            or not os.path.exists(self._image_initrd)
            or not os.path.exists(self._image_root)):
            raise Failure("Nothing to save.")

        if (os.path.islink(self._image_kernel)
            or os.path.islink(self._image_initrd)):
            raise Failure("Can not save now, only right after vm-create.")

        images_dir = os.path.join(self.test_data, "images")
        checksum_file = os.path.join(images_dir, "%s-checksum" % (self.image, ))
        if not os.path.exists(images_dir):
            os.makedirs(images_dir, 0750)
        shutil.copy(self._image_root, images_dir)
        shutil.copy(self._image_kernel, images_dir)
        shutil.copy(self._image_initrd, images_dir)
        with open(checksum_file, "w") as f:
            subprocess.check_call([ "sha256sum",
                                    os.path.basename(self._image_root),
                                    os.path.basename(self._image_kernel),
                                    os.path.basename(self._image_initrd) ],
                                  cwd=images_dir,
                                  stdout=f)

    def build(self, args):
        def modify(gf):
            if self.os == "fedora-21":
                self._setup_fedora_21(gf)
            elif self.os == "fedora-22":
                self._setup_fedora_22(gf)
            elif self.os == "rhel-7":
                credential_path = os.path.expanduser("~/.rhel/")
                if (not os.path.isfile(credential_path + "login")) or (not os.path.isfile(credential_path + "pass")):
                    raise Failure("Subscription credentials expected in '~/.rhel/login', '~/.rhel/pass'.")
                self._setup_rhel_7(gf)
            else:
                raise Failure("Unsupported OS %s" % self.os)

        script = "%s-%s.setup" % (self.flavor, self.os)
        if not os.path.exists(script):
            raise Failure("Unsupported flavor %s: %s not found." % (self.flavor, script))

        self.unpack_base(modify)
        self.run_setup_script(script, args)
        self.run_selinux_relabel()

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
        if 'mac' in self.conf and self.conf['mac']:
            macaddr = self.conf['mac']
            if len(macaddr) == 2:
                macaddr = self.macaddr_prefix + ":" + macaddr
            if self._lock_resource(macaddr):
                return macaddr
            raise Failure("Mac address %s is in use" % macaddr)
        else:
            for i in range(0, 0x0F):
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
        if (not os.path.exists(self._image_root)
            or not os.path.exists(self._image_kernel)
            or not os.path.exists(self._image_initrd)):

            if not os.path.exists(self.run_dir):
                os.makedirs(self.run_dir, 0750)

            backing_file = os.path.join(self.test_data, "images", os.path.basename(self._image_root))
            kernel_file = os.path.join(self.test_data, "images", os.path.basename(self._image_kernel))
            initrd_file = os.path.join(self.test_data, "images", os.path.basename(self._image_initrd))
            if not os.path.exists(backing_file):
                raise Failure("Image not found: %s" % backing_file)
            if not os.path.exists(kernel_file):
                raise Failure("Kernel not found: %s" % backing_file)
            if not os.path.exists(initrd_file):
                raise Failure("Initrd not found: %s" % backing_file)
            subprocess.check_call([ "qemu-img", "create", "-q",
                                    "-f", "qcow2",
                                    "-o", "backing_file=%s" % backing_file,
                                    self._image_root ])
            subprocess.check_call([ "ln", "-sf", kernel_file, self._image_kernel ])
            subprocess.check_call([ "ln", "-sf", initrd_file, self._image_initrd ])

        if not self._lock_resource(self._image_root, exclusive=maintain):
            raise Failure("Already running this image: %s" % self.image)

        if maintain:
            snapshot = "off"
            selinux = "enforcing=0"
        else:
            snapshot = "on"
            selinux = ""
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

        self.message(*cmd)

        if tty:
            # Used by the qemu maintenance console
            return subprocess.Popen(cmd)
        elif self.verbose:
            return subprocess.Popen(cmd, stdin=open("/dev/null"))
        else:
            return subprocess.Popen(cmd, stdout=open("run/qemu-%s-%s.log" % (self.label, self.macaddr), "w"), stdin=open("/dev/null"))

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
    def qemu_console(self, snapshot=False):
        try:
            proc = self._start_qemu(maintain=not snapshot, tty=True)
        except:
            self._cleanup()
            raise
        proc.wait()

    def start(self, maintain=False):
        assert not self._process
        try:
            if not os.path.exists(self.run_dir):
                os.makedirs(self.run_dir, 0750)

            (unused, self._monitor) = tempfile.mkstemp(suffix='.mon', prefix="machine-", dir=self.run_dir)
            self._process = self._start_qemu(maintain=maintain, tty=False,
                                             monitor="unix:path=%s,server,nowait" % self._monitor)
            self._maintaining = maintain
        except:
            self._cleanup()
            raise

    def _ip_from_mac(self, mac):
        tree = etree.parse(open("./network-cockpit.xml"))
        for h in tree.find(".//dhcp"):
            if h.get("mac") == mac:
                return h.get("ip")
        raise Failure("Can't resolve IP of %s" % mac)

    def wait_boot(self):
        assert self._process
        self.address = self._ip_from_mac(self.macaddr)
        if not Machine.wait_ssh(self):
            raise Failure("Unable to reach machine %s via ssh." % (self.address))
        self.wait_user_login()

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
        self._process.wait()
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

        subprocess.check_call(["qemu-img", "create", "-q", path, str(size)])

        if speed:
            (unused, nbd) = tempfile.mkstemp(suffix='.nbd', prefix="disk-", dir=self.run_dir)
            cmd = [
                "trickle", "-s", "-t", "0.1", "-w", "1024", "-l", "1024", "-u", str(speed), "-d", str(speed),
                "qemu-nbd", "-k", nbd, path
            ]
            proc = subprocess.Popen(cmd)
            file = "nbd+unix://?socket=%s" % nbd
            time.sleep(2)
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

    def add_netiface(self, mac, vlan=0):
        if len(mac) == 2:
            mac = self.macaddr_prefix + ":" + mac
        self._monitor_qemu("device_add e1000,vlan=%s,mac=%s" % (vlan,mac));
        return mac

TestMachine = QemuMachine

QEMU_ADDR_SCRIPT = """#!/bin/sh
if [ "$2" = "up" ]; then
    /usr/sbin/ip addr show $1 | sed -En 's|.*\\binet ([^/ ]+).*|COCKPIT_ADDRESS=\\1|p' > /dev/console
fi
"""

INSTALL_SCRIPT = """#!/bin/sh
set -eu

rpm -U --force $TEST_PACKAGES

firewall-cmd --add-service=cockpit --permanent

rm -rf /var/log/journal/*
rm -rf /var/lib/NetworkManager/dhclient-*.lease
"""
