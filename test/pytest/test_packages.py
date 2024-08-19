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

import json

import pytest

from cockpit.packages import Packages, parse_accept_language


@pytest.mark.parametrize(("test_input", "expected"), [
    # correct handles empty values
    ('', ()),
    ('  ', ()),
    (' , ', ()),
    (' , ,xx', ('xx',)),
    # english → empty list
    ('en', ()),
    ('   , en', ()),
    # invalid q values get ignored
    ('aa;q===,bb;q=abc,cc;q=.,zz', ('zz',)),
    # variant-peeling works
    ('aa-bb-cc-dd,ee-ff-gg-hh', ('aa-bb-cc-dd', 'aa-bb-cc', 'aa-bb', 'aa', 'ee-ff-gg-hh', 'ee-ff-gg', 'ee-ff', 'ee')),
    # sorting and english-truncation are working
    ('fr-ch;q=0.8,es-mx;q=1.0,en-ca;q=0.9', ('es-mx', 'es', 'en-ca')),
    ('de-at, zh-CN, en,', ('de-at', 'de', 'zh-cn', 'zh')),
    ('es-es, nl;q=0.8, fr;q=0.9', ('es-es', 'es', 'fr', 'nl')),
    ('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5', ('fr-ch', 'fr'))
])
def test_parse_accept_language(test_input: str, expected: 'tuple[str]') -> None:
    assert parse_accept_language(test_input) == expected


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
    monkeypatch.setenv('XDG_CONFIG_DIRS', str(tmp_path))
    return tmp_path / 'cockpit'


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
    (confdir / 'basic.override.json').write_text('{"description": null, "priority": 5, "does-not-exist": null}')

    packages = Packages()
    assert len(packages.packages) == 1
    # original attributes
    assert packages.packages['basic'].name == 'basic'
    assert packages.packages['basic'].manifest['requires'] == {'cockpit': '42'}
    # overridden attributes
    assert 'description' not in packages.packages['basic'].manifest
    assert packages.packages['basic'].priority == 5

    assert json.loads(packages.manifests) == {
        'basic': {
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


def test_english_translation(pkgdir):
    make_package(pkgdir, 'one')
    (pkgdir / 'one' / 'po.de.js').write_text('eins')

    packages = Packages()

    # make sure we get German
    document = packages.load_path('/one/po.js', {'Accept-Language': 'de'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b'eins'

    # make sure we get German here (higher q-value) even with English first
    document = packages.load_path('/one/po.js', {'Accept-Language': 'en;q=0.9, de-ch'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b'eins'

    # make sure we get the empty ("English") translation, and not German
    document = packages.load_path('/one/po.js', {'Accept-Language': 'en, de'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''

    document = packages.load_path('/one/po.js', {'Accept-Language': 'de;q=0.9, fr;q=0.7, en'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''

    document = packages.load_path('/one/po.js', {'Accept-Language': 'de;q=0.9, fr, en-ca'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''

    document = packages.load_path('/one/po.js', {'Accept-Language': ''})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''

    document = packages.load_path('/one/po.js', {})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''


def test_translation(pkgdir):
    # old style: make sure po.de.js is served as fallback for manifest translations
    make_package(pkgdir, 'one')
    (pkgdir / 'one' / 'po.de.js').write_text('eins')

    # new style: separated translations
    make_package(pkgdir, 'two')
    (pkgdir / 'two' / 'po.de.js').write_text('zwei')
    (pkgdir / 'two' / 'po.manifest.de.js').write_text('zwo')

    packages = Packages()

    # make sure we can read a po.js file with language fallback
    document = packages.load_path('/one/po.js', {'Accept-Language': 'es, de'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b'eins'

    # make sure we fall back cleanly to an empty file with correct mime
    document = packages.load_path('/one/po.js', {'Accept-Language': 'es'})
    assert '/javascript' in document.content_type
    assert document.data.read() == b''

    # make sure the manifest translations get sent along with manifests.js
    document = packages.load_path('/manifests.js', {'Accept-Language': 'de'})
    contents = document.data.read()
    assert b'eins\n' in contents
    assert b'zwo\n' in contents
    assert b'zwei\n' not in contents


def test_filename_mangling(pkgdir):
    make_package(pkgdir, 'one')

    # test various filename variations
    (pkgdir / 'one' / 'one.js').write_text('this is one.js')
    (pkgdir / 'one' / 'two.js.gz').write_text('this is two.js')
    (pkgdir / 'one' / 'three.min.js.gz').write_text('this is three.js')
    (pkgdir / 'one' / 'four.min.js').write_text('this is four.js')

    packages = Packages()
    encodings = set()

    for name in ['one', 'two', 'three', 'four']:
        document = packages.load_path(f'/one/{name}.js', {})
        assert document.data.read().decode() == f'this is {name}.js'
        assert '/javascript' in document.content_type
        encodings.add(document.content_encoding)

    assert encodings == {None, 'gzip'}  # make sure we saw both compressed and uncompressed


def test_overlapping_minified(pkgdir):
    make_package(pkgdir, 'one')
    (pkgdir / 'one' / 'one.min.js').write_text('min')
    (pkgdir / 'one' / 'one.js').write_text('max')

    # try the other way around in hope of listing the files in reverse order
    (pkgdir / 'one' / 'two.js').write_text('max')
    (pkgdir / 'one' / 'two.min.js').write_text('min')

    packages = Packages()

    # if both files are present, we should find the original one
    document = packages.load_path('/one/one.js', {})
    assert document.data.read().decode() == 'max'
    document = packages.load_path('/one/two.js', {})
    assert document.data.read().decode() == 'max'

    # but requesting .min. explicitly will load it
    document = packages.load_path('/one/one.min.js', {})
    assert document.data.read().decode() == 'min'
    document = packages.load_path('/one/two.min.js', {})
    assert document.data.read().decode() == 'min'
