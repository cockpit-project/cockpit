# SPDX-License-Identifier: LGPL-2.1-or-later

import json
import os
import sys
from typing import Dict, List, Optional

import gi

gi.require_version('AppStream', '1.0')
from gi.repository import AppStream, Gio, GLib

loop = GLib.MainLoop()


def convert_stock_icon(icon_name: str):
    def try_size(size: str, extension: str):
        path = os.path.join("/usr/share/icons/hicolor", size, "apps", f"{icon_name}.{extension}")
        return path if os.path.exists(path) else None

    return (
        try_size("64x64", "svg")
        or try_size("64x64", "png")
        or try_size("128x128", "svg")
        or try_size("128x128", "png")
    )


def find_and_convert_icon(icon: AppStream.Icon) -> str:
    if icon is None:
        return None
    kind = icon.get_kind()
    if kind in [AppStream.IconKind.CACHED, AppStream.IconKind.LOCAL]:
        return icon.get_filename()
    elif kind == AppStream.IconKind.REMOTE:
        return icon.get_url()
    elif kind == AppStream.IconKind.STOCK:
        return convert_stock_icon(icon.get_name())
    return "foo"


def convert_screenshotshots(screenshots: List[AppStream.Screenshot]) -> List[str]:
    images = []
    for screenshot in screenshots:
        kind = screenshot.get_kind()
        if kind == AppStream.ScreenshotKind.UNKNOWN:
            continue
        for image in screenshot.get_images():
            if image.get_kind() != AppStream.ImageKind.SOURCE:
                continue
            url = image.get_url()
            if kind == AppStream.ScreenshotKind.DEFAULT:
                images.insert(0, url)
            elif not images and kind == AppStream.ScreenshotKind.EXTRA:
                images.append(url)
    return images


def convert_launchables(launchables: List[AppStream.Launchable]) -> List:
    ables = []

    for launchable in launchables:
        if launchable.get_kind() != AppStream.LaunchableKind.COCKPIT_MANIFEST:
            continue
        ables = ables + launchable.get_entries()

    return ables


def convert_urls(component: AppStream.Component) -> List[Dict]:
    # There is no get_urls for AppStream so we need to
    # actively check each type
    urls = []
    for kind in AppStream.UrlKind:
        c_url = component.get_url(kind)
        if c_url:
            urls.append({'type': kind.to_string(), 'link': c_url})
    return urls


def on_pool_changed(pool: AppStream.Pool) -> None:
    # NOTE: Don't use get_components() unless you absolutely have to, it's a
    # very expensive operation. This is just for testing!
    # You will definitely want to do something else here...
    components = {}
    # box = pool.get_components()
    box = pool.get_components_by_extends("org.cockpit_project.cockpit")
    for c in box.as_array():
        c_id = c.get_id()
        icon = find_and_convert_icon(c.get_icon_stock())
        components[c_id] = {
            'id': c_id,
            'pkgname': c.get_pkgname(),
            "name": c.get_name(),
            'summary': c.get_summary(),
            'description': c.get_description(),
            'icon': icon,
            'screenshots': convert_screenshotshots(c.get_screenshots_all()),
            'launchables': convert_launchables(c.get_launchables()),
            'urls': convert_urls(c)
        }
    sys.stdout.write(json.dumps(components) + '\n')
    sys.stdout.flush()

pool = AppStream.Pool()
if os.environ.get('LANGUAGE'):
    pool.set_locale(os.environ.get('LANGUAGE'))
pool.add_flags(AppStream.PoolFlags.MONITOR)
pool.remove_flags(AppStream.PoolFlags.LOAD_FLATPAK)

# Connect signal before loading, so you can observe changes during/after load.
pool.connect("changed", on_pool_changed)

# Async loading, but if sync loading is okay, just running pool.load() means
# you could skip all MainLoop() stuff
pool.load()
on_pool_changed(pool)
# box = pool.get_components_by_extends("org.cockpit_project.cockpit").get_size()

# for component in box.as_array():
#     print(component.get_name())
#     print(component.get_summary())
#     print(component.get_id())

# wait for on_load_done to be called
loop.run()

# for cpt in pool.search("cockpit").as_array():
#     print(cpt.get_id())

# pool.load()
# box = pool.get_components_by_extends("org.cockpit_project.cockpit")
# pool.clear()

# for component in box.as_array():
#     print(component.get_name())
#     print(component.get_summary())
#     print(component.get_id())
