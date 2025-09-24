import sys
from pathlib import Path

import pytest

from cockpit._vendor import ferny
from cockpit._vendor.bei import bootloader
from cockpit.beiboot import ProxyPackagesLoader
from cockpit.beipack import BridgeBeibootHelper
from cockpit.packages import Manifest
from cockpit.peer import Peer
from cockpit.router import Router


class BeibootPeer(Peer):
    async def do_connect_transport(self) -> None:
        helper = BridgeBeibootHelper(self)
        agent = ferny.InteractionAgent([helper])
        transport = await self.spawn([sys.executable, '-iq'], env=[], stderr=agent)
        transport.write(bootloader.make_bootloader(helper.steps, gadgets=ferny.BEIBOOT_GADGETS).encode())
        await agent.communicate()


class TestProxyPackagesLoader:
    def test_check_conditions(self) -> None:
        loader = ProxyPackagesLoader({'/existing': True, '/missing': False})

        # Create test manifests with conditions
        manifest_exists = Manifest(Path('/test'), {'conditions': [{'path-exists': '/existing'}]})
        manifest_not_exists = Manifest(Path('/test'), {'conditions': [{'path-not-exists': '/missing'}]})
        manifest_mixed = Manifest(Path('/test'), {
            'conditions': [{'path-exists': '/existing'}, {'path-not-exists': '/missing'}]
        })
        manifest_fails = Manifest(Path('/test'), {'conditions': [{'path-exists': '/missing'}]})
        manifest_any_exists = Manifest(Path('/test'), {
            'conditions': [{'any': [{'path-exists': '/existing'}, {'path-exists': '/missing'}]}]
        })
        manifest_any_fails = Manifest(Path('/test'), {
            'conditions': [{'any': [{'path-exists': '/missing'}, {'path-not-exists': '/existing'}]}]
        })

        assert loader.check_conditions(manifest_exists) is True
        assert loader.check_conditions(manifest_not_exists) is True
        assert loader.check_conditions(manifest_mixed) is True
        assert loader.check_conditions(manifest_fails) is False
        assert loader.check_conditions(manifest_any_exists) is True
        assert loader.check_conditions(manifest_any_fails) is False


@pytest.mark.asyncio
async def test_bridge_beiboot() -> None:
    # Try to beiboot a copy of the bridge and read its init message
    peer = BeibootPeer(Router([]))
    init_msg = await peer.start()
    assert init_msg['version'] == 1
    assert 'packages' not in init_msg
    peer.close()
