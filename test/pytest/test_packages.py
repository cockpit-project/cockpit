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
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import json
import os
import tempfile
import unittest
from pathlib import Path

import pytest

import cockpit.config
from cockpit.packages import parse_accept_language, Packages


@pytest.mark.parametrize("test_input,expected", [
                         ('de-at, zh-CH, en,', ['de-at', 'zh-ch', 'en']),
                         ('es-es, nl;q=0.8, fr;q=0.9', ['es-es', 'fr', 'nl']),
                         ('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5', ['fr-ch', 'fr', 'en', 'de', '*'])])
def test_parse_accept_language(test_input, expected):
    assert parse_accept_language({'Accept-Language': test_input}) == expected


class TestPackages(unittest.TestCase):
    def setUp(self):
        self.workdir = Path(tempfile.mkdtemp(prefix='cockpit-packages-test-'))
        self.package_dir = self.workdir / 'cockpit'
        self.package_dir.mkdir()
        os.environ['XDG_DATA_DIRS'] = str(self.workdir)

        (self.package_dir / 'basic').mkdir()
        (self.package_dir / 'basic' / 'manifest.json').write_text(
            '{"description": "standard package", "requires": {"cockpit": "42"}}')

    def test_basic(self):
        packages = Packages()
        assert len(packages.packages) == 1
        assert packages.packages['basic'].name == 'basic'
        assert packages.packages['basic'].manifest['description'] == 'standard package'
        assert packages.packages['basic'].manifest['requires'] == {'cockpit': "42"}
        assert packages.packages['basic'].priority == 1

        assert packages.manifests == '{"basic": {"description": "standard package", "requires": {"cockpit": "42"}}}'

    def test_override_etc(self):
        config_dir = self.workdir / 'config'
        config_dir.mkdir()
        orig_etc_config = cockpit.config.ETC_COCKPIT
        cockpit.config.ETC_COCKPIT = config_dir

        def cleanUp():
            cockpit.config.ETC_COCKPIT = orig_etc_config
        self.addCleanup(cleanUp)

        (config_dir / 'basic.override.json').write_text('{"description": "overridden package"}')

        packages = Packages()
        assert len(packages.packages) == 1
        # original attributes
        assert packages.packages['basic'].name == 'basic'
        assert packages.packages['basic'].manifest['requires'] == {'cockpit': '42'}
        assert packages.packages['basic'].priority == 1
        # overridden attributes
        assert packages.packages['basic'].manifest['description'] == 'overridden package'

        assert packages.manifests == '{"basic": {"description": "overridden package", "requires": {"cockpit": "42"}}}'

    def test_priority(self):
        (self.package_dir / 'vip').mkdir()
        (self.package_dir / 'vip' / 'manifest.json').write_text('{"name": "basic", "description": "VIP", "priority": 100}')
        (self.package_dir / 'guest').mkdir()
        (self.package_dir / 'guest' / 'manifest.json').write_text('{"description": "Guest"}')

        packages = Packages()
        assert len(packages.packages) == 2
        assert packages.packages['basic'].name == 'basic'
        assert packages.packages['basic'].priority == 100
        assert packages.packages['basic'].manifest['description'] == 'VIP'
        assert packages.packages['guest'].name == 'guest'
        assert packages.packages['guest'].priority == 1

        parsed = json.loads(packages.manifests)
        assert parsed['basic'] == {'name': 'basic', 'description': 'VIP', 'priority': 100}
        assert parsed['guest'] == {'description': 'Guest'}
