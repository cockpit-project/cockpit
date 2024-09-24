# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import argparse
import asyncio
import base64
import importlib.resources
import logging
import os
import re
import shlex
import tempfile
import time
from pathlib import Path
from typing import Dict, Iterable, Literal, Optional, Sequence

from cockpit import polyfills
from cockpit._vendor import ferny
from cockpit._vendor.bei import bootloader
from cockpit.beipack import BridgeBeibootHelper
from cockpit.bridge import setup_logging
from cockpit.channel import ChannelRoutingRule
from cockpit.channels import PackagesChannel
from cockpit.jsonutil import JsonObject, get_str
from cockpit.packages import Packages, PackagesLoader, patch_libexecdir
from cockpit.peer import Peer
from cockpit.protocol import CockpitProblem, CockpitProtocolError
from cockpit.router import Router, RoutingRule
from cockpit.transports import StdioTransport

logger = logging.getLogger('cockpit.beiboot')


def ensure_ferny_askpass() -> Path:
    """Create askpass executable

    We need this for the flatpak: ssh and thus the askpass program run on the host (via flatpak-spawn),
    not the flatpak. Thus we cannot use the shipped cockpit-askpass program.
    """
    src_path = importlib.resources.files(ferny.__name__) / 'interaction_client.py'
    src_data = src_path.read_bytes()

    # Create the file in $XDG_CACHE_HOME, one of the few locations that a flatpak can write to
    xdg_cache_home = os.environ.get('XDG_CACHE_HOME')
    if xdg_cache_home is None:
        xdg_cache_home = os.path.expanduser('~/.cache')
    os.makedirs(xdg_cache_home, exist_ok=True)
    dest_path = Path(xdg_cache_home, 'cockpit-client-askpass')

    logger.debug("Checking if %s exists...", dest_path)

    # Check first to see if we already wrote the current version
    try:
        if dest_path.read_bytes() != src_data:
            logger.debug("  ... it exists but is not the same version...")
            raise ValueError
        if not dest_path.stat().st_mode & 0o100:
            logger.debug("  ... it has the correct contents, but is not executable...")
            raise ValueError
    except (FileNotFoundError, ValueError):
        logger.debug("  ... writing contents.")
        dest_path.write_bytes(src_data)
        dest_path.chmod(0o700)

    return dest_path


def get_interesting_files() -> Iterable[str]:
    for manifest in PackagesLoader.load_manifests():
        for condition in manifest.conditions:
            if condition.name in ('path-exists', 'path-not-exists') and isinstance(condition.value, str):
                yield condition.value


class ProxyPackagesLoader(PackagesLoader):
    file_status: Dict[str, bool]

    def check_condition(self, condition: str, value: object) -> bool:
        assert isinstance(value, str)
        assert value in self.file_status

        if condition == 'path-exists':
            return self.file_status[value]
        elif condition == 'path-not-exists':
            return not self.file_status[value]
        else:
            raise KeyError

    def __init__(self, file_status: Dict[str, bool]):
        self.file_status = file_status


BEIBOOT_GADGETS = {
    "report_exists": r"""
    import os
    def report_exists(files):
        command('cockpit.report-exists', {name: os.path.exists(name) for name in files})
    """,
    "force_exec": r"""
    import os
    def force_exec(argv):
        try:
            os.execvp(argv[0], argv)
        except OSError as e:
            command('cockpit.fail-no-cockpit', str(e))
    """,
    **ferny.BEIBOOT_GADGETS
}


class DefaultRoutingRule(RoutingRule):
    peer: 'Peer | None'

    def __init__(self, router: Router):
        super().__init__(router)

    def apply_rule(self, options: JsonObject) -> 'Peer | None':
        return self.peer

    def shutdown(self) -> None:
        if self.peer is not None:
            self.peer.close()


class AuthorizeResponder(ferny.AskpassHandler):
    commands = ('ferny.askpass', 'cockpit.report-exists', 'cockpit.fail-no-cockpit')
    router: Router

    def __init__(self, router: Router, basic_password: Optional[str]):
        self.router = router
        self.basic_password = basic_password
        self.have_basic_password = basic_password is not None

    async def do_askpass(self, messages: str, prompt: str, hint: str) -> Optional[str]:
        logger.debug("AuthorizeResponder: prompt %r, messages %r, hint %r", prompt, messages, hint)

        if self.have_basic_password and 'password:' in prompt.lower():
            # only the first prompt is the current password (with NumberOfPasswordPrompts=1); further prompts
            # are e.g. forced/expired PAM password changes
            if self.basic_password is not None:
                logger.debug("AuthorizeResponder: sending Basic auth password for prompt %r", prompt)
                reply = self.basic_password
                self.basic_password = None
                return reply

        if hint == 'none':
            # We have three problems here:
            #
            #   - we have no way to present a message on the login
            #     screen without presenting a prompt and a button
            #   - the login screen will not try to repost the login
            #     request because it doesn't understand that we are not
            #     waiting on input, which means that it won't notice
            #     that we've logged in successfully
            #   - cockpit-ws has an issue where if we retry the request
            #     again after login succeeded then it won't forward the
            #     init message to the client, stalling the login.  This
            #     is a race and can't be fixed without -ws changes.
            #
            # Let's avoid all of that by just showing nothing.
            return None

        # FIXME: is this a host key prompt? This should be handled more elegantly,
        # see https://github.com/cockpit-project/cockpit/pull/19668
        fp_match = re.search(r'\n(\w+) key fingerprint is ([^.]+)\.', prompt)
        # let ssh resolve aliases, don't use our original "destination"
        host_match = re.search(r"authenticity of host '([^ ]+) ", prompt)
        args = {}
        if fp_match and host_match:
            hostname = host_match.group(1)
            # common case: don't ask for localhost's host key
            if hostname == '127.0.0.1':
                logger.debug('auto-accepting fingerprint for 127.0.0.1: %s', host_match)
                return 'yes'

            # login.js do_hostkey_verification() expects host-key to be "hostname keytype key"
            # we don't have access to the full key yet (that will be sent later as `login-data` challenge response),
            # so just send a placeholder
            args['host-key'] = f'{hostname} {fp_match.group(1)} login-data'
            # very oddly named, login.js do_hostkey_verification() expects the fingerprint here for user confirmation
            args['default'] = fp_match.group(2)

        challenge_id = f'{os.getpid()}-{time.time()}'
        challenge_prefix = f'X-Conversation {challenge_id}'
        challenge = challenge_prefix + ' ' + base64.b64encode(prompt.encode()).decode()
        response = await self.router.request_authorization(challenge,
                                                           timeout=None,
                                                           messages=messages,
                                                           prompt=prompt,
                                                           hint=hint,
                                                           echo=False,
                                                           **args)

        if not response.startswith(challenge_prefix):
            raise CockpitProtocolError(
                f"AuthorizeResponder: response {response} does not match challenge {challenge_prefix}")
        b64 = response.removeprefix(challenge_prefix).strip()
        response = base64.b64decode(b64.encode()).decode()
        logger.debug('Returning a %d chars response', len(response))
        return response

    async def do_custom_command(self, command: str, args: tuple, fds: list[int], stderr: str) -> None:
        logger.debug('Got ferny command %s %s %s', command, args, stderr)

        if command == 'cockpit.report-exists':
            file_status, = args
            # FIXME: evil duck typing here -- this is a half-way Bridge
            self.router.packages = Packages(loader=ProxyPackagesLoader(file_status))  # type: ignore[attr-defined]
            self.router.routing_rules.insert(0, ChannelRoutingRule(self.router, [PackagesChannel]))

        if command == 'cockpit.fail-no-cockpit':
            raise CockpitProblem('no-cockpit', message=args[0])


def python_interpreter(comment: str) -> tuple[Sequence[str], Sequence[str]]:
    return ('python3', '-ic', f'# {comment}'), ()


def via_ssh(cmd: Sequence[str], dest: str, ssh_askpass: Path, *ssh_opts: str) -> tuple[Sequence[str], Sequence[str]]:
    host, _, port = dest.rpartition(':')
    # catch cases like `host:123` but not cases like `[2001:abcd::1]` or `::1`
    if port.isdigit() and not host.endswith(':'):
        # strip off [] IPv6 brackets
        if host.startswith('[') and host.endswith(']'):
            host = host[1:-1]
        destination = ['-p', port, host]
    else:
        destination = [dest]

    return (
        'ssh', *ssh_opts, *destination, shlex.join(cmd)
    ), (
        f'SSH_ASKPASS={ssh_askpass!s}',
        # DISPLAY=x helps trigger a heuristic in old ssh versions to force them
        # to use askpass.  Newer ones look at SSH_ASKPASS_REQUIRE.
        'DISPLAY=x',
        'SSH_ASKPASS_REQUIRE=force',
    )


def flatpak_spawn(cmd: Sequence[str], env: Sequence[str]) -> tuple[Sequence[str], Sequence[str]]:
    return (
        'flatpak-spawn', '--host',
        *(f'--env={kv}' for kv in env),
        *cmd
    ), (
    )


class SshPeer(Peer):
    mode: 'Literal["always"] | Literal["never"] | Literal["auto"]'

    def __init__(self, router: Router, destination: str, args: argparse.Namespace):
        self.destination = destination
        self.remote_bridge = args.remote_bridge
        self.tmpdir = tempfile.TemporaryDirectory()
        self.known_hosts_file = Path(self.tmpdir.name) / 'user-known-hosts'
        super().__init__(router)

    async def do_connect_transport(self) -> None:
        # Choose your own adventure...
        if os.path.exists('/.flatpak-info'):
            await self.connect_from_flatpak()
        else:
            await self.connect_from_bastion_host()

    async def connect_from_flatpak(self) -> None:
        # We want to run a python interpreter somewhere...
        cmd, env = python_interpreter('cockpit-bridge')

        # Remote host?  Wrap command with SSH
        if self.destination != 'localhost':
            # we run ssh and thus the helper on the host, always use the xdg-cache helper
            cmd, env = via_ssh(cmd, self.destination, ensure_ferny_askpass())

        cmd, env = flatpak_spawn(cmd, env)

        await self.boot(cmd, env)

    async def connect_from_bastion_host(self) -> None:
        basic_password = None
        known_hosts = None
        # right now we open a new ssh connection for each auth attempt
        args = ['-o', 'NumberOfPasswordPrompts=1']

        # do we have user/password (Basic auth) from the login page?
        auth = await self.router.request_authorization_object("*")
        response = get_str(auth, 'response')

        if response.startswith('Basic '):
            decoded = base64.b64decode(response[6:]).decode()
            user_password, _, known_hosts = decoded.partition('\0')
            user, _, basic_password = user_password.partition(':')
            if user:  # this can be empty, i.e. auth is just ":"
                logger.debug("got username %s and password from Basic auth", user)
                args += ['-l', user]

        # We want to run a python interpreter somewhere...
        cmd, env = python_interpreter('cockpit-bridge')

        # outside of the flatpak we expect cockpit-ws and thus an installed helper
        askpass = patch_libexecdir('${libexecdir}/cockpit-askpass')
        assert isinstance(askpass, str)
        ssh_askpass = Path(askpass)
        if not ssh_askpass.exists():
            logger.error("Could not find cockpit-askpass helper at %r", askpass)

        if known_hosts is not None:
            self.known_hosts_file.write_text(known_hosts)
            args += ['-o', f'UserKnownHostsfile={self.known_hosts_file!s}']
        cmd, env = via_ssh(cmd, self.destination, ssh_askpass, *args)

        await self.boot(cmd, env, basic_password)

    async def boot(self, cmd: Sequence[str], env: Sequence[str], basic_password: 'str | None' = None) -> None:
        beiboot_helper = BridgeBeibootHelper(self)
        agent = ferny.InteractionAgent([AuthorizeResponder(self.router, basic_password), beiboot_helper])

        logger.debug("Launching command: cmd=%s env=%s", cmd, env)
        transport = await self.spawn(cmd, env, stderr=agent, start_new_session=True)

        if self.remote_bridge == 'auto':
            exec_cockpit_bridge_steps = [('try_exec', (['cockpit-bridge'],))]
        elif self.remote_bridge == 'always':
            exec_cockpit_bridge_steps = [('force_exec', (['cockpit-bridge'],))]
        else:
            assert self.remote_bridge == 'never'
            exec_cockpit_bridge_steps = []

        # Send the first-stage bootloader
        stage1 = bootloader.make_bootloader([
            *exec_cockpit_bridge_steps,
            ('report_exists', [list(get_interesting_files())]),
            *beiboot_helper.steps,
        ], gadgets=BEIBOOT_GADGETS)
        transport.write(stage1.encode())

        # Wait for "init" or error, handling auth and beiboot requests
        await agent.communicate()

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == 'authorize':
            # We've disabled this for explicit-superuser bridges, but older
            # bridges don't support that and will ask us anyway.
            return

        super().transport_control_received(command, message)


class SshBridge(Router):
    packages: Optional[Packages] = None
    ssh_peer: SshPeer

    def __init__(self, args: argparse.Namespace):
        # By default, we route everything to the other host.  We add an extra
        # routing rule for the packages webserver only if we're running the
        # beipack.
        rule = DefaultRoutingRule(self)
        super().__init__([rule])

        # This needs to be created after Router.__init__ is called.
        self.ssh_peer = SshPeer(self, args.destination, args)
        rule.peer = self.ssh_peer

    def do_send_init(self):
        pass  # wait for the peer to do it first

    def do_init(self, message):
        # https://github.com/cockpit-project/cockpit/issues/18927
        #
        # We tell cockpit-ws that we have the explicit-superuser capability and
        # handle it ourselves (just below) by sending `superuser-init-done` and
        # passing {'superuser': False} on to the actual bridge (Python or C).
        if isinstance(message.get('superuser'), dict):
            self.write_control(command='superuser-init-done')
        message['superuser'] = False
        self.ssh_peer.write_control(message)


async def run(args) -> None:
    logger.debug("Hi. How are you today?")

    bridge = SshBridge(args)
    StdioTransport(asyncio.get_running_loop(), bridge)

    try:
        message = dict(await bridge.ssh_peer.start())

        if bridge.ssh_peer.known_hosts_file.exists():
            bridge.write_control(
                command='authorize', challenge='x-login-data', cookie='-', login_data={
                    'known-hosts': bridge.ssh_peer.known_hosts_file.read_text()
                }
            )

        # See comment in do_init() above: we tell cockpit-ws that we support
        # this and then handle it ourselves when we get the init message.
        capabilities = message.setdefault('capabilities', {})
        if not isinstance(capabilities, dict):
            bridge.write_control(command='init', problem='protocol-error', message='capabilities must be a dict')
            return
        assert isinstance(capabilities, dict)  # convince mypy
        capabilities['explicit-superuser'] = True

        # only patch the packages line if we are in beiboot mode
        if bridge.packages:
            message['packages'] = dict.fromkeys(bridge.packages.packages)

        bridge.write_control(message)
        bridge.ssh_peer.thaw_endpoint()
    except ferny.InteractionError as exc:
        error = ferny.ssh_errors.get_exception_for_ssh_stderr(str(exc))
        logger.debug("ferny.InteractionError: %s, interpreted as: %r", exc, error)
        if isinstance(error, ferny.SshAuthenticationError):
            problem = 'authentication-failed'
        elif isinstance(error, ferny.SshChangedHostKeyError):
            problem = 'invalid-hostkey'
        elif isinstance(error, ferny.SshHostKeyError):
            problem = 'unknown-hostkey'
        elif isinstance(error, OSError):
            # usually DNS/socket errors
            problem = 'unknown-host'
        else:
            problem = 'internal-error'
        # if the user confirmed a new SSH host key before the error, tell the UI
        if bridge.ssh_peer.known_hosts_file.exists():
            bridge.write_control(command='init', problem=problem, message=str(error),
                                 known_hosts=bridge.ssh_peer.known_hosts_file.read_text())
        else:
            bridge.write_control(command='init', problem=problem, message=str(error))
        return
    except CockpitProblem as exc:
        logger.debug("CockpitProblem: %s", exc)
        bridge.write_control(exc.attrs, command='init')
        return
    except asyncio.CancelledError:
        logger.debug("Peer bridge got cancelled, exiting")
        return

    logger.debug('Startup done.  Looping until connection closes.')
    try:
        await bridge.communicate()
    except BrokenPipeError:
        # expected if the peer doesn't hang up cleanly
        pass


def main() -> None:
    polyfills.install()

    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--remote-bridge', choices=['auto', 'never', 'always'], default='auto',
                        help="How to run cockpit-bridge from the remote host: auto: if installed (default), "
                        "never: always copy the local one; "
                        "always: fail if not installed")
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('destination', help="Name of the remote host to connect to, or 'localhost'")
    args = parser.parse_args()

    setup_logging(debug=args.debug)

    asyncio.run(run(args), debug=args.debug)


if __name__ == '__main__':
    main()
