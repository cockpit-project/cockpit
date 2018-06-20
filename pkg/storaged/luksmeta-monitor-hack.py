#! /usr/bin/python3

# This simulates the org.freedesktop.UDisks.Encrypted.Slots property
# for versions of UDisks that don't have it yet.

import sys
import json
import subprocess
import re
import base64

def b64_decode(data):
    # The data we get doesn't seem to have any padding, but the base64
    # module requires it.  So we add it back.  Can't anyone agree on
    # anything?  Not even base64?
    return base64.urlsafe_b64decode(data + '=' * ((4 - len(data) % 4) % 4))

def info(dev):
    result = subprocess.run([ "luksmeta", "show", "-d", dev ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    slots = [ ]
    if result.returncode != 0:
        return slots
    for line in result.stdout.splitlines():
        fields = re.split(b" +", line)
        info = { "Index": { "v": int(fields[0]) },
                 "Active": { "v": fields[1] == b"active" } }
        if fields[2] == b"cb6e8904-81ff-40da-a84a-07ab9ab5715e":
            raw = subprocess.check_output([ "luksmeta", "load", "-d", dev, "-s", fields[0] ]).decode("utf-8")
            header = b64_decode(raw.split(".")[0]).decode("utf-8")
            header_object = json.loads(header)
            if "clevis" in header_object and header_object["clevis"]["pin"] == "tang":
                info["ClevisConfig"] = { "v": json.dumps(header_object["clevis"]) }
        if fields[1] == b"active" or "ClevisConfig" in info:
            slots.append(info)
    return slots

def monitor(dev):
    mon = subprocess.Popen([ "stdbuf", "-o", "L", "udevadm", "monitor", "-u", "-s", "block"],
                           bufsize=1, stdout=subprocess.PIPE)

    old_infos = info(dev)
    sys.stdout.write(json.dumps(old_infos) + "\n")
    sys.stdout.flush()
    while True:
        line = mon.stdout.readline()
        if b"UDEV" in line:
            new_infos = info(dev)
            if new_infos != old_infos:
                sys.stdout.write(json.dumps(new_infos) + "\n")
                sys.stdout.flush()
                old_infos = new_infos

monitor(sys.argv[1])
