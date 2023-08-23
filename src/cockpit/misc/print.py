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

import argparse
import ast
import json
import os
import pydoc
import readline  # noqa: F401, side-effecting import
import shlex
import sys
import time
from typing import Any, BinaryIO, Iterable, Optional


class Printer:
    output: BinaryIO
    last_channel: int

    def __init__(self, output=None):
        self.last_channel = 0
        self.output = output or sys.stdout.buffer

    def data(self, channel: str, /, data: bytes) -> None:
        """Send raw data (byte string) on a channel"""
        message = channel.encode('ascii') + b'\n' + data
        frame = str(len(message)).encode('ascii') + b'\n' + message
        self.output.write(frame)
        self.output.flush()

    def json(self, channel: str, /, **kwargs: object) -> None:
        """Send a json message (built from **kwargs) on a channel"""
        self.data(channel, json.dumps(kwargs, indent=2).encode('utf-8') + b'\n')

    def control(self, command: str, **kwargs: Any) -> None:
        """Send a control message, build from **kwargs"""
        self.json('', command=command, **kwargs)

    def init(self, host: str = 'localhost', version: int = 1, **kwargs: Any) -> None:
        """Send init.  This is normally done automatically, but you can override it."""
        self.control('init', host=host, version=version, **kwargs)

    def open(self, payload: str, channel: Optional[str] = None, **kwargs: Any) -> str:
        """Opens a channel for the named payload.  A channel name is generated if not provided."""
        if channel is None:
            self.last_channel += 1
            channel = f'ch{self.last_channel}'

        self.control('open', channel=channel, payload=payload, **kwargs)
        return channel

    def done(self, channel: Optional[str] = None, **kwargs: Any) -> None:
        """Sends a done command on the named channel, or the last opened channel."""
        if channel is None:
            channel = f'ch{self.last_channel}'
        self.control('done', channel=channel, **kwargs)

    def http(self,
             path: str,
             *,
             method: str = 'GET',
             done: bool = True,
             channel: Optional[str] = None,
             **kwargs: Any) -> None:
        """Open a http1-stream channel.  Sends a 'done' as well, unless done=False."""
        self.open('http-stream1', path=path, method=method, channel=channel, **kwargs)
        if done:
            self.done()

    def packages(self, path: str,
                 headers: Optional[dict[str, str]] = None,
                 channel: Optional[str] = None,
                 **kwargs: Any) -> None:
        """Request a file from the internal packages webserver"""
        # The packages webserver requires these for computing the content security policy
        our_headers = {'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'localhost'}
        if headers is not None:
            our_headers.update(headers)
        # mypy is right: kwargs could include  `done` or `method`, but codifying that is really awkward
        self.http(path, internal='packages', channel=channel, headers=our_headers, **kwargs)  # type: ignore[arg-type]

    def spawn(self, *args: str, channel: Optional[str] = None, **kwargs: object) -> None:
        """Open a stream channel with a spawned command"""
        self.open('stream', spawn=args, channel=channel, **kwargs)

    def dbus_open(self, channel: Optional[str] = None, bus: str = 'internal', **kwargs: Any) -> str:
        return self.open('dbus-json3', channel=channel, bus=bus, **kwargs)

    def dbus_call(
        self, *args: object, channel: Optional[str] = None, bus: str = 'internal', **kwargs: Any
    ) -> None:
        if channel is None:
            channel = self.dbus_open(bus=bus, **kwargs)
        self.json(channel, call=[*args], id=1)

    def packages_reload(self, channel: Optional[str] = None) -> None:
        self.dbus_call('/packages', 'cockpit.Packages', 'Reload', [], channel=channel)

    def help(self) -> None:
        """Show help"""
        sys.stderr.write("""
Prints cockpit frames according to given commands.

Each method has a name (the first argument) and 0 or more positional and keyword arguments.

Positional arguments are given as commandline arguments in the usual way.  They
will be parsed as Python expressions.  If that fails, and the argument looks
"simple" they will be treated as literal strings.  This is helpful to avoid
having to double-escape simple things.

Keyword arguments are specified by prepending a positional argument with an
identifier and an `=` character.

A single ; or : character allows specifying multiple commands.

Supported methods are as follows:

""")

        doc = pydoc.TextDoc()
        for name, value in Printer.__dict__.items():
            if name.startswith('_'):
                continue
            sys.stderr.write(doc.indent(doc.docroutine(value), '  ') + '\n')

        sys.stderr.write("""Some examples:

  python3 -m cockpit.misc.print --no-init open null

  python3 -m cockpit.misc.print open echo channel=x : data x "b'foo'" : done x | python3 -m cockpit.bridge

  python3 -m cockpit.misc.print packages /manifests.js | python3 -m cockpit.bridge

  ... etc

""")

    def wait(self) -> None:
        """Wait for [Enter] on stdin"""
        sys.stdin.readline()

    def sleep(self, seconds: float) -> None:
        """Sleep for a number of seconds"""
        time.sleep(seconds)


def split_commands(args: list[str]) -> Iterable[list[str]]:
    """split args on ':' items, yielding sub-lists"""
    while ':' in args:
        colon = args.index(':')
        yield args[:colon]
        args = args[colon + 1:]
    yield args


def get_commands(args: list[str]) -> Iterable[list[str]]:
    """splits args on ':', yielding sub-lists and replacing '-' with input from stdin"""
    for command in split_commands(args):
        if command == ['-']:
            # read commands from stdin
            try:
                while True:
                    # try to print the prompt after output from the bridge
                    time.sleep(0.2)
                    yield shlex.split(input('cockpit.print> '))
            except EOFError:
                pass
        else:
            yield command


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-wait', action='store_true',
                        help="Don't for [Enter] after printing, before exit")
    parser.add_argument('--no-init', action='store_true',
                        help="Don't send an init message")
    parser.add_argument('command', nargs='*', default=['-'],
                        help="The command to invoke: try 'help'")
    args = parser.parse_args()

    # "The Usual Tricks"
    # Our original stdout is where we need to send our messages, but in case we
    # use readline, we need stdout to be attached to the user's terminal.  We
    # do this by duping the pipe and reopening stdout from /dev/tty.
    output = open(os.dup(1), 'wb')
    os.dup2(os.open('/dev/tty', os.O_WRONLY), 1)

    printer = Printer(output)

    need_init = not args.no_init

    # Invoke the commands
    for command in get_commands(args.command):
        if need_init and command[0] not in ['help', 'init']:
            printer.init()
        need_init = False

        positional: list[object] = []
        kwargs: dict[str, object] = {}
        func = getattr(printer, command[0])

        for param in command[1:]:
            left, eq, right = param.partition('=')

            # Does that look like a kwarg?
            if eq and left.replace('-', '_').isidentifier():
                key = left
                param = right
            else:
                key = None

            # Parse the value, else take it as a literal if it's simple enough
            try:
                value = ast.literal_eval(param)
            except (SyntaxError, ValueError):
                if any(c in param for c in '\'":;<>,|\\(){}[]`~!@#$%^&*='):
                    raise
                else:
                    value = param

            if key is not None:
                kwargs[key] = value
            else:
                positional.append(value)

        func(*positional, **kwargs)


if __name__ == '__main__':
    main()
