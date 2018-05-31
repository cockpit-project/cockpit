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
    result = subprocess.run([ "cryptsetup", "luksDump", dev ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    slots = [ ]
    data = { "slots": slots, "version": 1 }
    if result.returncode != 0:
        return data
    in_luks2_slot_section = False
    for line in result.stdout.splitlines():
        if line == b"Keyslots:":
            in_luks2_slot_section = True
            data["version"] = 2
        elif not line.startswith(b" "):
            in_luks2_slot_section = False
        if not in_luks2_slot_section:
            match = re.fullmatch(b"Key Slot ([0-9]+): ENABLED", line)
        else:
            match = re.fullmatch(b"  ([0-9]+): luks2", line)
        if match:
            slot = int(match.group(1))
            entry = { "Index": { "v": slot } }
            luksmeta = subprocess.run([ "luksmeta", "load", "-d", dev, "-s", str(slot),
                                        "-u", "cb6e8904-81ff-40da-a84a-07ab9ab5715e" ],
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if (luksmeta.returncode == 0):
                entry["ClevisConfig"] = { "v": json.dumps(get_clevis_config(luksmeta.stdout.decode("utf-8"))) }
            slots.append(entry)
    return data

def monitor(dev):
    path = subprocess.check_output([ "udevadm", "info", "-q", "path", dev ]).rstrip(b"\n")
    mon = subprocess.Popen([ "stdbuf", "-o", "L", "udevadm", "monitor", "-u", "-s", "block"],
                           bufsize=1, stdout=subprocess.PIPE)

    old_infos = info(dev)
    sys.stdout.write(json.dumps(old_infos) + "\n")
    sys.stdout.flush()
    while True:
        line = mon.stdout.readline()
        if path in line:
            new_infos = info(dev)
            if new_infos != old_infos:
                sys.stdout.write(json.dumps(new_infos) + "\n")
                sys.stdout.flush()
                old_infos = new_infos

monitor(sys.argv[1])
