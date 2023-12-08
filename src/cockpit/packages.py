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
import io
import itertools
import json
import logging
import mimetypes
import os
import re
import shutil
from pathlib import Path
from typing import (
    BinaryIO,
    Callable,
    ClassVar,
    Dict,
    Iterable,
    List,
    NamedTuple,
    Optional,
    Pattern,
    Sequence,
    Tuple,
    TypeVar,
)

from cockpit._vendor.systemd_ctypes import bus

from . import config
from ._version import __version__
from .jsonutil import (
    JsonDocument,
    JsonError,
    JsonObject,
    get_bool,
    get_dict,
    get_int,
    get_objv,
    get_str,
    get_strv,
    typechecked,
)

logger = logging.getLogger(__name__)


# In practice, this is going to get called over and over again with exactly the
# same list.  Let's try to cache the result.
@functools.lru_cache()
def parse_accept_language(accept_language: str) -> Sequence[str]:
    """Parse the Accept-Language header, if it exists.

    Returns an ordered list of languages, with fallbacks inserted, and
    truncated to the position where 'en' would have otherwise appeared, if
    applicable.

    https://tools.ietf.org/html/rfc7231#section-5.3.5
    https://datatracker.ietf.org/doc/html/rfc4647#section-3.4
    """

    logger.debug('parse_accept_language(%r)', accept_language)
    locales_with_q = []
    for entry in accept_language.split(','):
        entry = entry.strip().lower()
        logger.debug('  entry %r', entry)
        locale, _, qstr = entry.partition(';q=')
        try:
            q = float(qstr or 1.0)
        except ValueError:
            continue  # ignore malformed entry

        while locale:
            logger.debug('    adding %r q=%r', locale, q)
            locales_with_q.append((locale, q))
            # strip off '-detail' suffixes until there's nothing left
            locale, _, _region = locale.rpartition('-')

    # Sort the list by highest q value.  Otherwise, this is a stable sort.
    locales_with_q.sort(key=lambda pair: pair[1], reverse=True)
    logger.debug('  sorted list is %r', locales_with_q)

    # If we have 'en' anywhere in our list, ignore it and all items after it.
    # This will result in us getting an untranslated (ie: English) version if
    # none of the more-preferred languages are found, which is what we want.
    # We also take the chance to drop duplicate items.  Note: both of these
    # things need to happen after sorting.
    results = []
    for locale, _q in locales_with_q:
        if locale == 'en':
            break
        if locale not in results:
            results.append(locale)

    logger.debug('  results list is %r', results)
    return tuple(results)


def sortify_version(version: str) -> str:
    """Convert a version string to a form that can be compared"""
    # 0-pad each numeric component.  Only supports numeric versions like 1.2.3.
    return '.'.join(part.zfill(8) for part in version.split('.'))


# A document is a binary stream with a Content-Type, optional Content-Encoding,
# and optional Content-Security-Policy
class Document(NamedTuple):
    data: BinaryIO
    content_type: str
    content_encoding: Optional[str] = None
    content_security_policy: Optional[str] = None


class PackagesListener:
    def packages_loaded(self) -> None:
        """Called when the packages have been reloaded"""


class BridgeConfig(JsonObject):
    def __init__(self, value: JsonObject):
        super().__init__(value)

        self.label = get_str(self, 'label', None)

        self.privileged = get_bool(self, 'privileged', default=False)
        self.match: JsonObject = get_dict(self, 'match', {})
        if not self.privileged and not self.match:
            raise JsonError(value, 'must have match rules or be privileged')

        self.environ = get_strv(self, 'environ', ())
        self.spawn = get_strv(self, 'spawn')
        if not self.spawn:
            raise JsonError(value, 'spawn vector must be non-empty')

        self.name = self.label or self.spawn[0]


class Condition:
    def __init__(self, value: JsonObject):
        try:
            (self.name, self.value), = value.items()
        except ValueError as exc:
            raise JsonError(value, 'must contain exactly one key/value pair') from exc


class Manifest(JsonObject):
    # Skip version check when running out of the git checkout (__version__ is None)
    COCKPIT_VERSION = __version__ and sortify_version(__version__)

    def __init__(self, path: Path, value: JsonObject):
        super().__init__(value)
        self.path = path
        self.name = get_str(self, 'name', self.path.name)
        self.bridges = get_objv(self, 'bridges', BridgeConfig)
        self.priority = get_int(self, 'priority', 1)
        self.csp = get_str(self, 'content-security-policy', '')
        self.conditions = get_objv(self, 'conditions', Condition)

        # Skip version check when running out of the git checkout (COCKPIT_VERSION is None)
        if self.COCKPIT_VERSION is not None:
            requires: JsonObject = get_dict(self, 'requires', {})
            for name, version in requires.items():
                if name != 'cockpit':
                    raise JsonError(name, 'non-cockpit requirement listed')
                if sortify_version(typechecked(version, str)) > self.COCKPIT_VERSION:
                    raise JsonError(version, f'required cockpit version ({version}) not met')


class Package:
    # For po{,.manifest}.js files, the interesting part is the locale name
    PO_JS_RE: ClassVar[Pattern] = re.compile(r'(po|po\.manifest)\.([^.]+)\.js(\.gz)?')

    # immutable after __init__
    manifest: Manifest
    name: str
    path: Path
    priority: int

    # computed later
    translations: Optional[Dict[str, Dict[str, str]]] = None
    files: Optional[Dict[str, str]] = None

    def __init__(self, manifest: Manifest):
        self.manifest = manifest
        self.name = manifest.name
        self.path = manifest.path
        self.priority = manifest.priority

    def ensure_scanned(self) -> None:
        """Ensure that the package has been scanned.

        This allows us to defer scanning the files of the package until we know
        that we'll actually use it.
        """

        if self.files is not None:
            return

        self.files = {}
        self.translations = {'po.js': {}, 'po.manifest.js': {}}

        for file in self.path.rglob('*'):
            name = str(file.relative_to(self.path))
            if name in ['.', '..', 'manifest.json']:
                continue

            po_match = Package.PO_JS_RE.fullmatch(name)
            if po_match:
                basename = po_match.group(1)
                locale = po_match.group(2)
                # Accept-Language is case-insensitive and uses '-' to separate variants
                lower_locale = locale.lower().replace('_', '-')

                logger.debug('Adding translation %r %r -> %r', basename, lower_locale, name)
                self.translations[f'{basename}.js'][lower_locale] = name
            else:
                # strip out trailing '.gz' components
                basename = re.sub('.gz$', '', name)
                logger.debug('Adding content %r -> %r', basename, name)
                self.files[basename] = name

                # If we see a filename like `x.min.js` we want to also offer it
                # at `x.js`, but only if `x.js(.gz)` itself is not present.
                # Note: this works for both the case where we found the `x.js`
                # first (it's already in the map) and also if we find it second
                # (it will be replaced in the map by the line just above).
                # See https://github.com/cockpit-project/cockpit/pull/19716
                self.files.setdefault(basename.replace('.min.', '.'), name)

        # support old cockpit-po-plugin which didn't write po.manifest.??.js
        if not self.translations['po.manifest.js']:
            self.translations['po.manifest.js'] = self.translations['po.js']

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

        for item in self.manifest.csp.split(';'):
            item = item.strip()
            if item:
                key, _, value = item.strip().partition(' ')
                policy[key] = value

        return ' '.join(f'{k} {v};' for k, v in policy.items()) + ' block-all-mixed-content'

    def load_file(self, filename: str) -> Document:
        content_type, content_encoding = mimetypes.guess_type(filename)
        content_security_policy = None

        if content_type is None:
            content_type = 'text/plain'
        elif content_type.startswith('text/html'):
            content_security_policy = self.get_content_security_policy()

        path = self.path / filename
        logger.debug('  loading data from %s', path)

        return Document(path.open('rb'), content_type, content_encoding, content_security_policy)

    def load_translation(self, path: str, locales: Sequence[str]) -> Document:
        self.ensure_scanned()
        assert self.translations is not None

        # First match wins
        for locale in locales:
            with contextlib.suppress(KeyError):
                return self.load_file(self.translations[path][locale])

        # We prefer to return an empty document than 404 in order to avoid
        # errors in the console when a translation can't be found
        return Document(io.BytesIO(), 'text/javascript')

    def load_path(self, path: str, headers: JsonObject) -> Document:
        self.ensure_scanned()
        assert self.files is not None
        assert self.translations is not None

        if path in self.translations:
            locales = parse_accept_language(get_str(headers, 'Accept-Language', ''))
            return self.load_translation(path, locales)
        else:
            return self.load_file(self.files[path])


class PackagesLoader:
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
    def load_manifests(cls) -> Iterable[Manifest]:
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
                manifest = cls.patch_manifest(manifest, parent)
                try:
                    yield Manifest(parent, manifest)
                except JsonError as exc:
                    logger.warning('%s %s', file, exc)

    def check_condition(self, condition: str, value: object) -> bool:
        check_fn = self.CONDITIONS[condition]

        # All known predicates currently only work on strings
        if not isinstance(value, str):
            return False

        return check_fn(value)

    def check_conditions(self, manifest: Manifest) -> bool:
        for condition in manifest.conditions:
            try:
                okay = self.check_condition(condition.name, condition.value)
            except KeyError:
                # do *not* ignore manifests with unknown predicates, for forward compatibility
                logger.warning('  %s: ignoring unknown predicate in manifest: %s', manifest.path, condition.name)
                continue

            if not okay:
                logger.debug('  hiding package %s as its %s condition is not met', manifest.path, condition)
                return False

        return True

    def load_packages(self) -> Iterable[Tuple[str, Package]]:
        logger.debug('Scanning for available package manifests:')
        # Sort all available packages into buckets by to their claimed name
        names: Dict[str, List[Manifest]] = collections.defaultdict(list)
        for manifest in self.load_manifests():
            logger.debug('  %s/manifest.json', manifest.path)
            names[manifest.name].append(manifest)
        logger.debug('done.')

        logger.debug('Selecting packages to serve:')
        for name, candidates in names.items():
            # For each package name, iterate the candidates in descending
            # priority order and select the first one which passes all checks
            for candidate in sorted(candidates, key=lambda manifest: manifest.priority, reverse=True):
                try:
                    if self.check_conditions(candidate):
                        logger.debug('  creating package %s -> %s', name, candidate.path)
                        yield name, Package(candidate)
                        break
                except JsonError:
                    logger.warning('  %s: ignoring package with invalid manifest file', candidate.path)

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
        self.manifests = json.dumps({name: dict(package.manifest) for name, package in self.packages.items()})
        logger.debug('Packages loaded: %s', list(self.packages))

    def show(self):
        for name in sorted(self.packages):
            package = self.packages[name]
            menuitems = []
            for entry in itertools.chain(
                    package.manifest.get('menu', {}).values(),
                    package.manifest.get('tools', {}).values()):
                with contextlib.suppress(KeyError):
                    menuitems.append(entry['label'])
            print(f'{name:20} {", ".join(menuitems):40} {package.path}')

    def get_bridge_configs(self) -> Sequence[BridgeConfig]:
        def yield_configs():
            for package in sorted(self.packages.values(), key=lambda package: -package.priority):
                yield from package.manifest.bridges
        return tuple(yield_configs())

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

    def load_manifests_js(self, headers: JsonObject) -> Document:
        logger.debug('Serving /manifests.js')

        chunks: List[bytes] = []

        # Send the translations required for the manifest files, from each package
        locales = parse_accept_language(get_str(headers, 'Accept-Language', ''))
        for name, package in self.packages.items():
            if name in ['static', 'base1']:
                continue

            # find_translation will always find at least 'en'
            translation = package.load_translation('po.manifest.js', locales)
            with translation.data:
                if translation.content_encoding == 'gzip':
                    data = gzip.decompress(translation.data.read())
                else:
                    data = translation.data.read()

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

        return Document(io.BytesIO(b'\n'.join(chunks)), 'text/javascript')

    def load_manifests_json(self) -> Document:
        logger.debug('Serving /manifests.json')
        return Document(io.BytesIO(self.manifests.encode()), 'application/json')

    PATH_RE = re.compile(
        r'/'                   # leading '/'
        r'(?:([^/]+)/)?'       # optional leading path component
        r'((?:[^/]+/)*[^/]+)'  # remaining path components
    )

    def load_path(self, path: str, headers: JsonObject) -> Document:
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
