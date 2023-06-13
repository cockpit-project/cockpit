import sys

import pytest

from cockpit._vendor import ferny
from cockpit._vendor.bei import bootloader
from cockpit.beipack import BridgeBeibootHelper
from cockpit.peer import Peer
from cockpit.router import Router

from .mocktransport import settle_down


class BeibootPeer(Peer):
    async def do_connect_transport(self) -> None:
        helper = BridgeBeibootHelper(self)
        agent = ferny.InteractionAgent(helper)
        transport = await self.spawn([sys.executable, '-iq'], env=[], stderr=agent)
        transport.write(bootloader.make_bootloader(helper.steps, gadgets=ferny.BEIBOOT_GADGETS).encode())
        await agent.communicate()


@pytest.mark.asyncio
async def test_bridge_beiboot():
    # Try to beiboot a copy of the bridge and read its init message
    peer = BeibootPeer(Router([]))
    init_msg = await peer.start()
    assert init_msg['version'] == 1
    assert 'packages' not in init_msg
    peer.close()
    await settle_down()
