#!/usr/bin/python3

import gi
gi.require_version('Libosinfo', '1.0')
from gi.repository import Libosinfo
import sys


loader = Libosinfo.Loader()
loader.process_default_path()
db = loader.get_db()

oses = db.get_os_list()
for i in range(oses.get_length()):
    os = oses.get_nth(i)

    osId = os.get_id() or ""
    osShortId = os.get_short_id() or ""
    osName = os.get_name() or ""
    osVersion = os.get_version() or ""
    osFamily = os.get_family() or ""
    osVendor = os.get_vendor() or ""
    osReleaseDate = os.get_release_date_string() or ""
    osEOLDate = os.get_eol_date_string() or ""
    osCodename = os.get_codename() or ""

    print("%s|%s|%s|%s|%s|%s|%s|%s|%s" %
          (osId, osShortId, osName, osVersion, osFamily, osVendor,
           osReleaseDate, osEOLDate, osCodename))
