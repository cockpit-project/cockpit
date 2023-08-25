# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
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

import collections
import contextlib
import functools
import gzip
import json
import logging
import mimetypes
import os
import re
import shutil
from pathlib import Path
from typing import Callable, ClassVar, Dict, Iterable, List, NamedTuple, Optional, Pattern, Tuple, TypeVar

from cockpit._vendor.systemd_ctypes import bus

from . import config
from ._version import __version__
from .jsonutil import JsonDocument, JsonObject

logger = logging.getLogger(__name__)


def parse_accept_language(headers: Dict[str, str]) -> List[str]:
    """Parse the Accept-Language header, if it exists.

    Returns an ordered list of languages.

    https://tools.ietf.org/html/rfc7231#section-5.3.5
    """

    accept_language = headers.get('Accept-Language')
    if not isinstance(accept_language, str):
        return []

    accept_languages = accept_language.split(',')
    locales = []
    for language in accept_languages:
        language = language.strip()
        locale, _, weightstr = language.partition(';q=')
        weight = float(weightstr or 1)

        # Skip possible empty locales
        if not locale:
            continue

        # Locales are case-insensitive and we store our list in lowercase
        locales.append((locale.lower(), weight))

    return [locale for locale, _ in sorted(locales, key=lambda k: k[1], reverse=True)]


def sortify_version(version: str) -> str:
    """Convert a version string to a form that can be compared"""
    # 0-pad each numeric component.  Only supports numeric versions like 1.2.3.
    return '.'.join(part.zfill(8) for part in version.split('.'))


# A document is a binary blob with a Content-Type, optional Content-Encoding,
# and optional Content-Security-Policy
class Document(NamedTuple):
    data: bytes
    content_type: str
    content_encoding: Optional[str] = None
    content_security_policy: Optional[str] = None


class PackagesListener:
    def packages_loaded(self):
        """Called when the packages have been reloaded"""


class Candidate:
    # immutable after __init__
    path: Path
    manifest: JsonObject

    def __init__(self, path: Path, manifest: JsonObject):
        self.path = path
        self.manifest = manifest

    def get_name(self) -> str:
        name = self.manifest.get('name')
        return name if isinstance(name, str) else self.path.name

    def get_priority(self) -> int:
        priority = self.manifest.get('priority')
        return priority if isinstance(priority, int) else 1


class Package:
    PO_JS_RE: ClassVar[Pattern] = re.compile(r'po\.([^.]+)\.js(\.gz)?')

    # immutable after __init__
    name: str
    manifest: JsonObject
    bridges: List[JsonDocument]

    # computed later
    translations: Optional[Dict[str, str]] = None
    files: Optional[Dict[str, str]] = None

    def __init__(self, candidate: Candidate):
        self.name = candidate.get_name()
        self.priority = candidate.get_priority()
        self.path = candidate.path
        self.manifest = candidate.manifest
        bridges = self.manifest.get('bridges', [])
        if isinstance(bridges, list):
            self.bridges = bridges
        else:
            self.bridges = []

    def ensure_scanned(self) -> None:
        """Ensure that the package has been scanned.

        This allows us to defer scanning the files of the package until we know
        that we'll actually use it.
        """

        if self.files is not None:
            return

        self.files = {}
        self.translations = {}

        for file in self.path.rglob('*'):
            name = str(file.relative_to(self.path))
            if name in ['.', '..', 'manifest.json']:
                continue

            po_match = Package.PO_JS_RE.fullmatch(name)
            if po_match:
                locale = po_match.group(1)
                # Accept-Language is case-insensitive and uses '-' to separate variants
                lower_locale = locale.lower().replace('_', '-')
                self.translations[lower_locale] = name
            else:
                basename = name[:-3] if name.endswith('.gz') else name
                self.files[basename] = name

    def get_content_security_policy(self) -> str:
        policy = {
            "default-src": "'self'",
            "connect-src": "'self'",
            "form-action": "'self'",
            "base-uri": "'self'",
            "object-src": "'none'",
            "font-src": "'self' data:",
            "img-src": "'self' data:",
        }

        manifest_policy = self.manifest.get('content-security-policy', '')
        if not isinstance(manifest_policy, str):
            manifest_policy = ''
        for item in manifest_policy.split(';'):
            item = item.strip()
            if item:
                key, _, value = item.strip().partition(' ')
                policy[key] = value

        return ' '.join(f'{k} {v};' for k, v in policy.items()) + ' block-all-mixed-content'

    def load_file(self, filename: str) -> Document:
        path = self.path / filename
        logger.debug('  loading data from %s', path)
        data = path.read_bytes()

        content_type, content_encoding = mimetypes.guess_type(filename)
        content_security_policy = None

        if content_type is None:
            content_type = 'text/plain'
        elif content_type.startswith('text/html'):
            content_security_policy = self.get_content_security_policy()

        return Document(data, content_type, content_encoding, content_security_policy)

    def load_translation(self, locales: List[str]) -> Document:
        self.ensure_scanned()
        assert self.translations is not None

        # First check the locales that the user sent
        for locale in locales:
            with contextlib.suppress(KeyError):
                return self.load_file(self.translations[locale])

        # Next, check the language-only versions of variant-specified locales
        for locale in locales:
            language, _, region = locale.partition('-')
            if region:
                with contextlib.suppress(KeyError):
                    return self.load_file(self.translations[language])

        # We prefer to return an empty document than 404 in order to avoid
        # errors in the console when a translation can't be found
        return Document(b'', 'text/javascript')

    def load_path(self, path: str, headers: Dict[str, str]) -> Document:
        self.ensure_scanned()
        assert self.files is not None
        assert self.translations is not None

        if path == 'po.js':
            locales = parse_accept_language(headers)
            return self.load_translation(locales)
        else:
            return self.load_file(self.files[path])


class PackagesLoader:
    # Skip version check when running out of the git checkout (__version__ is None)
    COCKPIT_VERSION = __version__ and sortify_version(__version__)

    CONDITIONS: ClassVar[Dict[str, Callable[[str], bool]]] = {
        'path-exists': os.path.exists,
        'path-not-exists': lambda p: not os.path.exists(p),
    }

    @staticmethod
    @functools.lru_cache()
    def get_libexecdir() -> str:
        """Detect libexecdir on current machine

        This only works for systems which have cockpit-ws installed.
        """
        for candidate in ['/usr/local/libexec', '/usr/libexec', '/usr/local/lib/cockpit', '/usr/lib/cockpit']:
            if os.path.exists(os.path.join(candidate, 'cockpit-askpass')):
                return candidate
        else:
            logger.warning('Could not detect libexecdir')
            # give readable error messages
            return '/nonexistent/libexec'

    # HACK: Type narrowing over Union types is not supported in the general case,
    # but this works for the case we care about: knowing that when we pass in an
    # JsonObject, we'll get an JsonObject back.
    J = TypeVar('J', JsonObject, JsonDocument)

    @classmethod
    def patch_libexecdir(cls, obj: J) -> J:
        if isinstance(obj, str):
            if '${libexecdir}/cockpit-askpass' in obj:
                # extra-special case: we handle this internally
                abs_askpass = shutil.which('cockpit-askpass')
                if abs_askpass is not None:
                    return obj.replace('${libexecdir}/cockpit-askpass', abs_askpass)
            return obj.replace('${libexecdir}', cls.get_libexecdir())
        elif isinstance(obj, dict):
            return {key: cls.patch_libexecdir(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [cls.patch_libexecdir(item) for item in obj]
        else:
            return obj

    @classmethod
    def get_xdg_data_dirs(cls) -> Iterable[str]:
        try:
            yield os.environ['XDG_DATA_HOME']
        except KeyError:
            yield os.path.expanduser('~/.local/share')

        try:
            yield from os.environ['XDG_DATA_DIRS'].split(':')
        except KeyError:
            yield from ('/usr/local/share', '/usr/share')

    # https://www.rfc-editor.org/rfc/rfc7386
    @classmethod
    def merge_patch(cls, target: JsonDocument, patch: J) -> J:
        # Loosely based on example code from the RFC
        if not isinstance(patch, dict):
            return patch

        # Always take a copy ('result') — we never modify the input ('target')
        result = dict(target if isinstance(target, dict) else {})
        for name, value in patch.items():
            if value is not None:
                result[name] = cls.merge_patch(result.get(name), value)
            else:
                result.pop(name)
        return result

    @classmethod
    def patch_manifest(cls, manifest: JsonObject, parent: Path) -> JsonObject:
        override_files = [
            parent / 'override.json',
            config.lookup_config(f'{parent.name}.override.json'),
            config.DOT_CONFIG_COCKPIT / f'{parent.name}.override.json',
        ]

        for override_file in override_files:
            try:
                override: JsonDocument = json.loads(override_file.read_bytes())
            except FileNotFoundError:
                continue
            except json.JSONDecodeError as exc:
                # User input error: report a warning
                logger.warning('%s: %s', override_file, exc)

            if not isinstance(override, dict):
                logger.warning('%s: override file is not a dictionary', override_file)
                continue

            manifest = cls.merge_patch(manifest, override)

        return cls.patch_libexecdir(manifest)

    @classmethod
    def load_candidates(cls) -> Iterable[Candidate]:
        for datadir in cls.get_xdg_data_dirs():
            logger.debug("Scanning for manifest files under %s", datadir)
            for file in Path(datadir).glob('cockpit/*/manifest.json'):
                logger.debug("Considering file %s", file)
                try:
                    manifest = json.loads(file.read_text())
                except json.JSONDecodeError as exc:
                    logger.error("%s: %s", file, exc)
                    continue
                if not isinstance(manifest, dict):
                    logger.error("%s: json document isn't an object", file)
                    continue

                parent = file.parent
                yield Candidate(parent, cls.patch_manifest(manifest, parent))

    @classmethod
    def check_requires(cls, candidate: Candidate) -> bool:
        try:
            requires = candidate.manifest['requires']
            if not isinstance(requires, dict):
                logger.warning('%s: requires key in manifest is not a dictionary', candidate.path)
                return False
        except KeyError:
            return True  # no requires?  no problem!

        if any(package != 'cockpit' for package in requires):
            return False

        try:
            cockpit_requires = requires['cockpit']
            if not isinstance(cockpit_requires, str):
                logger.warning('%s: requires key in manifest is not a dictionary', candidate.path)
                return False
            # Skip version check when running out of the git checkout
            return not cls.COCKPIT_VERSION or cls.COCKPIT_VERSION >= sortify_version(cockpit_requires)
        except KeyError:
            return True  # no requires?  no problem!

    def check_condition(self, condition: str, value: object) -> bool:
        check_fn = self.CONDITIONS[condition]

        # All known predicates currently only work on strings
        if not isinstance(value, str):
            return False

        return check_fn(value)

    def check_conditions(self, candidate: Candidate) -> bool:
        conditions = candidate.manifest.get('conditions', [])
        if not isinstance(conditions, list):
            logger.warning('  %s: conditions key in manifest is not a list', candidate.path)
            return False

        for condition in conditions:
            try:
                (predicate, value), = condition.items()  # type: ignore[union-attr] # can throw AttributeError
            except (AttributeError, ValueError):
                # ignore manifests with broken syntax
                logger.warning('  %s: invalid condition in manifest: %s', candidate.path, condition)
                return False

            try:
                okay = self.check_condition(predicate, value)
            except KeyError:
                # do *not* ignore manifests with unknown predicates, for forward compatibility
                logger.warning('  %s: ignoring unknown predicate in manifest: %s', candidate.path, predicate)
                continue

            if not okay:
                logger.debug('  hiding package %s as its %s condition is not met', candidate.path, condition)
                return False

        return True

    def load_packages(self) -> Iterable[Tuple[str, Package]]:
        logger.debug('Scanning for available package manifests:')
        # Sort all available packages into buckets by to their claimed name
        names: Dict[str, List[Candidate]] = collections.defaultdict(list)
        for candidate in self.load_candidates():
            logger.debug('  %s/manifest.json', candidate.path)
            names[candidate.get_name()].append(candidate)
        logger.debug('done.')

        logger.debug('Selecting packages to serve:')
        for name, candidates in names.items():
            # For each package name, iterate the candidates in descending
            # priority order and select the first one which passes all checks
            for candidate in sorted(candidates, key=Candidate.get_priority, reverse=True):
                if self.check_requires(candidate) and self.check_conditions(candidate):
                    logger.debug('  creating package %s -> %s', name, candidate.path)
                    yield name, Package(candidate)
                    break

                logger.debug('  ignoring %s: unmet conditions', candidate.path)
        logger.debug('done.')


class Packages(bus.Object, interface='cockpit.Packages'):
    loader: PackagesLoader
    listener: Optional[PackagesListener]
    packages: Dict[str, Package]
    saw_first_reload_hint: bool

    def __init__(self, listener: Optional[PackagesListener] = None, loader: Optional[PackagesLoader] = None):
        self.listener = listener
        self.loader = loader or PackagesLoader()
        self.load()

        # Reloading the Shell in the browser should reload the
        # packages.  This is implemented by having the Shell call
        # reload_hint whenever it starts.  The first call of this
        # method in each session is ignored so that packages are not
        # loaded twice right after logging in.
        #
        self.saw_first_reload_hint = False

    def load(self) -> None:
        self.packages = dict(self.loader.load_packages())
        self.manifests = json.dumps({name: package.manifest for name, package in self.packages.items()})
        logger.debug('Packages loaded: %s', list(self.packages))

    def show(self):
        for name in sorted(self.packages):
            package = self.packages[name]
            menuitems = ''
            print(f'{name:20} {menuitems:40} {package.path}')

    def get_bridge_configs(self):
        bridges = []
        for package in sorted(self.packages.values(), key=lambda package: -package.priority):
            bridges.extend(package.bridges)
        return bridges

    # D-Bus Interface
    manifests = bus.Interface.Property('s', value="{}")

    @bus.Interface.Method()
    def reload(self):
        self.load()
        if self.listener is not None:
            self.listener.packages_loaded()

    @bus.Interface.Method()
    def reload_hint(self):
        if self.saw_first_reload_hint:
            self.reload()
        self.saw_first_reload_hint = True

    def load_manifests_js(self, headers: Dict[str, str]) -> Document:
        logger.debug('Serving /manifests.js')

        chunks: List[bytes] = []

        # Send the translations required for the manifest files, from each package
        locales = parse_accept_language(headers)
        for name, package in self.packages.items():
            if name in ['static', 'base1']:
                continue
            # find_translation will always find at least 'en'
            translation = package.load_translation(locales)
            if translation.content_encoding == 'gzip':
                data = gzip.decompress(translation.data)
            else:
                data = translation.data
            chunks.append(data)

        chunks.append(b"""
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if (typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this, """ + self.manifests.encode() + b"""))""")

        return Document(b'\n'.join(chunks), 'text/javascript')

    def load_manifests_json(self) -> Document:
        logger.debug('Serving /manifests.json')
        return Document(self.manifests.encode(), 'application/json')

    PATH_RE = re.compile(
        r'/'                   # leading '/'
        r'(?:([^/]+)/)?'       # optional leading path component
        r'((?:[^/]+/)*[^/]+)'  # remaining path components
    )

    def load_path(self, path: str, headers: Dict[str, str]) -> Document:
        logger.debug('packages: serving %s', path)

        match = self.PATH_RE.fullmatch(path)
        if match is None:
            raise ValueError(f'Invalid HTTP path {path}')
        packagename, filename = match.groups()

        if packagename is not None:
            return self.packages[packagename].load_path(filename, headers)
        elif filename == 'manifests.js':
            return self.load_manifests_js(headers)
        elif filename == 'manifests.json':
            return self.load_manifests_json()
        else:
            raise KeyError
