import os
import sys
import time
import traceback

import gzip
import xml.etree.ElementTree as ET
import json

import ctypes
import struct

# Our own little abstraction on top of inotify.  This only supports
# watching directories non-recursively, but it also supports watching
# directories that come and go into and out of existence.
#
# We could use pyinotify for this, but it would only be able to
# replace the Inotify class; we would still need all the logic in the
# Watcher class.

IN_CLOSE_WRITE = 0x00000008
IN_MOVED_FROM  = 0x00000040
IN_MOVED_TO    = 0x00000080
IN_CREATE      = 0x00000100
IN_DELETE      = 0x00000200
IN_DELETE_SELF = 0x00000400
IN_MOVE_SELF   = 0x00000800

class Inotify:
    def __init__(self):
        self._libc = ctypes.CDLL(None, use_errno=True)
        self._get_errno_func = ctypes.get_errno

        self._libc.inotify_init.argtypes = []
        self._libc.inotify_init.restype = ctypes.c_int
        self._libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p,
                                                 ctypes.c_uint32]
        self._libc.inotify_add_watch.restype = ctypes.c_int
        self._libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
        self._libc.inotify_rm_watch.restype = ctypes.c_int

        self.fd = self._libc.inotify_init()

    def add_watch(self, path, mask):
        path = ctypes.create_string_buffer(path.encode(sys.getfilesystemencoding()))
        wd = self._libc.inotify_add_watch(self.fd, path, mask)
        if wd < 0:
            sys.stderr.write("can't add watch for %s: %s\n" % (path, os.strerror(self._get_errno_func())))
        return wd

    def rem_watch(self, wd):
        if self._libc.inotify_rm_watch(self.fd, wd) < 0:
            sys.stderr.write("can't remove watch: %s\n" % (os.strerror(self._get_errno_func())))

    def run(self, callback):
        while True:
            buf = os.read(self.fd, 4096) # XXX - handle errors
            pos = 0
            while pos < len(buf):
                (wd, mask, cookie, name_len) = struct.unpack('iIII', buf[pos:pos+16])
                pos += 16
                (name,) = struct.unpack('%ds' % name_len, buf[pos:pos + name_len])
                pos += name_len
                callback(wd, mask, name.decode().rstrip('\0'))

class Watcher:

    def __init__(self):
        self.inotify = Inotify()
        self.watches = { } # path -> wd
        self.handlers = { } # wd -> set of callbacks

    def __add_watch(self, path, mask, handler):
        if path in self.watches:
            wd = self.watches[path]
            self.handlers[wd] = self.handlers[wd] | frozenset([ handler ])
        else:
            wd = self.inotify.add_watch(path, mask)
            if wd >= 0:
                self.watches[path] = wd
                self.handlers[wd] = frozenset([ handler ])

    def __rem_watch(self, path, handler):
        wd = self.watches[path]
        self.handlers[wd] = self.handlers[wd] - frozenset([ handler ])
        if len(self.handlers[wd]) == 0:
            self.inotify.rem_watch(wd)
            del self.handlers[wd]
            del self.watches[path]

    def watch_directory(self, path, callback):

        events = (IN_CREATE |
                  IN_MOVED_TO |
                  IN_MOVED_FROM |
                  IN_DELETE_SELF |
                  IN_CLOSE_WRITE |
                  IN_DELETE |
                  IN_MOVE_SELF)

        def handler(mask, name):
            if ((mask & IN_CREATE or mask & IN_MOVED_TO) and
                cur_wait and name == cur_wait):
                reset()
            elif mask & (IN_DELETE_SELF | IN_MOVE_SELF):
                reset()
            elif not cur_wait and len(name) > 0:
                if mask & (IN_CLOSE_WRITE | IN_MOVED_TO | IN_DELETE | IN_MOVED_FROM):
                    callback(os.path.join(path, name))

        def reset():
            self.__rem_watch(cur_path, handler)
            self.watch_directory(path, callback)

        cur_path = path
        cur_wait = None
        while not os.path.exists(cur_path):
            cur_wait = os.path.basename(cur_path)
            cur_path = os.path.dirname(cur_path)

        self.__add_watch(cur_path, events, handler)

        if not cur_wait:
            for f in os.listdir(cur_path):
                callback(os.path.join(cur_path, f))

    def run(self):
        def event(wd, mask, name):
            if wd in self.handlers:
                for h in self.handlers[wd]:
                    h(mask, name)
        self.inotify.run(event)

lang = os.environ.get('LANGUAGE')

def attr_lang(elt):
    return elt.attrib.get('{http://www.w3.org/XML/1998/namespace}lang')

def element(xml, tag):
    if lang:
        for elt in xml.iter(tag):
            if attr_lang(elt) == lang:
                return elt
    return xml.find(tag)

def element_value(xml, tag):
    elt = element(xml, tag)
    return elt.text if elt is not None else None

def convert_description(xml, use_lang = True):
    if xml is None:
        return None

    want_lang = lang if use_lang else None

    # Only the following constructs are allowed, and they all appear
    # at the top level:
    #
    # <p>text</p>
    # <ul><li>text</li>...</ul>
    # <ol><li>text</li>...</ol>

    # A description can have 'lang' attributes both on the actual
    # <description> element and on the contained <p>, <ul>, and <ol>
    # elements, but probably not on the <li> elements.

    def text(xml):
        return " ".join(xml.itertext())

    res = [ ]
    for c in xml:
        if attr_lang(c) != want_lang:
            continue
        if c.tag == 'p':
            res.append(text(c))
        elif c.tag == 'ul' or c.tag == 'ol':
            res.append({ 'tag': c.tag, 'items': list(map(text, c.findall('li'))) })

    # If we found nothing that matches lang, fall back to default
    if lang is not None and len(res) == 0:
        res = convert_description(xml, False)

    return res

def convert_cached_icon(dir, origin, xml):
    icon = xml.text

    def try_size(sz):
        path = os.path.join(dir, "..", "icons", origin, sz, icon)
        return path if os.path.exists(path) else None

    return try_size("64x64") or try_size("128x128")

def convert_remote_icon(xml):
    url = xml.text
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return None

def convert_local_icon(xml):
    path = xml.text
    if path.startswith("/"):
        return path
    return None

def find_and_convert_icon(dir, origin, xml):
    if xml is None:
        return None

    # Just use the first icon.
    icon = xml.find('icon')

    if icon is not None:
        if icon.attrib['type'] == 'cached':
            return convert_cached_icon(dir, origin, icon)
        elif icon.attrib['type'] == 'remote':
            return convert_remote_icon(icon)
        elif icon.attrib['type'] == 'local':
            return convert_local_icon(icon)

    return None

def convert_screenshots(xml):
    if xml is None:
        return [ ]

    shots = [ ]
    for sh in xml.iter('screenshot'):
        for img in sh.iter('image'):
            if img.attrib['type'] == 'source':
                shots.append({ 'full': img.text })

    return shots

def convert_launchables(xml):
    ables = [ ]

    for elt in xml.iter('launchable'):
        type = elt.attrib['type']
        if type == "cockpit-manifest":
            ables.append({ 'name': elt.text, 'type': type })

    return ables

def convert_collection_component(dir, origin, xml):
    id = element_value(xml, 'id')
    pkgname = element_value(xml, 'pkgname')
    launchables = convert_launchables(xml)

    if not id or not pkgname or len(launchables) == 0:
        return None

    return {
        'id': id,
        'pkgname': pkgname,
        'name': element_value(xml, 'name'),
        'summary': element_value(xml, 'summary'),
        'description': convert_description(element(xml, 'description')),
        'icon': find_and_convert_icon(dir, origin, xml),
        'screenshots': convert_screenshots(element(xml, 'screenshots')),
        'launchables': launchables
    }

def convert_upstream_component(file, xml):
    if xml.tag != 'component':
        return None

    launchables = convert_launchables(xml)
    if len(launchables) ==  0:
        return None

    return {
        'id': element_value(xml, 'id'),
        'name': element_value(xml, 'name'),
        'summary': element_value(xml, 'summary'),
        'description': convert_description(element(xml, 'description')),
        'icon': find_and_convert_icon(dir, '', xml),
        'screenshots': convert_screenshots(element(xml, 'screenshots')),
        'launchables': launchables,
        'installed': True,
        'file': file
    }

class MetainfoDB:
    def __init__(self):
        self.dumping = False
        self.installed_by_file = { }
        self.available_by_file = { }

    def notice_installed(self, file, xml_root):
        if xml_root is not None:
            comp = convert_upstream_component(file, xml_root)
            if comp is not None:
                self.installed_by_file[file] = comp;
        elif file in self.installed_by_file:
            del self.installed_by_file[file];
        if self.dumping:
            self.dump()

    def notice_available(self, file, xml_root):
        if xml_root is not None:
            info = { }
            origin = xml_root.attrib['origin']
            for xml_comp in xml_root.iter('component'):
                comp = convert_collection_component(os.path.dirname(file), origin, xml_comp)
                if comp is not None:
                    if comp['id'] in info:
                        pass # warning: duplicate id
                    else:
                        info[comp['id']] = comp
            self.available_by_file[file] = info
        elif file in self.available_by_file:
            del self.available_by_file[file]
        if self.dumping:
            self.dump()

    def dump(self):
        comps = { }
        for file in self.installed_by_file:
            comp = self.installed_by_file[file]
            if comp['id'] in comps:
                pass # warn dup
            else:
                comps[comp['id']] = comp;
        for file in self.available_by_file:
            for id in self.available_by_file[file]:
                comp = self.available_by_file[file][id]
                if not comp['id'] in comps:
                    comps[comp['id']] = comp;
                else:
                    z = comps[comp['id']].copy()
                    z.update(comp)
                    comps[comp['id']] = z;

        data = {
            'components': comps,
            'origin_files': list(self.available_by_file.keys())
        }

        sys.stdout.write(json.dumps(data) + '\n')
        sys.stdout.flush()

    def start_dumping(self):
        self.dump()
        self.dumping = True

def watch_db():
    watcher = Watcher()

    db = MetainfoDB()

    def process_file(path, callback):
        try:
            if not os.path.exists(path):
                callback(path, None)
            elif path.endswith('.xml'):
                callback(path, ET.parse(path).getroot())
            elif path.endswith('.xml.gz'):
                callback(path, ET.parse(gzip.open(path)).getroot())
        except:
            # If we hit an exception during handling a file, pretend
            # that it doesn't exist instead of keeping old data.  This
            # makes the behavior consistent across restarts of this
            # watcher.
            callback(path, None)
            sys.stderr.write("%s: " % path)
            sys.stderr.write("".join(traceback.format_exception_only(sys.exc_info()[0], sys.exc_info()[1])))
            sys.stderr.flush()

    def installed_callback(path):
        process_file(path, lambda path, xml: db.notice_installed(path, xml))

    def available_callback(path):
        process_file(path, lambda path, xml: db.notice_available(path, xml))

    watcher.watch_directory('/usr/share/metainfo',      installed_callback)
    watcher.watch_directory('/usr/share/app-info/xmls', available_callback)
    watcher.watch_directory('/var/cache/app-info/xmls', available_callback)
    db.start_dumping()
    watcher.run()

watch_db()
