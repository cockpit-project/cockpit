#!/usr/bin/python

import logging
import json

from cockpit.packages import Manifest

logging.basicConfig(format='%(name)s-%(levelname)s: %(message)s')
logging.getLogger().setLevel(level=logging.DEBUG)


manifest = Manifest.from_json(**json.load(open('pkg/systemd/manifest.json', 'r')))
print(manifest.name)
valid = manifest.validate()
if not valid:
    print('invalid')


