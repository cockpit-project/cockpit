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
import pydoc
import sys
import time

from typing import Optional


class Printer:
    last_channel: int

    def __init__(self):
        self.last_channel = 0

    def data(self, channel: str, /, data: bytes) -> None:
        """Send raw data (byte string) on a channel"""
        message = channel.encode('ascii') + b'\n' + data
        frame = str(len(message)).encode('ascii') + b'\n' + message
        sys.stdout.buffer.write(frame)

    def json(self, channel: str, /, **kwargs: object) -> None:
        """Send a json message (built from **kwargs) on a channel"""
        self.data(channel, json.dumps(kwargs, indent=2).encode('utf-8') + b'\n')

    def control(self, command: str, **kwargs: object) -> None:
        """Send a control message, build from **kwargs"""
        self.json('', command=command, **kwargs)

    def init(self, host: str = 'localhost', version: int = 1, **kwargs: object) -> None:
        """Send init.  This is normally done automatically, but you can override it."""
        self.control('init', host=host, version=version, **kwargs)

    def open(self, payload: str, channel: Optional[str] = None, **kwargs: object) -> None:
        """Opens a channel for the named payload.  A channel name is generated if not provided."""
        if channel is None:
            self.last_channel += 1
            channel = str(self.last_channel)

        self.control('open', channel=channel, payload=payload, **kwargs)

    def done(self, channel: Optional[str] = None, **kwargs: object) -> None:
        """Sends a done command on the named channel, or the last opened channel."""
        if channel is None:
            channel = str(self.last_channel)
        self.control('done', channel=channel, **kwargs)

    def http(self, path: str, method: str = 'GET', done: bool = True, **kwargs: object) -> None:
        """Open a http1-stream channel.  Sends a 'done' as well, unless done=False."""
        self.open('http-stream1', path=path, method=method, **kwargs)
        if done:
            self.done()

    def packages(self, path: str, headers: Optional[dict[str, str]] = None, **kwargs: object) -> None:
        """Request a file from the internal packages webserver"""
        # The packages webserver requires these for computing the content security policy
        our_headers = {'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'localhost'}
        if headers is not None:
            our_headers.update(headers)
        self.http(path, internal='packages', headers=our_headers, **kwargs)

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

  python3 -m cockpit.print --no-init open null

  python3 -m cockpit.print open echo channel=x : data x "b'foo'" : done x | python3 -m cockpit.bridge

  python3 -m cockpit.print packages /manifests.js | python3 -m cockpit.bridge

  ... etc

""")

    def wait(self) -> None:
        """Wait for [Enter] on stdin"""
        sys.stdout.flush()
        sys.stdin.readline()

    def sleep(self, seconds: float) -> None:
        """Sleep for a number of seconds"""
        sys.stdout.flush()
        time.sleep(seconds)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-wait', action='store_true',
                        help="Don't for [Enter] after printing, before exit")
    parser.add_argument('--no-init', action='store_true',
                        help="Don't send an init message")
    parser.add_argument('command', nargs='+',
                        help="The command to invoke: try 'help'")
    args = parser.parse_args()

    # Split into multiple commands on ':' or ';'
    this_command = []
    commands = []
    # Treat 'cmd;' or 'cmd:' the same as 'cmd', ';'
    for arg in args.command:
        if arg == ';' or arg == ':':
            if this_command:
                commands.append(this_command)
            this_command = []
        elif arg.endswith(':') or arg.endswith(';'):
            this_command.append(arg[:-1])
            commands.append(this_command)
            this_command = []
        else:
            this_command.append(arg)
    if this_command:  # command not terminated with ';'
        commands.append(this_command)

    printer = Printer()

    # Implicit 'init' unless --no-init or first command is 'help' or 'init'
    if not args.no_init and commands and commands[0] and commands[0][0] not in ['help', 'init']:
        printer.init()

    # Invoke the commands
    for command in commands:
        args: list[object] = []
        kwargs: dict[str, object] = {}
        func = getattr(printer, command[0])

        for param in command[1:]:
            left, _, right = param.rpartition('=')

            # Does that look like a kwarg?
            if left.replace('-', '_').isidentifier():
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
                args.append(value)

        func(*args, **kwargs)


if __name__ == '__main__':
    main()
