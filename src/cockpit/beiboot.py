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
import importlib.abc
import logging
import os
import shlex
import socket
from pathlib import Path
from typing import Iterable, NamedTuple, Sequence

from cockpit._vendor import ferny
from cockpit._vendor.bei import bootloader
from cockpit._vendor.systemd_ctypes import run_async

from . import polyfills
from .beipack import BridgeBeibootHelper
from .bridge import setup_logging
from .channel import ChannelRoutingRule
from .channels import PackagesChannel
from .jsonutil import JsonObject, JsonValue, get_str, get_str_or_none
from .packages import Packages, PackagesLoader, patch_libexecdir
from .peer import Peer
from .protocol import CockpitProblem
from .router import Endpoint, Router, RoutingRule
from .transports import StdioTransport

logger = logging.getLogger('cockpit.beiboot')


class Destination(NamedTuple):
    username: 'str | None'
    hostname: str
    port: 'str | None'


def parse_destination(destination: str) -> Destination:
    # Python's `re` lacks the branch reset feature — aka. `(?|` — so doing this
    # with regexp would be difficult.  Let's just open-code it.

    # First: try to split off the username, if specified
    if '@' in destination:
        username, _, destination = destination.partition('@')
    else:
        username = None

    # Second: we need to do something about the port number.  There are two
    # ways this might be encoded.  Start by splitting a possible port number.
    maybe_hostname, _, maybe_port = destination.rpartition(':')
    if maybe_hostname != '' and maybe_port.isdigit():
        # The destination must either have no ':', or be contained in '[' ... ']'
        if maybe_hostname.startswith('[') and maybe_hostname.endswith(']'):
            return Destination(username, maybe_hostname[1:-1], maybe_port)
        elif ':' not in maybe_hostname:
            return Destination(username, maybe_hostname, maybe_port)

    # If that didn't work, then we don't have a port number.
    return Destination(username, destination, None)


def ensure_ferny_askpass() -> Path:
    """Create askpass executable

    We need this for the flatpak: ssh and thus the askpass program run on the host (via flatpak-spawn),
    not the flatpak. Thus we cannot use the shipped cockpit-askpass program.
    """
    loader = ferny.interaction_client.__loader__
    assert isinstance(loader, importlib.abc.ResourceLoader)
    src_data = loader.get_data(ferny.interaction_client.__file__)

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
    file_status: 'dict[str, bool]'

    def check_condition(self, condition: str, value: object) -> bool:
        if condition == 'path-exists':
            assert isinstance(value, str)
            return self.file_status[value]
        elif condition == 'path-not-exists':
            assert isinstance(value, str)
            return not self.file_status[value]
        else:
            raise KeyError

    def __init__(self, file_status: 'dict[str, bool]'):
        self.file_status = file_status


class ExistsHandler(ferny.InteractionHandler):
    commands = ('cockpit.report-exists',)
    router: 'ForwarderRouter'

    def __init__(self, router: 'ForwarderRouter'):
        self.router = router

    async def run_command(self, command: str, args: tuple, fds: 'list[int]', stderr: str) -> None:
        logger.debug('run_command(%r, %r, %r, %r, %r)', self, command, args, fds, stderr)
        assert command == 'cockpit.report-exists'

        file_status, = args
        packages = Packages(loader=ProxyPackagesLoader(file_status))
        self.router.divert_packages(packages)


class AuthorizeResponder(ferny.SshAskpassResponder):
    query_hostkey: bool
    hostkey_info: 'JsonObject | None' = None
    authentication_error: str = 'authentication-failed'
    password_attempts: int = 0

    interactive: bool = False
    user: 'str | None' = None
    password: 'str | None' = None
    router: Router

    def __init__(self, router: Router, authorization: 'None | tuple[str | None, str | None]') -> None:
        self.router = router

        self.query_hostkey = os.environ.get('COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS') == '1'

        if authorization is not None:
            self.user, self.password = authorization
        else:
            self.interactive = True

    async def do_fido_user_presence_prompt(self, prompt: ferny.SshFIDOUserPresencePrompt) -> 'str | None':
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

    async def do_password_prompt(self, prompt: ferny.SshPasswordPrompt) -> 'str | None':
        if self.interactive:
            # we want to remember the password for superuser-init
            self.password = await self.do_prompt(prompt)

        # this impacts the error message that we return in case authentication fails
        self.password_attempts += 1
        return self.password

    async def do_passphrase_prompt(self, prompt: ferny.SshPassphrasePrompt) -> 'str | None':
        if not self.interactive:
            self.authentication_error = f'locked identity: {prompt.filename}'
            return None

        return await self.do_prompt(prompt)

    async def do_prompt(self, prompt: ferny.AskpassPrompt) -> 'str | None':
        # We handle all other prompt types by sending an authorize message.
        # The X-Conversation challenge is for the benefit of the cockpitauth
        # code in cockpit-ws.  The ferny information is interpreted by the
        # bridge, in remote.py.
        attrs: 'dict[str, JsonValue]' = {
            'ferny-type': prompt.__class__.__name__,
            'ferny-attrs': prompt.__dict__,
            'message': prompt.messages + prompt.prompt
        }
        if isinstance(prompt, ferny.SshHostKeyPrompt):
            attrs.update({
                'echo': True,
                'host-key': self.hostkey_info and self.hostkey_info['host-key'],
                'default': prompt.fingerprint,
            })

        message = (prompt.messages + prompt.prompt)
        challenge = 'X-Conversation - ' + base64.b64encode(message.encode()).decode()

        response = await self.router.request_authorization(challenge, attrs)

        b64 = response.removeprefix('X-Conversation -').strip()
        passwd = base64.b64decode(b64.encode()).decode()
        logger.debug('Returning a %d chars password', len(passwd))
        return passwd

    async def do_hostkey(self, reason: str, host: str, algorithm: str, key: str, fingerprint: str) -> bool:
        self.hostkey_info = {'host-key': f'{host} {algorithm} {key}', 'host-fingerprint': fingerprint}
        return False


class ForwarderPeer(Peer):
    stage1: str = ''  # sent on connection_made()
    authorize_handler: AuthorizeResponder

    def __init__(self, rule: RoutingRule, authorize_handler: AuthorizeResponder) -> None:
        self.authorize_handler = authorize_handler
        super().__init__(rule)

    def do_init(self, message: JsonObject) -> None:
        assert isinstance(self.router, ForwarderRouter)
        self.router.peer_sent_init(message)

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == 'authorize':
            # We've disabled this for explicit-superuser bridges, but older
            # bridges don't support that and will ask us anyway.
            return

        super().transport_control_received(command, message)

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        assert isinstance(transport, asyncio.Transport)
        super().connection_made(transport)
        transport.write(self.stage1.encode())

    def do_exception(self, exc: Exception) -> None:
        if isinstance(exc, (OSError, socket.gaierror)):
            raise CockpitProblem('no-host', error='no-host', message=str(exc)) from exc

        elif isinstance(exc, ferny.SshHostKeyError):
            hostkey_info = self.authorize_handler.hostkey_info or {}

            if isinstance(exc, ferny.SshChangedHostKeyError):
                error = 'invalid-hostkey'
            elif self.authorize_handler.query_hostkey:
                error = 'unknown-hostkey'
            else:
                error = 'unknown-host'

            raise CockpitProblem(error, hostkey_info, error=error, auth_method_results={}) from exc

        elif isinstance(exc, ferny.SshAuthenticationError):
            logger.debug('authentication to host failed: %s', exc)

            results = dict.fromkeys(exc.methods, 'not-provided')
            if 'password' in results:
                if self.authorize_handler.password_attempts == 0:
                    results['password'] = 'not-tried'
                else:
                    results['password'] = 'denied'

            raise CockpitProblem('authentication-failed',
                                 error=self.authorize_handler.authentication_error,
                                 auth_method_results=results) from exc

        elif isinstance(exc, ferny.SshError):
            logger.debug('unknown failure connecting to host: %s', exc)
            raise CockpitProblem('internal-error', message=str(exc)) from exc

        super().do_exception(exc)


class ForwarderRoutingRule(RoutingRule):
    peer: 'Peer | None' = None

    def apply_rule(self, options: JsonObject) -> 'Peer | None':
        # forward everything to the peer
        return self.peer


class ForwarderRouter(Router):
    packages: 'Packages | None' = None
    rule: ForwarderRoutingRule
    args: argparse.Namespace
    saw_init: bool = False

    def __init__(self, args: argparse.Namespace) -> None:
        # By default, we route everything to the other host.  We add an extra
        # routing rule for the packages webserver only if we're running the
        # beipack.
        self.rule = ForwarderRoutingRule(self)
        self.args = args
        super().__init__([self.rule])

    def divert_packages(self, packages: Packages) -> None:
        self.packages = packages
        self.routing_rules.insert(0, ChannelRoutingRule(self, [PackagesChannel]))

    def set_peer(self, peer: Peer) -> None:
        self.rule.peer = peer

    def shutdown_endpoint(self, endpoint: Endpoint, _msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> None:
        super().shutdown_endpoint(endpoint, _msg, **kwargs)
        if isinstance(endpoint, ForwarderPeer) and self.transport is not None:
            if not endpoint.saw_init:
                self.write_control(_msg, **kwargs, command='init')
            self.transport.close()

    def do_send_init(self):
        if self.args.interactive:
            # If we're in interactive mode, we can start the peer immediately.
            setup_peer(self, self.args, None)
        else:
            # Otherwise, ask for the initial authorization information.
            self.write_control(command='authorize', cookie='*', challenge='*')

    # Step 2: when the client replies, create the peer
    def do_authorize(self, message: JsonObject) -> None:
        if get_str(message, 'cookie', None) != '*' or self.rule.peer is not None:
            # If it's not the initial message, normal handling.
            return super().do_authorize(message)

        response = get_str(message, 'response', '')
        if response.startswith('Basic '):
            user, _, password = base64.b64decode(response[6:].encode()).decode().partition(':')
            authorize = (user or None, password or None)
        else:
            authorize = (get_str_or_none(message, 'user', None), get_str_or_none(message, 'password', None))
        setup_peer(self, self.args, authorize)

    # Step 3: peer sends its init message.  We patch it and pass it along.
    def peer_sent_init(self, message: JsonObject) -> None:
        # only patch the packages line if we are in beiboot mode
        if self.packages is not None:
            message = dict(message, packages=dict.fromkeys(self.packages.packages))

        self.write_control(message)
        self.saw_init = True

    # Step 4: we get the init message from the user.  Pass it along.
    def do_init(self, message: JsonObject) -> None:
        assert self.saw_init  # `cockpit.print` can easily violate this — make it obvious
        assert self.rule.peer is not None

        self.rule.peer.write_control(message)
        self.rule.peer.saw_init = True
        self.rule.peer.thaw_endpoint()


def get_argv_envp(
        args: argparse.Namespace, authorize_handler: AuthorizeResponder
) -> 'tuple[tuple[str, ...], dict[str, str]]':
    # We want to run a python interpreter somewhere...

    cmd: tuple[str, ...]
    env: dict[str, str] = {}

    # either we're going to beiboot or we'll just run the bridge directly
    if args.never:
        cmd = ('cockpit-bridge',)
    else:
        cmd = ('python3', '-ic', '# cockpit-bridge')

    # We now perform a series of transformations based on our execution context
    # (in flatpak or not) and what was requested (remote host, or local).
    in_flatpak = os.path.exists('/.flatpak-info')

    # We take 'localhost' to mean 'spawn the bridge locally'
    if args.destination.hostname != 'localhost':
        if in_flatpak:
            # we run ssh and thus the helper on the host, always use the xdg-cache helper
            ssh_askpass = ensure_ferny_askpass()
        else:
            # outside of the flatpak we expect cockpit-ws and thus an installed helper
            askpass = patch_libexecdir('${libexecdir}/cockpit-askpass')
            assert isinstance(askpass, str)
            ssh_askpass = Path(askpass)

            if not ssh_askpass.exists():
                # Last ditch: try finding the in-tree version.
                interaction_client_path = ferny.interaction_client.__file__
                if os.access(interaction_client_path, os.X_OK):
                    ssh_askpass = Path(interaction_client_path)
                else:
                    logger.error("Could not find cockpit-askpass helper at %r", askpass)

        # Forcing DISPLAY to 'x' enables an equivalent heuristic in older
        # versions of OpenSSH which don't support SSH_ASKPASS_REQUIRE.
        env.update(SSH_ASKPASS=str(ssh_askpass),
                   DISPLAY='x',
                   SSH_ASKPASS_REQUIRE='force')

        ssh_cmd = shlex.split(os.environ.get('SSH_CMD', 'ssh'))

        if not args.interactive:
            ssh_cmd.extend(('-o', 'NumberOfPasswordPrompts=1'))

            if authorize_handler.password is None:
                ssh_cmd.extend(('-o', 'PasswordAuthentication=no'))

            if authorize_handler.query_hostkey:
                ssh_cmd.extend(('-o', f'KnownHostsCommand={ssh_askpass} %I %H %t %K %f'))
            else:
                ssh_cmd.extend(('-o', 'StrictHostKeyChecking=yes'))

        # we prefer the user found in the authorization blob, if provided
        if authorize_handler.user is not None:
            ssh_cmd.extend(('-l', authorize_handler.user))
        elif args.destination.username:
            ssh_cmd.extend(('-l', args.destination.username))

        if args.destination.port:
            ssh_cmd.extend(('-p', args.destination.port))

        ssh_cmd.append(args.destination.hostname)

        cmd = (*ssh_cmd, ' '.join(shlex.quote(arg) for arg in cmd))

    # Running in flatpak?  Wrap command with flatpak-spawn --host
    if in_flatpak:
        cmd = ('flatpak-spawn', '--host',
               *(f'--env={k}={v}' for k, v in env.items()),
               *cmd)
        env.clear()

    return cmd, env


def create_stage1(beiboot_handler: BridgeBeibootHelper, *, never: bool, always: bool) -> str:
    if never:
        # don't need a bootloader if we're not beibooting
        return ''

    # Set up the beiboot stage1 bootloader.
    beiboot_steps: 'list[tuple[str, Sequence[object]]]' = []

    # Unless --always was given, first step is to try running /usr/bin/cockpit-bridge
    if not always:
        beiboot_steps.append(('try_exec', (['cockpit-bridge'],)))

    beiboot_steps.extend([
        # If we didn't run /usr/bin/cockpit-bridge, our first step is to check
        # which files exist on the remote in order to make decisions about
        # which packages will be served locally.  The result of that lands in
        # our ExistsHandler, which will also set up the routing rule for local
        # packages handling.
        ('report_exists', (list(get_interesting_files()),)),

        # This is the main step of requesting and booting the bridge beipack.xz.
        *beiboot_handler.steps,
    ])
    beiboot_gadgets = {
        "report_exists": r"""
        import os
        def report_exists(files):
            command('cockpit.report-exists', {name: os.path.exists(name) for name in files})
        """,
        **ferny.BEIBOOT_GADGETS
    }

    return bootloader.make_bootloader(beiboot_steps, gadgets=beiboot_gadgets)


def setup_peer(
        router: ForwarderRouter, args: argparse.Namespace, authorization: 'None | tuple[str | None, str | None]',
) -> None:

    # Responds to askpass questions and collects hostkey information
    authorize_handler = AuthorizeResponder(router, authorization)
    peer = ForwarderPeer(router.rule, authorize_handler)
    router.set_peer(peer)

    # We implement our own handler for reporting the existence of files.
    exists_handler = ExistsHandler(router)

    # This is our handler to send the beipack over, if it gets requested.
    beiboot_handler = BridgeBeibootHelper(peer)

    # Setup the stage1 bootloader — will be sent from Peer.connection_made().
    peer.stage1 = create_stage1(beiboot_handler, never=args.never, always=args.always)

    # This is where we actually fork and spawn the peer...
    handlers = [
        authorize_handler,
        beiboot_handler,
        exists_handler,
    ]

    # broken out because it's complex
    cmd, env = get_argv_envp(args, authorize_handler)
    transport, peer = ferny.FernyTransport.spawn(lambda: peer, cmd, env=dict(os.environ, **env),
                                                 interaction_handlers=handlers, is_ssh=True)

    peer.transport = transport


async def run(args: argparse.Namespace) -> None:
    router = ForwarderRouter(args)

    # Start the router side talking on stdin/stdout.
    logger.debug("Hi. How are you today?")
    StdioTransport(asyncio.get_running_loop(), router)

    # From here on out, there are a lot of things that can happen "next" — the
    # normal process of exchanging `init` messages, but also various
    # authentication interactions, error conditions, early exits, etc.
    # Therefore we switch to an asynchronous mode of execution that deals with
    # events as they occur.
    await router.communicate()


def main() -> None:
    polyfills.install()

    parser = argparse.ArgumentParser(description='cockpit-beiboot is run automatically inside of a Cockpit session.')

    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument('--never', action='store_true', help="Never try to beiboot cockpit-bridge")
    group.add_argument('--always', action='store_true', help="Never try to run cockpit-bridge from the system")

    parser.add_argument('--interactive', action='store_true', help="Perform interactive authentication")
    parser.add_argument('--debug', action='store_true', help="Enable all debugging output (warning: loud)")
    parser.add_argument('destination', type=parse_destination,
                        help="Name of the remote host to connect to, or 'localhost'")
    args = parser.parse_args()

    setup_logging(debug=args.debug)
    logger.debug('Understood args: %r', args)
    logger.debug('Environment: %r', os.environ)

    run_async(run(args), debug=args.debug)


if __name__ == '__main__':
    main()
