#!/usr/bin/python3

import gi
gi.require_version('Libosinfo', '1.0')
from gi.repository import Libosinfo
import sys
import json


class _OsinfoIter:
    """
    Helper to turn osinfo style get_length/get_nth lists into python
    iterables
    """
    def __init__(self, listobj):
        self.current = 0
        self.listobj = listobj
        self.high = -1
        if self.listobj:
            self.high = self.listobj.get_length() - 1

    def __iter__(self):
        return self
    def __next__(self):
        if self.current > self.high:
            raise StopIteration
        ret = self.listobj.get_nth(self.current)
        self.current += 1
        return ret

loader = Libosinfo.Loader()
loader.process_default_path()
db = loader.get_db()

oses = db.get_os_list()
res = []
for i in range(oses.get_length()):
    os = oses.get_nth(i)

    osObj = {}
    osObj['id'] = os.get_id() or ""
    osObj['shortId'] = os.get_short_id() or ""
    osObj['name'] = os.get_name() or ""
    osObj['version'] = os.get_version() or ""
    osObj['family'] = os.get_family() or ""
    osObj['vendor'] = os.get_vendor() or ""
    osObj['releaseDate'] = os.get_release_date_string() or ""
    osObj['eolDate'] = os.get_eol_date_string() or ""
    osObj['codename'] = os.get_codename() or ""
    osObj['availableProfiles'] = []
    osInstallScripts = os.get_install_script_list()
    for script in list(_OsinfoIter(osInstallScripts)):
        osObj['availableProfiles'].append(script.get_profile())

    res.append(osObj)

print(json.dumps(res))
