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
import gzip
import hashlib
import json
import logging
import mimetypes
import os
import re

from pathlib import Path
from typing import ClassVar, Dict, List, Optional, Pattern, Tuple

from systemd_ctypes import bus

from . import config

VERSION = '300'
logger = logging.getLogger(__name__)


# An entity to serve is a set of bytes plus a content-type/content-encoding pair
Entity = Tuple[bytes, Tuple[Optional[str], Optional[str]]]
Entities = Dict[str, Entity]


# Sorting is important because the checksums are dependent on the order we
# visit these.  This is not the same as sorting on the full pathname, since
# each directory component is considered separately.  We could split the path
# and sort on that, but it ends up not being particularly elegant.
# Changing the approach here will change the checksum.
# We're allowed to change it as we wish, but let's try to match behaviour with
# cockpitpackages.c for the time being, since the unit tests depend on it.
def directory_items(path):
    return sorted(path.iterdir(), key=lambda item: item.name)


# HACK: We eventually want to get rid of all ${libexecdir} in manifests:
# - rewrite cockpit-{ssh,pcp} in Python and import them as module instead of exec'ing
# - rewrite cockpit-askpass in Python and write it into a temporary file
# - bundle helper shell scripts into their webpacks
# Until then, we need this libexecdir detection hack.
LIBEXECDIR = None


def get_libexecdir() -> str:
    '''Detect libexecdir on current machine

    This only works for systems which have cockpit-ws installed.
    '''
    global LIBEXECDIR
    if LIBEXECDIR is None:
        for candidate in ['/usr/local/libexec', '/usr/libexec', '/usr/local/lib/cockpit', '/usr/lib/cockpit']:
            if os.path.exists(os.path.join(candidate, 'cockpit-certificate-helper')):
                LIBEXECDIR = candidate
                break
        else:
            logger.warning('Could not detect libexecdir')
            # give readable error messages
            LIBEXECDIR = '/nonexistent/libexec'

    return LIBEXECDIR


def patch_libexecdir(obj):
    if isinstance(obj, str):
        return obj.replace('${libexecdir}', get_libexecdir())
    elif isinstance(obj, dict):
        return {key: patch_libexecdir(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [patch_libexecdir(item) for item in obj]
    else:
        return obj


def parse_accept_language(headers: Dict[str, object]) -> List[str]:
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


def find_translation(translations: Entities, locales: List[str]) -> Entity:
    # First check the locales that the user sent
    for locale in locales:
        translation = translations.get(locale)
        if translation is not None:
            return translation

    # Next, check the language-only versions of variant-specified locales
    for locale in locales:
        language, _, region = locale.partition('-')
        if not region:
            continue
        translation = translations.get(language)
        if translation:
            return translation

    # If nothing else worked, we always have English
    return translations['en']


class PackagesListener:
    def packages_loaded(self):
        """Called when the packages have been reloaded"""


class Package:
    # For po.js files, the interesting part is the locale name
    PO_JS_RE: ClassVar[Pattern] = re.compile(r'po\.([^.]+)\.js(\.gz)?')

    # A built in base set of "English" translations
    PO_EN_JS: ClassVar[Entity] = b'', mimetypes.guess_type('po.js')
    BASE_TRANSLATIONS: ClassVar[Entities] = {'en': PO_EN_JS, 'en-us': PO_EN_JS}

    files: Entities
    translations: Entities

    def __init__(self, path):
        self.path = path

        with (self.path / 'manifest.json').open(encoding='utf-8') as manifest_file:
            self.manifest = json.load(manifest_file)

        self.try_override(self.path / 'override.json')
        self.try_override(config.ETC_COCKPIT / f'{path.name}.override.json')
        self.try_override(config.DOT_CONFIG_COCKPIT / f'{path.name}.override.json')

        # HACK: drop this after getting rid of ${libexecdir}, see above
        self.manifest = patch_libexecdir(self.manifest)

        self.name = self.manifest.get('name', path.name)
        self.content_security_policy = None
        self.priority = self.manifest.get('priority', 1)
        self.bridges = self.manifest.get('bridges', [])

        self.files = {}
        self.translations = dict(Package.BASE_TRANSLATIONS)

        self.version = Package.sortify_version(VERSION)

    def try_override(self, path: Path) -> None:
        try:
            with path.open(encoding='utf-8') as override_file:
                override = json.load(override_file)
            self.manifest = self.merge_patch(self.manifest, override)
        except FileNotFoundError:
            # This is the expected usual case
            pass
        except json.JSONDecodeError as exc:
            # User input error: report a warning
            logger.warning('%s: %s', path, exc)

    # https://www.rfc-editor.org/rfc/rfc7386
    @staticmethod
    def merge_patch(target: object, patch: object) -> object:
        # Loosely based on example code from the RFC
        if not isinstance(patch, dict):
            return patch

        # Always take a copy ('result') — we never modify the input ('target')
        result = dict(target if isinstance(target, dict) else {})
        for name, value in patch.items():
            if value is not None:
                result[name] = Package.merge_patch(result[name], value)
            else:
                result.pop(name)
        return result

    @staticmethod
    def sortify_version(version: str) -> str:
        '''Convert a version string to a form that can be compared'''
        # 0-pad each numeric component.  Only supports numeric versions like 1.2.3.
        return '.'.join(part.zfill(8) for part in version.split('.'))

    def add_file(self, item: Path, checksums: List['hashlib._Hash']) -> None:
        rel = str(item.relative_to(self.path))
        guessed_type = mimetypes.guess_type(rel)

        with item.open('rb') as file:
            data = file.read()

        # Keep the file in memory to serve it later: if this is a 'po.*.js'
        # file then add it to the list of translations, by locale name.
        # Otherwise, add it to the normal files list (after stripping '.gz').
        po_match = Package.PO_JS_RE.fullmatch(rel)
        if po_match:
            locale = po_match.group(1)
            # Accept-Language is case-insensitive and uses '-' to separate variants
            lower_locale = locale.lower().replace('_', '-')
            self.translations[lower_locale] = data, guessed_type
        else:
            self.files[rel.removesuffix('.gz')] = data, guessed_type

        # Perform checksum calculation
        sha = hashlib.sha256(data).hexdigest()
        for context in checksums:
            context.update(f'{rel}\0{sha}\0'.encode('ascii'))

    def walk(self, checksums, path):
        for item in directory_items(path):
            if item.is_dir():
                self.walk(checksums, item)
            elif item.is_file():
                self.add_file(item, checksums)

    def check(self, at_least_prio):
        if 'requires' in self.manifest:
            requires = self.manifest['requires']
            if any(package != 'cockpit' for package in requires):
                return False

            if 'cockpit' in requires and self.version < Package.sortify_version(requires['cockpit']):
                return False

        if at_least_prio is not None:
            if 'priority' not in self.manifest:
                return False

            if self.manifest['priority'] <= at_least_prio:
                return False

        return True

    def get_content_security_policy(self, origin):
        assert origin.startswith('http')
        origin_ws = origin.replace('http', 'ws', 1)

        # fix me: unit tests depend on the specific order
        policy = collections.OrderedDict({
            "default-src": f"'self' {origin}",
            "connect-src": f"'self' {origin} {origin_ws}",
            "form-action": f"'self' {origin}",
            "base-uri": f"'self' {origin}",
            "object-src": "'none'",
            "font-src": f"'self' {origin} data:",
            "img-src": f"'self' {origin} data:",
        })

        manifest_policy = self.manifest.get('content-security-policy', '')
        for item in manifest_policy.split(';'):
            item = item.strip()
            if item:
                key, _, value = item.strip().partition(' ')
                policy[key] = value

        return ' '.join(f'{k} {v};' for k, v in policy.items()) + ' block-all-mixed-content'

    def find_file(self, path, channel):
        if path == 'po.js':
            # We do locale-dependent lookup only for /po.js
            locales = parse_accept_language(channel.headers)
            return find_translation(self.translations, locales)
        else:
            # Otherwise, just look up the file based on its path
            return self.files.get(path)

    def serve_file(self, path, channel):
        found = self.find_file(path, channel)
        if found is None:
            logger.debug('path %s not in %s', path, self.files)
            channel.http_error(404, 'Not found')
            return

        data, (content_type, encoding) = found
        headers = {
            "Access-Control-Allow-Origin": channel.origin,
            "Content-Encoding": encoding,
        }
        if content_type is not None and content_type.startswith('text/html'):
            headers['Content-Security-Policy'] = self.get_content_security_policy(channel.origin)
        channel.http_ok(content_type, headers)
        channel.send_data(data)


# TODO: This doesn't yet implement the slighty complicated checksum
# scheme of the C bridge (see cockpitpackages.c) to support caching
# and reloading.

class Packages(bus.Object, interface='cockpit.Packages'):
    manifests = bus.Interface.Property('s', value="{}")

    listener: Optional[PackagesListener]
    packages: Dict[str, Package]
    checksum: str = ''

    def __init__(self, listener: Optional[PackagesListener] = None):
        super().__init__()

        self.listener = listener
        self.packages = {}
        self.load_packages()

        # Reloading the Shell in the browser should reload the
        # packages.  This is implemented by having the Shell call
        # reload_hint whenever it starts.  The first call of this
        # method in each session is ignored so that packages are not
        # loaded twice right after logging in.
        #
        self.saw_first_reload_hint = False

    def show(self):
        for name in sorted(self.packages):
            package = self.packages[name]
            menuitems = ''
            print(f'{name:20} {menuitems:40} {package.path}')
        if self.checksum:
            print(f'checksum = {self.checksum}')

    def try_packages_dir(self, path, checksums):
        try:
            items = directory_items(path)
        except FileNotFoundError:
            return

        for item in items:
            if item.is_dir():
                try:
                    package = Package(item)
                except (FileNotFoundError, json.JSONDecodeError):
                    # ignore packages with broken/empty manifests
                    continue

                if package.name in self.packages:
                    at_least_prio = self.packages[package.name].priority
                else:
                    at_least_prio = None

                if package.check(at_least_prio):
                    self.packages[package.name] = package
                    package.walk(checksums, package.path)

    def load_packages(self):
        checksums = []

        xdg_data_home = os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share')
        self.try_packages_dir(Path(xdg_data_home) / 'cockpit', checksums)

        # we only checksum the system content if there's no user content
        if not self.packages:
            checksums.append(hashlib.sha256())

        xdg_data_dirs = os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share')
        for xdg_dir in xdg_data_dirs.split(':'):
            self.try_packages_dir(Path(xdg_dir) / 'cockpit', checksums)

        if checksums:
            self.checksum = checksums[0].hexdigest()
        else:
            self.checksum = None

        self.manifests = json.dumps({name: package.manifest for name, package in self.packages.items()})

    def serve_manifests_js(self, channel):
        channel.http_ok('text/javascript')

        # Send the translations required for the manifest files, from each package
        locales = parse_accept_language(channel.headers)
        for name, package in self.packages.items():
            if name in ['static', 'base1']:
                continue
            # find_translation will always find at least 'en'
            data, (content_type, encoding) = find_translation(package.translations, locales)
            if encoding == 'gzip':
                data = gzip.decompress(data)
            channel.send_data(data)

        channel.send_data(("""
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if (typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this, """ + self.manifests + """))""").encode('ascii'))

    def serve_package_file(self, path, channel):
        package, _, package_path = path[1:].partition('/')
        self.packages[package].serve_file(package_path, channel)

    def serve_checksum(self, channel):
        channel.http_ok('text/plain')
        channel.send_data(self.checksum.encode('ascii'))

    def serve_file(self, path, channel):
        assert path[0] == '/'

        # HACK: If the response is language specific, don't cache the file. Caching "po.js" breaks
        # changing the language in Chromium, as that does not respect `Vary: Cookie` properly.
        # See https://github.com/cockpit-project/cockpit/issues/8160
        # We also can't cache /manifests.js because it changes if packages are installed/removed.
        if self.checksum is not None and not path.endswith('po.js') and path != '/manifests.js':
            channel.push_header('X-Cockpit-Pkg-Checksum', self.checksum)
        else:
            channel.push_header('Cache-Control', 'no-cache, no-store')

        if path == '/manifests.js':
            self.serve_manifests_js(channel)
        elif path == '/checksum':
            self.serve_checksum(channel)
        elif '*' in path:
            channel.http_error(404, "Not Found")
        else:
            self.serve_package_file(path, channel)

    def get_bridge_configs(self):
        bridges = []
        for package in sorted(self.packages.values(), key=lambda package: -package.priority):
            bridges.extend(package.bridges)
        return bridges

    @bus.Interface.Method()
    def reload(self):
        self.packages = {}
        self.load_packages()
        if self.listener is not None:
            self.listener.packages_loaded()

    @bus.Interface.Method()
    def reload_hint(self):
        if self.saw_first_reload_hint:
            self.reload()
        self.saw_first_reload_hint = True
