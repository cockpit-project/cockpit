#!/usr/bin/python3

import argparse
import hashlib

parser = argparse.ArgumentParser()
parser.add_argument('bootloader')
parser.add_argument('name')
parser.add_argument('version')
parser.add_argument('filename')
args = parser.parse_args()

# The bootloader body needs to have no newlines inside of it
# or else the REPL will return to the top-level
with open(args.bootloader) as file:
    for line in file.read().splitlines():
        if line:
            print(line)

# This is our payload
with open(args.filename, 'rb') as file:
    data = file.read()
    sha256 = hashlib.sha256(data).hexdigest()

# Now we add one newline, plus the invocation of the bootloader
print()
print('BOOTLOADER = Bootloader()')
print(f'BOOTLOADER.start("{args.name}", "{args.version}", "{sha256}", {len(data)})')
