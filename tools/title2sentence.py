#!/usr/bin/env python3

# This file is part of Cockpit.
#
# Copyright (C) 2020 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.


import sys
import argparse

keep_words = [
    'Web Console', 'Cockpit',
    'Red Hat',
    'Insights',
    'Docker',
    'Customer Portal',
    'SELinux', 'SETroubleshoot',
    'Tang',
    'iSCSI',
    'Linux',
    'NetworkManager',
    'PackageKit',
    'vCPU',
    'IPv4', 'IPv6',
    'IoT',
    'ID',
    ': Server',
    ': Invalid',
    'KiB', 'MiB', 'GiB',
    'ABRT Analytics',
    'GNOME Software',
    'CAs', 'VMs', 'CPUs',
    'Hour : Minute',
    'Ctrl+Alt',
    '$ExitCode',
    'Launch Remote Viewer',
    'Failed to start',
]

patterns = [
    "of $0 CPU",
    "No memory reserved. Append a crashkernel option",
    "Cockpit was unable to log in",
    "Cockpit had an unexpected internal error",
    "You need to switch to",
    "Free up space in this group",
    "This day doesn",
    "Tip: Make your key",
    "virt-install package needs to be",
    "You need to switch to",
]

the_map = []

# Replace exact positions
def replace(s, old_s, word):
    if not word.strip():
        return s

    while word in old_s:
        i = old_s.find(word)
        s = s[:i] + word + s[i + len(word):]
        old_s = old_s.replace(word, " " * len(word), 1)

    return s

def capitalize(s):
    for word in keep_words:
        if s.startswith(word):
            return s

    return s[0].upper() + s[1:]

def main():
    parser = argparse.ArgumentParser(description="TODO")
    parser.add_argument("-i", "--input", required=True, help="File containing strings")
    parser.add_argument("-o", "--output", required=True, help="File for output script to be written into")
    opts = parser.parse_args()

    with open(opts.input, "r") as f:
        for line in f:
            old_s = line.strip()
            old_s = old_s[1:-1] # Remove first and last quotes

            if not old_s:
                continue

            # Leave out strings that don't contain a single upper case letter
            if not [x for x in old_s if x.isupper()]:
                continue

            # MEH: There are some strings that don't need any action but are tricky to ignore
            skip = False
            for pattern in patterns:
                if old_s.startswith(pattern):
                    skip = True
            if skip:
                continue

            # Backslash special characters
            for c in ['"', "&", "$", "/"]:
                if c in old_s:
                    old_s = old_s.replace(c, "\\{0}".format(c))

            new_s = old_s.lower()

            # Return words that should stay upper-case
            for word in keep_words:
                new_s = replace(new_s, old_s, word)

            # Return words that were all caps before (stuff like 'CPU', 'DNS'...)
            for word in old_s.split(" "):
                if word == word.upper():
                    new_s = replace(new_s, old_s, word)

            # Return capitalization of (multiple) sentences
            sentences = new_s.split(". ")
            Sentences = list(map(capitalize, sentences))
            new_s = ". ".join(Sentences)

            if new_s != old_s:
                the_map.append([old_s, new_s])

    # Generate script for replacing these strings
    output = ""
    if the_map:
        output = "find pkg src test/verify -type f -exec sed -i \\\n"
        for pair in the_map:
            output += '-e "s/\([^ ]\){0}/\\1{1}/" \\\n'.format(pair[0], pair[1])
        output += "{} \;"

    with open(opts.output, "w") as f:
        f.write(output)

if __name__ == '__main__':
    sys.exit(main())
