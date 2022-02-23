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
import hashlib
import json
import logging
import mimetypes
import os

import packaging.version

VERSION = packaging.version.Version("300")
logger = logging.getLogger('cockpit.packages')


# Sorting is important because the checksums are dependent on the order we
# visit these.  This is not the same as sorting on the full pathname, since
# each directory component is considered separately.  We could split the path
# and sort on that, but it ends up not being particularly elegant.
# Changing the approach here will change the checksum.
# We're allowed to change it as we wish, but let's try to match behaviour with
# cockpitpackages.c for the time being, since the unit tests depend on it.
def directory_items(path):
    with os.scandir(path) as items:
        return sorted(items, key=lambda item: item.name)


class Package:
    def __init__(self, entry):
        self.path = entry.path

        with open(f'{self.path}/manifest.json') as manifest_file:
            self.manifest = json.load(manifest_file)

        if 'name' in self.manifest:
            self.name = self.manifest['name']
        else:
            self.name = entry.name

        self.content_security_policy = None
        self.priority = self.manifest.get('priority', 1)

        self.files = set()
        for path, _, files in os.walk(self.path):
            for file in files:
                self.files.add(os.path.relpath(f'{path}/{file}', self.path))

    def walk(self, checksums, path=None):
        for item in directory_items(path or self.path):
            if item.is_dir():
                self.walk(checksums, item.path)
            elif item.is_file():
                rel = os.path.relpath(item.path, self.path)
                with open(item.path, 'rb') as file:
                    data = file.read()
                sha = hashlib.sha256(data).hexdigest()
                for context in checksums:
                    context.update(f'{rel}\0{sha}\0'.encode('ascii'))

    def check(self, at_least_prio):
        if 'requires' in self.manifest:
            requires = self.manifest['requires']
            if any(package != 'cockpit' for package in requires):
                return False

            if 'cockpit' in requires and VERSION < packaging.version.Version(requires['cockpit']):
                return False

        if at_least_prio is not None:
            if 'priority' not in self.manifest:
                return False

            if self.manifest['priority'] <= at_least_prio:
                return False

        return True

    @staticmethod
    def filename_variants(filename, locale):
        base, _, ext = filename.rpartition('.')

        while base:
            if locale:
                yield f'{base}.{locale}.{ext}'
                yield f'{base}.{locale}.{ext}.gz'

                if '_' in locale:
                    language, _, _ = locale.partition(' ')
                    yield f'{base}.{language}.{ext}'
                    yield f'{base}.{language}.{ext}.gz'

            yield f'{base}.{ext}'
            yield f'{base}.min.{ext}'
            yield f'{base}.{ext}'
            yield f'{base}.{ext}.gz'
            yield f'{base}.min.{ext}.gz'

            base, _, _stripped_ext = base.rpartition('.')

    def negotiate_file(self, path, headers):
        dirname, sep, filename = path.rpartition('/')
        locale = headers.get('Accept-Language', '').split(',')[0].strip()  # obviously fix this

        for variant in self.filename_variants(filename, locale):
            logger.debug('consider variant %s', variant)
            if f'{dirname}{sep}{variant}' in self.files:
                return f'{dirname}{sep}{variant}'

        return None

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

    def serve_file(self, path, channel):
        filename = self.negotiate_file(path, channel.headers)

        if filename is None:
            logger.debug('path %s not in %s', path, self.files)
            channel.http_error(404, 'Not found')
            return

        content_type, encoding = mimetypes.guess_type(filename)

        with open(f'{self.path}/{filename}', 'rb') as file:
            headers = {
                "Access-Control-Allow-Origin": channel.origin,
                "Content-Encoding": encoding,
            }
            if content_type is not None and content_type.startswith('text/html'):
                headers['Content-Security-Policy'] = self.get_content_security_policy(channel.origin)
            channel.http_ok(content_type, headers)
            channel.send_data(file.read())


class Packages:
    def __init__(self):
        self.packages = {}
        self.load_packages()

    def show(self):
        for name in sorted(self.packages):
            package = self.packages[name]
            menuitems = ''
            print(f'{name:20} {menuitems:40} {package.path}')
        if self.checksum:
            print(f'checksum = {self.checksum}')

    def try_xdg_dir(self, xdg_dir, checksums):
        try:
            items = directory_items(f'{xdg_dir}/cockpit')
        except FileNotFoundError:
            return

        for item in items:
            if item.is_dir():
                try:
                    package = Package(item)
                except FileNotFoundError:
                    continue

                if package.name in self.packages:
                    at_least_prio = self.packages[package.name].priority
                else:
                    at_least_prio = None

                if package.check(at_least_prio):
                    self.packages[package.name] = package
                    package.walk(checksums)

    def load_packages(self):
        checksums = []

        xdg_data_home = os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share')
        self.try_xdg_dir(xdg_data_home, checksums)

        # we only checksum the system content if there's no user content
        if not self.packages:
            checksums.append(hashlib.sha256())

        xdg_data_dirs = os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share')
        for xdg_dir in xdg_data_dirs.split(':'):
            self.try_xdg_dir(xdg_dir, checksums)

        if checksums:
            self.checksum = checksums[0].hexdigest()
        else:
            self.checksum = None

    def serve_manifests_js(self, channel):
        channel.http_ok('text/javascript')
        manifests = {name: package.manifest for name, package in self.packages.items()}
        channel.send_data(('''
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if (typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this, ''' + json.dumps(manifests) + '''))''').encode('ascii'))

    def serve_package_file(self, path, channel):
        package, _, package_path = path[1:].partition('/')
        self.packages[package].serve_file(package_path, channel)

    def serve_checksum(self, channel):
        channel.http_ok('text/plain')
        channel.send_data(self.checksum.encode('ascii'))

    def serve_file(self, path, channel):
        assert path[0] == '/'

        if self.checksum is not None:
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
