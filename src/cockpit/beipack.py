#
# Copyright (C) 2023 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import logging
import lzma
from typing import Sequence, Tuple

from cockpit._vendor import ferny
from cockpit._vendor.bei import beipack

from .data import read_cockpit_data_file
from .peer import Peer, PeerError

logger = logging.getLogger(__name__)


def get_bridge_beipack_xz() -> Tuple[str, bytes]:
    try:
        bridge_beipack_xz = read_cockpit_data_file('cockpit-bridge.beipack.xz')
        logger.debug('Got pre-built cockpit-bridge.beipack.xz')
    except FileNotFoundError:
        logger.debug('Pre-built cockpit-bridge.beipack.xz; building our own.')
        # beipack ourselves
        cockpit_contents = beipack.collect_module('cockpit', recursive=True)
        bridge_beipack = beipack.pack(cockpit_contents, entrypoint='cockpit.bridge:main', args='beipack=True')
        bridge_beipack_xz = lzma.compress(bridge_beipack.encode())
        logger.debug('  ... done!')

    return 'cockpit/data/cockpit-bridge.beipack.xz', bridge_beipack_xz


class BridgeBeibootHelper(ferny.InteractionHandler):
    # ferny.InteractionHandler ClassVar
    commands = ['beiboot.provide', 'beiboot.exc']

    peer: Peer
    payload: bytes
    steps: Sequence[Tuple[str, Sequence[object]]]

    def __init__(self, peer: Peer, args: Sequence[str] = ()) -> None:
        filename, payload = get_bridge_beipack_xz()

        self.peer = peer
        self.payload = payload
        self.steps = (('boot_xz', (filename, len(payload), tuple(args))),)

    async def run_command(self, command: str, args: 'tuple[object, ...]', fds: 'list[int]', stderr: str) -> None:
        logger.debug('Got ferny request %s %s %s %s', command, args, fds, stderr)
        if command == 'beiboot.provide':
            try:
                size, = args
                assert size == len(self.payload)
            except (AssertionError, ValueError) as exc:
                raise PeerError('internal-error', message=f'ferny interaction error {exc!s}') from exc

            assert self.peer.transport is not None
            logger.debug('Writing %d bytes of payload', len(self.payload))
            self.peer.transport.write(self.payload)
        elif command == 'beiboot.exc':
            raise PeerError('internal-error', message=f'Remote exception: {args[0]}')
        else:
            raise PeerError('internal-error', message=f'Unexpected ferny interaction command {command}')
