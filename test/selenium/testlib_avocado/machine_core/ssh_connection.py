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


import os
import time
import socket
import subprocess
import select
import errno
import shlex
import sys
import tempfile

from . import exceptions
from . import timeout as timeoutlib


class SSHConnection(object):
    ssh_default_opts = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes"]

    def __init__(self, user, address, ssh_port, identity_file, verbose=False):
        self.verbose = verbose

        # Currently all images are x86_64. When that changes we will have
        # an override file for those images that are not
        self.ssh_user = user
        self.identity_file = identity_file
        self.ssh_address = address
        self.ssh_port = ssh_port
        self.ssh_master = None
        self.ssh_process = None
        self.ssh_reachable = False
        self.label = "{}@{}:{}".format(self.ssh_user, self.ssh_address, self.ssh_port)

    def disconnect(self):
        self.ssh_reachable = False
        self._kill_ssh_master()

    def message(self, *args):
        """Prints args if in verbose mode"""
        if self.verbose:
            sys.stderr.write(" ".join(args) + '\n')

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
                with timeoutlib.Timeout(seconds=30):
                    return self.execute("! test -f /run/nologin && cat /proc/sys/kernel/random/boot_id", direct=True)
            except subprocess.CalledProcessError:
                pass
            except RuntimeError:
                # timeout; assume that ssh just went down during reboot, go back to wait_boot()
                return None
            tries_left = tries_left - 1
            time.sleep(1)
        raise exceptions.Failure("Timed out waiting for /run/nologin to disappear")

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
            raise exceptions.Failure("Unable to reach machine {0} via ssh: {1}:{2}".format(
                self.label, self.ssh_address, self.ssh_port))
        self.boot_id = boot_id

    def wait_reboot(self, timeout_sec=180):
        self.disconnect()
        assert self.boot_id, "Before using wait_reboot() use wait_boot() successfully"
        boot_id = self.boot_id
        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            try:
                self.wait_boot(timeout_sec=timeout_sec)
                if self.boot_id != boot_id:
                    break
            except exceptions.Failure:
                pass
        else:
            raise exceptions.Failure("Timeout waiting for system to reboot properly")

    def _start_ssh_master(self):
        self._kill_ssh_master()

        control = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources", "ssh-%h-%p-%r-" + str(os.getpid()))
        os.makedirs(os.path.dirname(control), exist_ok=True)

        cmd = [
            "ssh",
            "-p", str(self.ssh_port),
            "-i", self.identity_file,
            *self.ssh_default_opts,
            "-M",  # ControlMaster, no stdin
            "-o", "ControlPath=" + control,
            "-o", "LogLevel=ERROR",
            "-l", self.ssh_user,
            self.ssh_address,
            "/bin/bash -c 'echo READY; read a'"
        ]

        # Connection might be refused, so try this 10 times
        tries_left = 10
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
                raise exceptions.Failure("SSH master process exited with code: {0}".format(proc.returncode))

        self.ssh_master = control
        self.ssh_process = proc

        if not self._check_ssh_master():
            raise exceptions.Failure("Couldn't launch an SSH master process")

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
            with timeoutlib.Timeout(seconds=90, error_message="Timeout while waiting for ssh master to shut down"):
                self.ssh_process.wait()
            self.ssh_process = None

    def _check_ssh_master(self):
        if not self.ssh_master:
            return False
        cmd = [
            "ssh",
            "-q",
            "-p", str(self.ssh_port),
            *self.ssh_default_opts,
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

    def __ssh_direct_opt_var(self, direct=False):
        return os.getenv("TEST_SSH_DIRECT", direct)

    def __execution_opts(self, direct=False):
        direct = self.__ssh_direct_opt_var(direct=direct)
        if direct:
            return ["-i", self.identity_file]
        else:
            return ["-o", "ControlPath=" + self.ssh_master]

    def execute(self, command=None, script=None, input=None, environment={},
                stdout=None, quiet=False, direct=False, timeout=120,
                ssh_env=["env", "-u", "LANGUAGE", "LC_ALL=C"]):
        """Execute a shell command in the test machine and return its output.

        Either specify @command or @script

        Arguments:
            command: The string to execute by /bin/sh; or
                     an argument list execute without shell interpretation
            script: A multi-line script to execute in /bin/sh
            input: Input to send to the command
            environment: Additional environment variables
            timeout: Applies if not already wrapped in a #Timeout context
        Returns:
            The command/script output as a string.
        """
        assert command or script
        assert self.ssh_address

        if not self.__ssh_direct_opt_var(direct=direct):
            self._ensure_ssh_master()

        env_script = ""
        env_command = []
        if environment and isinstance(environment, dict):
            for name, value in environment.items():
                env_script += "%s='%s'\n" % (name, value)
                env_script += "export %s\n" % name
                env_command.append("{}={}".format(name, value))
        elif environment == {}:
            pass
        else:
            raise Exception("enviroment support dict or list items given: {0}".format(environment))
        default_ssh_params = [
            "ssh",
            "-p", str(self.ssh_port),
            *self.ssh_default_opts,
            "-o", "LogLevel=ERROR",
            "-l", self.ssh_user,
            self.ssh_address
        ]
        additional_ssh_params = []
        cmd = []

        additional_ssh_params += self.__execution_opts(direct=direct)

        if command:
            if getattr(command, "strip", None):  # Is this a string?
                cmd += [command]
                if not quiet:
                    self.message("+", command)
            else:
                # use shlex.join() once Python 3.8 is available everywhere
                cmd.append(' '.join(shlex.quote(arg) for arg in command))
                if not quiet:
                    self.message("+", *command)
        else:
            assert not input, "input not supported to script"
            cmd += ["sh", "-s"]
            if self.verbose:
                cmd += ["-x"]
            input = env_script
            input += script
            command = "<script>"
        command_line = ssh_env + default_ssh_params + additional_ssh_params + env_command + cmd

        with timeoutlib.Timeout(seconds=timeout, error_message="Timed out on '%s'" % command, machine=self):
            if stdout:
                subprocess.call(command_line, stdout=stdout)
                return

            output = ""
            proc = subprocess.Popen(command_line, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
                                os.write(sys.__stdout__.fileno(), data)
                            output += data.decode('utf-8', 'replace')
                    elif fd == stderr_fd:
                        data = os.read(fd, 1024)
                        if not data:
                            rset.remove(stderr_fd)
                            proc.stderr.close()
                        elif not quiet or self.verbose:
                            os.write(sys.__stderr__.fileno(), data)
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

    def upload(self, sources, dest, relative_dir="."):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        assert sources and dest
        assert self.ssh_address

        if not self.__ssh_direct_opt_var():
            self._ensure_ssh_master()

        cmd = [
            "scp", "-B",
            "-r", "-p",
            "-P", str(self.ssh_port),
            *self.ssh_default_opts,
            *self.__execution_opts(),
        ]
        if not self.verbose:
            cmd += ["-q"]

        def relative_to_test_dir(path):
            return os.path.join(relative_dir, path)
        cmd += map(relative_to_test_dir, sources)

        cmd += ["%s@[%s]:%s" % (self.ssh_user, self.ssh_address, dest)]

        self.message("Uploading", ", ".join(sources))
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download(self, source, dest, relative_dir="."):
        """Download a file from the test machine.
        """
        assert source and dest
        assert self.ssh_address

        if not self.__ssh_direct_opt_var():
            self._ensure_ssh_master()
        dest = os.path.join(relative_dir, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            *self.ssh_default_opts,
            *self.__execution_opts(),
        ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += ["%s@[%s]:%s" % (self.ssh_user, self.ssh_address, source), dest]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download_dir(self, source, dest, relative_dir="."):
        """Download a directory from the test machine, recursively.
        """
        assert source and dest
        assert self.ssh_address

        if not self.__ssh_direct_opt_var():
            self._ensure_ssh_master()
        dest = os.path.join(relative_dir, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            *self.ssh_default_opts,
            *self.__execution_opts(),
            "-r",
        ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += ["%s@[%s]:%s" % (self.ssh_user, self.ssh_address, source), dest]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        try:
            subprocess.check_call(cmd)
            target = os.path.join(dest, os.path.basename(source))
            if os.path.exists(target):
                subprocess.check_call(["find", target, "-type", "f", "-exec", "chmod", "0644", "{}", ";"])
        except:
            self.message("Error while downloading directory '{0}'".format(source))

    def write(self, dest, content, append=False, owner=None, perm=None):
        """Write a file into the test machine

        Arguments:
            content: Raw data to write to file
            dest: The file name in the machine to write to
            append: If True, append to existing file instead of replacing it
            owner: If set, call chown on the file with the given owner string
            perm: Optional file permission as chmod shell string (e.g. "0600")
        """
        assert dest
        assert self.ssh_address

        cmd = "cat %s '%s'" % (append and '>>' or '>', dest)
        if owner:
            cmd += " && chown '%s' '%s'" % (owner, dest)
        if perm:
            cmd += " && chmod '%s' '%s'" % (perm, dest)
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
