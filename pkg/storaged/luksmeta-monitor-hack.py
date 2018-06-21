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

def get_clevis_config(jwe):
    header = b64_decode(jwe.split(".")[0]).decode("utf-8")
    header_object = json.loads(header)
    clevis = header_object.get("clevis", None)
    if clevis:
        pin = clevis.get("pin", None)
        if pin == "tang":
            return clevis
        elif pin == "sss":
            subpins = { }
            jwes = clevis["sss"]["jwe"]
            for jwe in jwes:
                subconf = get_clevis_config(jwe)
                subpin = subconf["pin"]
                if subpin not in subpins:
                    subpins[subpin] = [ subconf[subpin] ]
                else:
                    subpins[subpin].append(subconf[subpin])
            return { "pin": "sss", "sss": { "t": clevis["sss"]["t"], "pins": subpins } }
        else:
            return { "pin": pin, pin: { } }

def info(dev):
    result = subprocess.run([ "luksmeta", "show", "-d", dev ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    slots = [ ]
    if result.returncode != 0:
        return slots
    for line in result.stdout.splitlines():
        fields = re.split(b" +", line)
        if fields[1] == b"active":
            if fields[2] == b"cb6e8904-81ff-40da-a84a-07ab9ab5715e":
                jwe = subprocess.check_output([ "luksmeta", "load", "-d", dev, "-s", fields[0] ]).decode("utf-8")
                config = get_clevis_config(jwe)
                if config:
                    slots.append({ "Index": { "v": int(fields[0]) },
                                   "ClevisConfig": { "v": json.dumps(config) } })
            else:
                slots.append({ "Index": { "v": int(fields[0]) } })
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
