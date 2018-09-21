#!/usr/bin/python3 -u
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
import select
import signal
import string
import socket
import subprocess
import tempfile
import sys
import time

TEST_OS_DEFAULT = "fedora-28"

DEFAULT_IMAGE = os.environ.get("TEST_OS", TEST_OS_DEFAULT)

MEMORY_MB = 1024

# Images which are Atomic based
ATOMIC_IMAGES = ["rhel-atomic", "fedora-atomic", "continuous-atomic"]

BOTS_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
TEST_DIR = os.path.join(os.path.dirname(BOTS_DIR), "test")

# The Atomic variants can't build their own packages, so we build in
# their non-Atomic siblings.  For example, fedora-atomic is built
# in fedora-28
def get_build_image(image):
    (test_os, unused) = os.path.splitext(os.path.basename(image))
    if test_os == "fedora-atomic":
        image = "fedora-28"
    elif test_os == "rhel-atomic":
        image = "rhel-7-5"
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

class Timeout:
    """ Add a timeout to an operation
        Specify machine to ensure that a machine's ssh operations are canceled when the timer expires.
    """
    def __init__(self, seconds=1, error_message='Timeout', machine=None):
        if signal.getsignal(signal.SIGALRM) != signal.SIG_DFL:
            # there is already a different Timeout active
            self.seconds = None
            return

        self.seconds = seconds
        self.error_message = error_message
        self.machine = machine

    def handle_timeout(self, signum, frame):
        if self.machine:
            if self.machine.ssh_process:
                self.machine.ssh_process.terminate()
            self.machine.disconnect()

        raise RuntimeError(self.error_message)

    def __enter__(self):
        if self.seconds:
            signal.signal(signal.SIGALRM, self.handle_timeout)
            signal.alarm(self.seconds)

    def __exit__(self, type, value, traceback):
        if self.seconds:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, signal.SIG_DFL)

class Failure(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class RepeatableFailure(Failure):
    pass

LOGIN_MESSAGE = """
TTY LOGIN
  User: {ssh_user}/admin  Password: foobar
  To quit use Ctrl+], Ctrl+5 (depending on locale)

SSH ACCESS
  $ ssh -p {ssh_port} {ssh_user}@{ssh_address}
  Password: foobar

COCKPIT
  http://{web_address}:{web_port}
"""

RESOLV_SCRIPT = """
set -e
# HACK: Racing with operating systems reading/updating resolv.conf and
# the fact that resolv.conf can be a symbolic link. Avoid failures like:
# chattr: Operation not supported while reading flags on /etc/resolv.conf
mkdir -p /etc/NetworkManager/conf.d
printf '[main]\ndns=none\n' > /etc/NetworkManager/conf.d/dns.conf
systemctl reload-or-restart NetworkManager
printf 'domain {domain}\nsearch {domain}\nnameserver {nameserver}\n' >/etc/resolv2.conf
chcon -v unconfined_u:object_r:net_conf_t:s0 /etc/resolv2.conf 2> /dev/null || true
mv /etc/resolv2.conf /etc/resolv.conf
"""

class Machine:
    def __init__(self, address="127.0.0.1", image=None, verbose=False, label=None, browser=None):
        self.verbose = verbose

        # Currently all images are x86_64. When that changes we will have
        # an override file for those images that are not
        self.arch = "x86_64"

        self.image = image or "unknown"
        self.atomic_image = self.image in ATOMIC_IMAGES
        self.ssh_user = "root"
        if ":" in address:
            (self.ssh_address, unused, self.ssh_port) = address.rpartition(":")
        else:
            self.ssh_address = address
            self.ssh_port = 22
        if not browser:
            browser = address
        if ":" in browser:
            (self.web_address, unused, self.web_port) = browser.rpartition(":")
        else:
            self.web_address = browser
            self.web_port = 9090
        self.label = label or self.image + "-" + self.ssh_address + "-" + self.ssh_port
        self.ssh_master = None

        self.ssh_process = None
        self.ssh_reachable = False

        # The Linux kernel boot_id
        self.boot_id = None

    def diagnose(self):
        keys = {
            "ssh_user": self.ssh_user,
            "ssh_address": self.ssh_address,
            "ssh_port": self.ssh_port,
            "web_address": self.web_address,
            "web_port": self.web_port,
        }
        return LOGIN_MESSAGE.format(**keys)

    def disconnect(self):
        self.ssh_reachable = False
        self._kill_ssh_master()

    def message(self, *args):
        """Prints args if in verbose mode"""
        if not self.verbose:
            return
        print(" ".join(args))

    def start(self):
        """Overridden by machine classes to start the machine"""
        self.message("Assuming machine is already running")

    def stop(self):
        """Overridden by machine classes to stop the machine"""
        self.message("Not shutting down already running machine")

    # wait until we can execute something on the machine. ie: wait for ssh
    def wait_execute(self, timeout_sec=120):
        """Try to connect to self.address on ssh port"""

        # If connected to machine, kill master connection
        self._kill_ssh_master()

        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            addrinfo = socket.getaddrinfo(self.ssh_address, self.ssh_port, 0, socket.SOCK_STREAM)
            (family, socktype, proto, canonname, sockaddr) = addrinfo[0]
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(5)
            try:
                sock.connect(sockaddr)
                data = sock.recv(10)
                if len(data):
                    self.ssh_reachable = True
                    return True
            except IOError:
                pass
            finally:
                sock.close()
            time.sleep(0.5)
        return False

    def wait_user_login(self):
        """Wait until logging in as non-root works.

           Most tests run as the "admin" user, so we make sure that
           user sessions are allowed (and cockit-ws will let "admin"
           in) before declaring a test machine as "booted".

           Returns the boot id of the system, or None if ssh timed out.
        """
        tries_left = 60
        while (tries_left > 0):
            try:
                with Timeout(seconds=30):
                    return self.execute("! test -f /run/nologin && cat /proc/sys/kernel/random/boot_id", direct=True)
            except subprocess.CalledProcessError:
                pass
            except RuntimeError:
                # timeout; assume that ssh just went down during reboot, go back to wait_boot()
                return None
            tries_left = tries_left - 1
            time.sleep(1)
        raise Failure("Timed out waiting for /run/nologin to disappear")

    def wait_boot(self, timeout_sec=120):
        """Wait for a machine to boot"""
        start_time = time.time()
        boot_id = None
        while (time.time() - start_time) < timeout_sec:
            if self.wait_execute(timeout_sec=15):
                boot_id = self.wait_user_login()
                if boot_id:
                    break
        if not boot_id:
            raise Failure("Unable to reach machine {0} via ssh: {1}:{2}".format(self.label, self.ssh_address, self.ssh_port))
        self.boot_id = boot_id

    def wait_reboot(self, timeout_sec=120):
        self.disconnect()
        assert self.boot_id, "Before using wait_reboot() use wait_boot() successfully"
        boot_id = self.boot_id
        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            try:
                self.wait_boot(timeout_sec=timeout_sec)
                if self.boot_id != boot_id:
                    break
            except Failure:
                pass
        else:
            raise Failure("Timeout waiting for system to reboot properly")

    def wait_poweroff(self):
        """Overridden by machine classes to wait for a machine to stop"""
        assert False, "Cannot wait for a machine we didn't start"

    def kill(self):
        """Overridden by machine classes to unconditionally kill the running machine"""
        assert False, "Cannot kill a machine we didn't start"

    def shutdown(self):
        """Overridden by machine classes to gracefully shutdown the running machine"""
        assert False, "Cannot shutdown a machine we didn't start"

    def _start_ssh_master(self):
        self._kill_ssh_master()

        control = os.path.join(tempfile.gettempdir(), "ssh-%h-%p-%r-" + str(os.getpid()))

        cmd = [
            "ssh",
            "-p", str(self.ssh_port),
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-M", # ControlMaster, no stdin
            "-o", "ControlPath=" + control,
            "-o", "LogLevel=ERROR",
            "-l", self.ssh_user,
            self.ssh_address,
            "/bin/bash -c 'echo READY; read a'"
        ]

        # Connection might be refused, so try this 10 times
        tries_left = 10;
        while tries_left > 0:
            tries_left = tries_left - 1
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            stdout_fd = proc.stdout.fileno()
            output = ""
            while stdout_fd > -1 and "READY" not in output:
                ret = select.select([stdout_fd], [], [], 10)
                for fd in ret[0]:
                    if fd == stdout_fd:
                        data = os.read(fd, 1024)
                        if not data:
                            stdout_fd = -1
                            proc.stdout.close()
                        output += data.decode('utf-8', 'replace')

            if stdout_fd > -1:
                break

            # try again if the connection was refused, unless we've used up our tries
            proc.wait()
            if proc.returncode == 255 and tries_left > 0:
                self.message("ssh: connection refused, trying again")
                time.sleep(1)
                continue
            else:
                raise Failure("SSH master process exited with code: {0}".format(proc.returncode))

        self.ssh_master = control
        self.ssh_process = proc

        if not self._check_ssh_master():
            raise Failure("Couldn't launch an SSH master process")

    def _kill_ssh_master(self):
        if self.ssh_master:
            try:
                os.unlink(self.ssh_master)
            except OSError as e:
                if e.errno != errno.ENOENT:
                    raise
            self.ssh_master = None
        if self.ssh_process:
            self.message("killing ssh master process", str(self.ssh_process.pid))
            self.ssh_process.stdin.close()
            self.ssh_process.terminate()
            self.ssh_process.stdout.close()
            with Timeout(seconds=90, error_message="Timeout while waiting for ssh master to shut down"):
                self.ssh_process.wait()
            self.ssh_process = None

    def _check_ssh_master(self):
        if not self.ssh_master:
            return False
        cmd = [
            "ssh",
            "-q",
            "-p", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-S", self.ssh_master,
            "-O", "check",
            "-l", self.ssh_user,
            self.ssh_address
        ]
        with open(os.devnull, 'w') as devnull:
            code = subprocess.call(cmd, stdin=devnull, stdout=devnull, stderr=devnull)
            if code == 0:
                self.ssh_reachable = True
                return True
        return False

    def _ensure_ssh_master(self):
        if not self._check_ssh_master():
            self._start_ssh_master()

    def execute(self, command=None, script=None, input=None, environment={},
                stdout=None, quiet=False, direct=False, timeout=120):
        """Execute a shell command in the test machine and return its output.

        Either specify @command or @script

        Arguments:
            command: The string to execute by /bin/sh.
            script: A multi-line script to execute in /bin/sh
            input: Input to send to the command
            environment: Additional environment variables
            timeout: Applies if not already wrapped in a #Timeout context
        Returns:
            The command/script output as a string.
        """
        assert command or script
        assert self.ssh_address

        if not direct:
            self._ensure_ssh_master()

        # default to no translations; can be overridden in environment
        cmd = [
            "env", "-u", "LANGUAGE", "LC_ALL=C",
            "ssh",
            "-p", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "LogLevel=ERROR",
            "-o", "BatchMode=yes"
        ]

        if direct:
            cmd += [ "-i", self._calc_identity() ]
        else:
            cmd += [ "-o", "ControlPath=" + self.ssh_master ]

        cmd += [
            "-l", self.ssh_user,
            self.ssh_address
        ]

        if command:
            assert not environment, "Not yet supported"
            if getattr(command, "strip", None): # Is this a string?
                cmd += [command]
                if not quiet:
                    self.message("+", command)
            else:
                cmd += command
                if not quiet:
                    self.message("+", *command)
        else:
            assert not input, "input not supported to script"
            cmd += ["sh", "-s"]
            if self.verbose:
                cmd += ["-x"]
            input = ""
            for name, value in environment.items():
                input += "%s='%s'\n" % (name, value)
                input += "export %s\n" % name
            input += script
            command = "<script>"

        if stdout:
            subprocess.call(cmd, stdout=stdout)
            return

        with Timeout(seconds=timeout, error_message="Timed out on '%s'" % command, machine=self):
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
                        if not data:
                            rset.remove(stdout_fd)
                            proc.stdout.close()
                        else:
                            if self.verbose:
                                os.write(sys.stdout.fileno(), data)
                            output += data.decode('utf-8', 'replace')
                    elif fd == stderr_fd:
                        data = os.read(fd, 1024)
                        if not data:
                            rset.remove(stderr_fd)
                            proc.stderr.close()
                        elif not quiet or self.verbose:
                            os.write(sys.stderr.fileno(), data)
                for fd in ret[1]:
                    if fd == stdin_fd:
                        if input:
                            num = os.write(fd, input.encode('utf-8'))
                            input = input[num:]
                        if not input:
                            wset.remove(stdin_fd)
                            proc.stdin.close()
            proc.wait()

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, command, output=output)
        return output

    def upload(self, sources, dest):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        assert sources and dest
        assert self.ssh_address

        self._ensure_ssh_master()

        cmd = [
            "scp", "-B",
            "-r", "-p",
            "-P", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
          ]
        if not self.verbose:
            cmd += [ "-q" ]

        def relative_to_test_dir(path):
            return os.path.join(TEST_DIR, path)
        cmd += map(relative_to_test_dir, sources)

        cmd += [ "%s@[%s]:%s" % (self.ssh_user, self.ssh_address, dest) ]

        self.message("Uploading", ", ".join(sources))
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download(self, source, dest):
        """Download a file from the test machine.
        """
        assert source and dest
        assert self.ssh_address

        self._ensure_ssh_master()
        dest = os.path.join(TEST_DIR, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
            ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += [ "%s@[%s]:%s" % (self.ssh_user, self.ssh_address, source), dest ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download_dir(self, source, dest):
        """Download a directory from the test machine, recursively.
        """
        assert source and dest
        assert self.ssh_address

        self._ensure_ssh_master()
        dest = os.path.join(TEST_DIR, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
            "-r",
          ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += [ "%s@[%s]:%s" % (self.ssh_user, self.ssh_address, source), dest ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        try:
            subprocess.check_call(cmd)
            target = os.path.join(dest, os.path.basename(source))
            if os.path.exists(target):
                subprocess.check_call([ "find", target, "-type", "f", "-exec", "chmod", "0644", "{}", ";" ])
        except:
            self.message("Error while downloading directory '{0}'".format(source))

    def write(self, dest, content):
        """Write a file into the test machine

        Arguments:
            content: Raw data to write to file
            dest: The file name in the machine to write to
        """
        assert dest
        assert self.ssh_address

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
        identity = os.path.join(BOTS_DIR, "machine", "identity")
        os.chmod(identity, 0o600)
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
        if len(messages) == 1 and ("Cannot assign requested address" in messages[0]
                                   or "-- No entries --" in messages[0]):
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

    def get_admin_group(self):
        if "debian" in self.image or "ubuntu" in self.image:
            return "sudo"
        else:
            return "wheel"

    def start_cockpit(self, atomic_wait_for_host=None, tls=False):
        """Start Cockpit.

        Cockpit is not running when the test virtual machine starts up, to
        allow you to make modifications before it starts.
        """

        if self.atomic_image:
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1228776
            # we want to run:
            # self.execute("atomic run cockpit/ws --no-tls")
            # but atomic doesn't forward the parameter, so we use the resulting command
            # also we need to wait for cockpit to be up and running
            cmd = """#!/bin/sh
            systemctl start docker &&
            """
            if tls:
                cmd += "/usr/bin/docker run -d --privileged --pid=host -v /:/host cockpit/ws /container/atomic-run --local-ssh\n"
            else:
                cmd += "/usr/bin/docker run -d --privileged --pid=host -v /:/host cockpit/ws /container/atomic-run --local-ssh --no-tls\n"
            with Timeout(seconds=90, error_message="Timeout while waiting for cockpit/ws to start"):
                self.execute(script=cmd)
            self.wait_for_cockpit_running(atomic_wait_for_host or "localhost")
        elif tls:
            self.execute(script="""#!/bin/sh
            rm -f /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            systemctl start cockpit.socket
            """)
        else:
            self.execute(script="""#!/bin/sh
            mkdir -p /etc/systemd/system/cockpit.service.d/ &&
            rm -f /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            printf \"[Service]\nExecStartPre=-/bin/sh -c 'echo 0 > /proc/sys/kernel/yama/ptrace_scope'\nExecStart=\n%s --no-tls\n\" `systemctl cat cockpit.service | grep ExecStart=` > /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            systemctl start cockpit.socket
            """)

    def restart_cockpit(self):
        """Restart Cockpit.
        """
        if self.atomic_image:
            with Timeout(seconds=90, error_message="Timeout while waiting for cockpit/ws to restart"):
                self.execute("docker restart `docker ps | grep cockpit/ws | awk '{print $1;}'`")
            self.wait_for_cockpit_running()
        else:
            self.execute("systemctl restart cockpit")

    def stop_cockpit(self):
        """Stop Cockpit.
        """
        if self.atomic_image:
            with Timeout(seconds=60, error_message="Timeout while waiting for cockpit/ws to stop"):
                self.execute("docker kill `docker ps | grep cockpit/ws | awk '{print $1;}'`")
        else:
            self.execute("systemctl stop cockpit.socket cockpit.service")

    def set_address(self, address, mac='52:54:01'):
        """Set IP address for the network interface with given mac prefix"""
        cmd = "nmcli con add type ethernet autoconnect yes con-name static-{mac} ifname \"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" ip4 {address} && ( nmcli conn up static-{mac} || true )"
        self.execute(cmd.format(mac=mac, address=address))

    def set_dns(self, nameserver=None, domain=None):
        self.execute(RESOLV_SCRIPT.format(nameserver=nameserver or "127.0.0.1", domain=domain or "cockpit.lan"))

    def dhcp_server(self, mac='52:54:01', range=['10.111.112.2', '10.111.127.254']):
        """Sets up a DHCP server on the interface"""
        cmd = "dnsmasq --domain=cockpit.lan --interface=\"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" --bind-dynamic --dhcp-range=" + ','.join(range) + " && firewall-cmd --add-service=dhcp"
        self.execute(cmd.format(mac=mac))

    def dns_server(self, mac='52:54:01'):
        """Sets up a DNS server on the interface"""
        cmd = "dnsmasq --domain=cockpit.lan --interface=\"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" --bind-dynamic"
        self.execute(cmd.format(mac=mac))

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
    <qemu:arg value='-netdev'/>
    <qemu:arg value='bridge,br={bridge},id=bridge0'/>
    <qemu:arg value='-device'/>
    <qemu:arg value='rtl8139,netdev=bridge0,mac={mac},bus=pci.0,addr=0x0f'/>
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
        if not os.path.exists(resources):
            os.mkdir(resources, 0o755)
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
            result["ethernet"] = ""
        elif self.bridge:
            result["bridge"] = self.bridge
            result["ethernet"] = TEST_BRIDGE_XML.format(**result)
        else:
            result["bridge"] = ""
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
        self.run_dir = os.path.join(os.environ.get("TEST_DATA", base_dir), "tmp", "run")

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
                        self.execute("true", quiet=True)
                        sys.stderr.write(message)
                        self.disconnect()
                        message = None
                    except subprocess.CalledProcessError:
                        pass
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

            if self._domain.detachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE ) != 0:
                raise Failure("Unable to remove disk from vm")

        # if this isn't just an additional path, clean up
        if "path" in disk and disk["path"] and os.path.exists(disk["path"]):
            os.unlink(disk["path"])

    def _qemu_monitor(self, command):
        self.message("& " + command)
        # you can run commands manually using virsh:
        # virsh -c qemu:///session qemu-monitor-command [domain name/id] --hmp [command]
        output = libvirt_qemu.qemuMonitorCommand(self._domain, command, libvirt_qemu.VIR_DOMAIN_QEMU_MONITOR_COMMAND_HMP)
        self.message(output.strip())
        return output

    def add_netiface(self, networking=None, vlan=0):
        if not networking:
            networking = VirtNetwork().interface()
        cmd = "device_add virtio-net-pci,mac={0}".format(networking["mac"])
        if vlan == 0:
            self._qemu_monitor("netdev_add socket,mcast=230.0.0.1:{mcast},id={id}".format(mcast=networking["mcast"], id=networking["hostnet"]))
            cmd += ",netdev={id}".format(id=networking["hostnet"])
        else:
            cmd += ",vlan={vlan}".format(vlan=vlan)
        self._qemu_monitor(cmd)
        return networking["mac"]

    def needs_writable_usr(self):
        # On atomic systems, we need a hack to change files in /usr/lib/systemd
        if self.atomic_image:
            self.execute(command="mount -o remount,rw /usr")

    def wait_for_cockpit_running(self, address="localhost", port=9090, seconds=30):
        WAIT_COCKPIT_RUNNING = """#!/bin/sh
until curl -s --connect-timeout 2 --max-time 3 http://%s:%s >/dev/null; do
    sleep 0.5;
done;
""" % (address, port)
        with Timeout(seconds=seconds, error_message="Timeout while waiting for cockpit to start"):
            self.execute(script=WAIT_COCKPIT_RUNNING)

# This can be used as helper program for tests not written in Python: Run given
# image name until SIGTERM or SIGINT; the image must exist in test/images/;
# use image-prepare or image-customize to create that. For example:
# $ bots/image-customize -v -i cockpit centos-7
# $ bots/machine/testvm.py centos-7
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run a VM image until SIGTERM or SIGINT")
    parser.add_argument("--memory", type=int, default=1024,
                        help="Memory in MiB to allocate to the VM (default: %(default)s)")
    parser.add_argument("image", help="Image name")
    args = parser.parse_args()

    network = VirtNetwork(0)
    machine = VirtMachine(image=args.image, networking=network.host(), memory_mb=args.memory)
    machine.start()
    machine.wait_boot()

    # run a command to force starting the SSH master
    machine.execute('uptime')

    # print ssh command
    print("ssh -o ControlPath=%s -p %s %s@%s" %
          (machine.ssh_master, machine.ssh_port, machine.ssh_user, machine.ssh_address))
    # print Cockpit web address
    print("http://%s:%s" % (machine.web_address, machine.web_port))
    # print marker that the VM is ready; tests can poll for this to wait for the VM
    print("RUNNING")

    signal.signal(signal.SIGTERM, lambda sig, frame: machine.stop())
    try:
        signal.pause()
    except KeyboardInterrupt:
        machine.stop()
