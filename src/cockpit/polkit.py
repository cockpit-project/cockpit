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

    # confusingly named: this actually does the whole authentication dialog, see docs
    @bus.Interface.Method('', ['s', 's', 's', 'a{ss}', 's', 'a(sa{sv})'])
    async def begin_authentication(self, action_id: str, message: str, icon_name: str,
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
        process = await asyncio.create_subprocess_exec(HELPER_PATH, user_name, cookie,
                                                       stdin=asyncio.subprocess.PIPE,
                                                       stdout=asyncio.subprocess.PIPE)
        try:
            await self._communicate(process)
        except asyncio.CancelledError:
            logger.debug('Cancelled authentication')
            process.terminate()
        finally:
            res = await process.wait()
            logger.debug('helper exited with code %i', res)

    async def _communicate(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdin
        assert process.stdout

        messages: List[str] = []

        async for line in process.stdout:
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
                process.stdin.write(passwd.encode())
                process.stdin.write(b'\n')
                del passwd  # don't keep this around longer than necessary
                await process.stdin.drain()
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
                process.terminate()
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
            await self.system_bus.call_method_async(
                'org.freedesktop.PolicyKit1',
                '/org/freedesktop/PolicyKit1/Authority',
                'org.freedesktop.PolicyKit1.Authority',
                'UnregisterAuthenticationAgent',
                '(sa{sv})s',
                self.subject, AGENT_DBUS_PATH)
            self.agent_slot.cancel()
            logger.debug('Unregistered agent for %r', self.subject)
