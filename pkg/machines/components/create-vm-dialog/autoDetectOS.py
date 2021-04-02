#!/usr/bin/python3

import gi
gi.require_version('Libosinfo', '1.0')
from gi.repository import Libosinfo
import sys
import json


loader = Libosinfo.Loader()
loader.process_default_path()
db = loader.get_db()

url_type_media = sys.argv[1].endswith(".iso")

os = None
res = {}
if url_type_media:
    media = Libosinfo.Media().create_from_location(sys.argv[1])
    db.identify_media(media)
    os = media.get_os()
    if os:
        res = {'os': os.get_id(), 'media': media.get_id()}
else:
    tree = Libosinfo.Tree().create_from_location(sys.argv[1])
    os, _ = db.guess_os_from_tree(tree)
    if os:
        res = {'os': os.get_id()}

print(json.dumps(res))
