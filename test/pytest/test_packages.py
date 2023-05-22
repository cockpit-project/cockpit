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

import pytest

import cockpit.config
from cockpit.packages import Packages, parse_accept_language


@pytest.mark.parametrize(("test_input", "expected"), [
    ('de-at, zh-CH, en,', ['de-at', 'zh-ch', 'en']),
    ('es-es, nl;q=0.8, fr;q=0.9', ['es-es', 'fr', 'nl']),
    ('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5', ['fr-ch', 'fr', 'en', 'de', '*'])
])
def test_parse_accept_language(test_input, expected):
    assert parse_accept_language({'Accept-Language': test_input}) == expected


@pytest.fixture
def pkgdir(tmp_path, monkeypatch):
    monkeypatch.setenv('XDG_DATA_DIRS', str(tmp_path))
    monkeypatch.setenv('XDG_DATA_HOME', '/nonexisting')

    self = tmp_path / 'cockpit'
    self.mkdir()
    make_package(self, 'basic', description="standard package", requires={"cockpit": "42"})
    return self


@pytest.fixture
def confdir(tmp_path, monkeypatch):
    monkeypatch.setattr(cockpit.config, 'ETC_COCKPIT', tmp_path)
    return tmp_path


def make_package(pkgdir, dirname: str, **kwargs: object) -> None:
    (pkgdir / dirname).mkdir()
    with (pkgdir / dirname / 'manifest.json').open('w') as file:
        json.dump(kwargs, file, indent=2)


def test_basic(pkgdir):
    packages = Packages()
    assert len(packages.packages) == 1
    assert packages.packages['basic'].name == 'basic'
    assert packages.packages['basic'].manifest['description'] == 'standard package'
    assert packages.packages['basic'].manifest['requires'] == {'cockpit': "42"}
    assert packages.packages['basic'].priority == 1

    assert packages.manifests == '{"basic": {"description": "standard package", "requires": {"cockpit": "42"}}}'


def test_override_etc(pkgdir, confdir):
    (confdir / 'basic.override.json').write_text('{"description": "overridden package", "priority": 5}')

    packages = Packages()
    assert len(packages.packages) == 1
    # original attributes
    assert packages.packages['basic'].name == 'basic'
    assert packages.packages['basic'].manifest['requires'] == {'cockpit': '42'}
    # overridden attributes
    assert packages.packages['basic'].manifest['description'] == 'overridden package'
    assert packages.packages['basic'].priority == 5

    assert json.loads(packages.manifests) == {
        'basic': {
            'description': 'overridden package',
            'requires': {'cockpit': '42'},
            'priority': 5,
        }
    }


def test_priority(pkgdir):
    make_package(pkgdir, 'vip', name='basic', description='VIP', priority=100)
    make_package(pkgdir, 'guest', description='Guest')

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


def test_conditions(pkgdir):
    make_package(pkgdir, 'empty', conditions=[])

    # path-exists only
    make_package(pkgdir, 'exists-1-yes', conditions=[{'path-exists': '/usr'}])
    make_package(pkgdir, 'exists-1-no', conditions=[{'path-exists': '/nonexisting'}])
    make_package(pkgdir, 'exists-2-yes', conditions=[{"path-exists": "/usr"},
                                                     {"path-exists": "/bin/sh"}])
    make_package(pkgdir, 'exists-2-no', conditions=[{"path-exists": "/usr"},
                                                    {"path-exists": "/nonexisting"}])

    # path-not-exists only
    make_package(pkgdir, 'notexists-1-yes', conditions=[{"path-not-exists": "/nonexisting"}])
    make_package(pkgdir, 'notexists-1-no', conditions=[{"path-not-exists": "/usr"}])
    make_package(pkgdir, 'notexists-2-yes', conditions=[{"path-not-exists": "/nonexisting"},
                                                        {"path-not-exists": "/obscure"}])
    make_package(pkgdir, 'notexists-2-no', conditions=[{"path-not-exists": "/nonexisting"},
                                                       {"path-not-exists": "/usr"}])

    # mixed
    make_package(pkgdir, 'mixed-yes', conditions=[{"path-exists": "/usr"},
                                                  {"path-not-exists": "/nonexisting"}])
    make_package(pkgdir, 'mixed-no', conditions=[{"path-exists": "/nonexisting"},
                                                 {"path-not-exists": "/obscure"}])

    packages = Packages()
    assert set(packages.packages.keys()) == {
        'basic', 'empty', 'exists-1-yes', 'exists-2-yes', 'notexists-1-yes', 'notexists-2-yes', 'mixed-yes'
    }


def test_conditions_errors(pkgdir):
    make_package(pkgdir, 'broken-syntax-1', conditions=[1])
    make_package(pkgdir, 'broken-syntax-2', conditions=[["path-exists"]])
    make_package(pkgdir, 'broken-syntax-3', conditions=[{"path-exists": "/foo", "path-not-exists": "/bar"}])

    make_package(pkgdir, 'unknown-predicate-good', conditions=[{"path-exists": "/usr"},
                                                               {"frobnicated": True}])
    make_package(pkgdir, 'unknown-predicate-bad', conditions=[{"path-exists": "/nonexisting"},
                                                              {"frobnicated": True}])

    packages = Packages()
    assert set(packages.packages.keys()) == {'basic', 'unknown-predicate-good'}


def test_condition_hides_priority(pkgdir):
    make_package(pkgdir, 'vip', name="basic", description="VIP", priority=100,
                 conditions=[{"path-exists": "/nonexisting"}])

    packages = Packages()
    assert packages.packages['basic'].name == 'basic'
    assert packages.packages['basic'].manifest['description'] == 'standard package'
    assert packages.packages['basic'].manifest['requires'] == {'cockpit': "42"}
    assert packages.packages['basic'].priority == 1
