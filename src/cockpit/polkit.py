# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
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

import asyncio
import locale
import logging
import os
import pwd
from typing import Dict, List, Sequence, Tuple

from cockpit._vendor.ferny import AskpassHandler
from cockpit._vendor.systemd_ctypes import Variant, bus

# polkit ≥ 127 (Dec 2025) uses a socket-activated helper
HELPER_SOCKET = '/run/polkit/agent-helper.socket'

# older versions use a setuid helper binary;
# that path is valid on at least Debian, Fedora/RHEL, and Arch
HELPER_PATH = '/usr/lib/polkit-1/polkit-agent-helper-1'

AGENT_DBUS_PATH = '/PolkitAgent'

logger = logging.getLogger(__name__)

Identity = Tuple[str, Dict[str, Variant]]


# https://www.freedesktop.org/software/polkit/docs/latest/eggdbus-interface-org.freedesktop.PolicyKit1.AuthenticationAgent.html

# Note that we don't implement the CancelAuthentication() API. pkexec gets called in a way that has no opportunity to
# cancel an ongoing authentication from the pkexec side. On the UI side cancellation is implemented via the standard
# asyncio process mechanism. If we ever need CancelAuthentication(), we could keep a cookie → get_current_task()
# mapping, but that method is not available for Python 3.6 yet.

class org_freedesktop_PolicyKit1_AuthenticationAgent(bus.Object):
    def __init__(self, responder: AskpassHandler):
        super().__init__()
        self.responder = responder
        self.active_authentications = set()

    # confusingly named: this actually does the whole authentication dialog, see docs
    @bus.Interface.Method('', ['s', 's', 's', 'a{ss}', 's', 'a(sa{sv})'])
    async def begin_authentication(self, action_id: str, message: str, icon_name: str,
                                   details: Dict[str, str], cookie: str, identities: Sequence[Identity]) -> None:
        # Track this task so PolkitAgent can wait for completion before unregistering
        task = asyncio.current_task()
        self.active_authentications.add(task)
        try:
            await self._do_begin_authentication(action_id, message, icon_name, details, cookie, identities)
        finally:
            self.active_authentications.discard(task)

    async def _do_begin_authentication(self, action_id: str, message: str, icon_name: str,
                                       details: Dict[str, str], cookie: str, identities: Sequence[Identity]) -> None:
        logger.debug('BeginAuthentication: action %s, message "%s", icon %s, details %s, cookie %s, identities %r',
                     action_id, message, icon_name, details, cookie, identities)
        # only support authentication as ourselves, as we don't yet have the
        # protocol plumbing and UI to select an admin user
        my_uid = os.geteuid()
        for (auth_type, subject) in identities:
            if auth_type == 'unix-user' and 'uid' in subject and subject['uid'].value == my_uid:
                logger.debug('Authentication subject %s matches our uid %d', subject, my_uid)
                break
        else:
            logger.warning('Not supporting authentication as any of %s', identities)
            return

        user_name = pwd.getpwuid(my_uid).pw_name

        # Try socket-activated helper first (polkit >= 127), fall back to legacy setuid helper
        try:
            await self._authenticate_socket(user_name, cookie)
        except OSError:
            # Socket not available, fall back to legacy setuid helper
            logger.debug('Socket helper not available, falling back to legacy helper')
            await self._authenticate_suid_helper(user_name, cookie)

    async def _authenticate_suid_helper(self, user_name: str, cookie: str) -> None:
        """Authenticate using legacy setuid helper binary"""
        logger.debug('Trying legacy polkit helper at %s', HELPER_PATH)
        process = await asyncio.create_subprocess_exec(HELPER_PATH, user_name, cookie,
                                                       stdin=asyncio.subprocess.PIPE,
                                                       stdout=asyncio.subprocess.PIPE)
        assert process.stdin is not None
        assert process.stdout is not None

        try:
            await self._communicate(process.stdin, process.stdout)
        except asyncio.CancelledError:
            logger.debug('Cancelled authentication')
        finally:
            try:
                process.terminate()
            except ProcessLookupError:
                pass  # process already exited and was reaped
            res = await process.wait()
            logger.debug('helper exited with code %i', res)

    async def _authenticate_socket(self, user_name: str, cookie: str) -> None:
        """Authenticate using socket-activated helper (polkit >= 127)"""
        logger.debug('Trying socket-activated polkit helper at %s', HELPER_SOCKET)
        reader, writer = await asyncio.open_unix_connection(HELPER_SOCKET)
        try:
            # Send username and cookie followed by newline
            writer.write(f'{user_name}\n{cookie}\n'.encode())
            await writer.drain()

            await self._communicate(writer, reader)
        except asyncio.CancelledError:
            logger.debug('Cancelled authentication')
        finally:
            writer.close()
            await writer.wait_closed()
            logger.debug('socket connection closed')

    async def _communicate(self, stdin: asyncio.StreamWriter, stdout: asyncio.StreamReader) -> None:
        messages: List[str] = []

        async for line in stdout:
            logger.debug('Read line from helper: %s', line)
            command, _, value = line.strip().decode().partition(' ')

            # usually: PAM_PROMPT_ECHO_OFF Password: \n
            if command.startswith('PAM_PROMPT'):
                # Don't pass this to the UI if it's "Password" (the usual case),
                # so that superuser.py uses the translated default
                if value.startswith('Password'):
                    value = ''

                # flush out accumulated info/error messages
                passwd = await self.responder.do_askpass('\n'.join(messages), value, '')
                messages.clear()
                if passwd is None:
                    logger.debug('got PAM_PROMPT %s, but do_askpass returned None', value)
                    raise asyncio.CancelledError('no password given')
                logger.debug('got PAM_PROMPT %s, do_askpass returned a password', value)
                stdin.write(passwd.encode())
                stdin.write(b'\n')
                del passwd  # don't keep this around longer than necessary
                await stdin.drain()
                logger.debug('got PAM_PROMPT, wrote password to helper')
            elif command in ('PAM_TEXT_INFO', 'PAM_ERROR'):
                messages.append(value)
            elif command == 'SUCCESS':
                logger.debug('Authentication succeeded')
                break
            elif command == 'FAILURE':
                logger.warning('Authentication failed')
                break
            else:
                logger.warning('Unknown line from helper, aborting: %s', line)
                break


class PolkitAgent:
    """Register polkit agent when required

    Use this as a context manager to ensure that the agent gets unregistered again.
    """
    def __init__(self, responder: AskpassHandler):
        self.responder = responder
        self.agent_slot = None

    async def __aenter__(self):
        try:
            self.system_bus = bus.Bus.default_system()
        except OSError as e:
            logger.warning('cannot connect to system bus, not registering polkit agent: %s', e)
            return self

        try:
            # may refine that with a D-Bus call to logind
            self.subject = ('unix-session', {'session-id': Variant(os.environ['XDG_SESSION_ID'], 's')})
        except KeyError:
            logger.debug('XDG_SESSION_ID not set, not registering polkit agent')
            return self

        agent_object = org_freedesktop_PolicyKit1_AuthenticationAgent(self.responder)
        self.agent_slot = self.system_bus.add_object(AGENT_DBUS_PATH, agent_object)

        # register agent
        locale_name = locale.setlocale(locale.LC_MESSAGES, None)
        await self.system_bus.call_method_async(
            'org.freedesktop.PolicyKit1',
            '/org/freedesktop/PolicyKit1/Authority',
            'org.freedesktop.PolicyKit1.Authority',
            'RegisterAuthenticationAgent',
            '(sa{sv})ss',
            self.subject, locale_name, AGENT_DBUS_PATH)
        logger.debug('Registered agent for %r and locale %s', self.subject, locale_name)
        return self

    async def __aexit__(self, _exc_type, _exc_value, _traceback):
        if self.agent_slot:
            # Give any scheduled begin_authentication() tasks a chance to start executing
            # This handles the race where tasks are scheduled but haven't started yet
            for _ in range(10):
                await asyncio.sleep(0)

            # Wait for any active authentications to complete
            if self.agent_object and self.agent_object.active_authentications:
                active_tasks = list(self.agent_object.active_authentications)
                logger.debug('Waiting for %d active authentication(s) to complete', len(active_tasks))
                # Gather all active tasks and wait for them
                await asyncio.gather(*active_tasks, return_exceptions=True)
                logger.debug('All authentications completed')

            await self.system_bus.call_method_async(
                'org.freedesktop.PolicyKit1',
                '/org/freedesktop/PolicyKit1/Authority',
                'org.freedesktop.PolicyKit1.Authority',
                'UnregisterAuthenticationAgent',
                '(sa{sv})s',
                self.subject, AGENT_DBUS_PATH)
            self.agent_slot.cancel()
            logger.debug('Unregistered agent for %r', self.subject)
