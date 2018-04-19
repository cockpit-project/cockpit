#! /usr/bin/python3

# This is a huge hack, let's not bother to make it nice and efficient.

import sys
import os
import json
import subprocess
import base64
import hashlib
import re

import urllib.request

def b64_decode(data):
    # The data we get doesn't seem to have any padding, but the base64
    # module requires it.  So we add it back.  Can't anyone agree on
    # anything?  Not even base64?
    return base64.urlsafe_b64decode(data + '=' * ((4 - len(data) % 4) % 4))

def decode_clevis_slot(dev, slot):
    out = subprocess.check_output([ "luksmeta", "load", "-d", dev, "-s", str(slot) ])
    data = json.loads(b64_decode(out.decode().split(".")[0]))
    if data['clevis']['pin'] == "tang":
        return {
            "slot": slot,
            "type": "tang",
            "url": data['clevis']['tang']['url'],
            "key": data['kid'],
            "sigkeys": list(map(compute_thp, filter(is_signing_key, data['clevis']['tang']['adv']['keys']))),
        }
    if data['clevis']['pin'] == "http":
        return {
            "slot": slot,
            "type": "http",
            "url": data['clevis']['http']['url'],
        }

def info(dev):
    result = subprocess.run([ "luksmeta", "show", "-d", dev ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    slots = [ ]
    if result.returncode != 0:
        return None
    for line in result.stdout.splitlines():
        fields = re.split(b" +", line)
        if fields[1] == b"active" and fields[2] == b"cb6e8904-81ff-40da-a84a-07ab9ab5715e":
            info = decode_clevis_slot(dev, int(fields[0]))
            if info:
                slots.append(info)
    return slots

def infos():
    res = { }
    for dev in subprocess.check_output([ "lsblk", "-pln", "-o", "NAME" ]).splitlines():
        i = info(dev)
        if i:
            res[dev.decode()] = i
    return res

def monitor():
    mon = subprocess.Popen([ "stdbuf", "-o", "L", "udevadm", "monitor", "-u", "-s", "block"],
                           bufsize=1, stdout=subprocess.PIPE)

    old_infos = infos()
    sys.stdout.write(json.dumps(old_infos) + "\n")
    sys.stdout.flush()
    while True:
        line = mon.stdout.readline()
        if b"UDEV" in line:
            new_infos = infos()
            if new_infos != old_infos:
                sys.stdout.write(json.dumps(new_infos) + "\n")
                sys.stdout.flush()
                old_infos = new_infos

def remove(dev, slot):
    # XXX - require passphrase?  Not for security, but to avoid accidents.
    # cryptsetup needs a terminal on stdin, even with -q or --key-file.
    pty = os.openpty()
    subprocess.check_call([ "cryptsetup", "luksKillSlot", "-q", dev, str(slot) ], stdin=pty[0])
    subprocess.check_call([ "luksmeta", "wipe", "-d", dev, "-s", str(slot), "-f" ])

REQUIRED_ATTRS = {
    'RSA': ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
    'EC':  ['kty', 'crv', 'x', 'y'],
    'oct': ['kty', 'k'],
}

def compute_thp(jwk):
    jwk = {k: v for k, v in jwk.items() if k in REQUIRED_ATTRS[jwk['kty']]}
    jwk = json.dumps(jwk, sort_keys=True, separators=(',', ':'))
    thp = hashlib.sha1(jwk.encode('utf8')).digest()
    return base64.urlsafe_b64encode(thp).decode('utf8').rstrip('=')

def is_signing_key(jwk):
    use = jwk.get('use', None)
    ops = jwk.get('key_ops', None)
    if use is None and ops is None:
        return True
    if use == 'sig':
        return True
    if ops is not None and 'verify' in ops:
        return True
    return False

def get_tang_adv(url):
    if not "://" in url:
        url = "http://" + url
    with urllib.request.urlopen(url + "/adv") as rsp:
        adv_text = rsp.read()
        adv = json.loads(adv_text.decode())
        payload = json.loads(b64_decode(adv['payload']))
        info = {
            "adv": adv,
            "sha1sum": hashlib.sha1(adv_text).hexdigest(),
            "keys": list(map(compute_thp, payload['keys'])),
            "sigkeys": list(map(compute_thp, filter(is_signing_key, payload['keys']))),
        }
        sys.stdout.write(json.dumps(info) + "\n")
        sys.stdout.flush()

def add(dev, pin, config, passphrase):
    subprocess.run([ "clevis", "luks", "bind", "-f", "-k", "-", "-d", dev, pin, config ],
                   check=True, input=passphrase.encode())

def check_key(dev, slot):
    jwe = subprocess.check_output([ "luksmeta", "load", "-d", dev, "-s", slot ])
    subprocess.run([ "clevis", "decrypt" ],
                   check = True, input = jwe, stdout=subprocess.PIPE).stdout

def replace(dev, slot, pin, config):
    jwe = subprocess.check_output([ "luksmeta", "load", "-d", dev, "-s", slot ])
    passphrase = subprocess.run([ "clevis", "decrypt" ],
                                check = True, input = jwe, stdout=subprocess.PIPE).stdout
    new_jwe = subprocess.run([ "clevis", "encrypt", pin, config ],
                             check = True, input = passphrase, stdout=subprocess.PIPE).stdout
    subprocess.run([ "luksmeta", "wipe", "-d", dev, "-s", slot, "-f" ])
    subprocess.run([ "luksmeta", "save", "-d", dev, "-s", slot, "-u", "cb6e8904-81ff-40da-a84a-07ab9ab5715e" ],
                   check = True, input = new_jwe)

def unlock(dev):
    # XXX - clevis-luks-unlock always exits 1, so we check whether the
    # expected device exists afterwards.
    clear_dev = b"luks-" + subprocess.check_output([ "cryptsetup", "luksUUID", dev ]).strip()
    subprocess.run([ "clevis", "luks", "unlock", "-d", dev, "-n", clear_dev ])
    sys.exit(0 if os.path.exists(b"/dev/mapper/" + clear_dev) else 1)

if sys.argv[1] == "monitor":
    monitor()
elif sys.argv[1] == "remove":
    remove(sys.argv[2], int(sys.argv[3]))
elif sys.argv[1] == "get-tang-adv":
    get_tang_adv(sys.argv[2])
elif sys.argv[1] == "add":
    add(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
elif sys.argv[1] == "check-key":
    check_key(sys.argv[2], sys.argv[3])
elif sys.argv[1] == "replace":
    replace(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
elif sys.argv[1] == "unlock":
    unlock(sys.argv[2])
else:
    raise RuntimeError("Nope")
