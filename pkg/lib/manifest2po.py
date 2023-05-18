#!/usr/bin/env python3
# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
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

# Extracts translatable strings from manifest.json files.

import argparse
import json
import os
import re
import sys
from typing import Dict

import polib


def process_manifest(filename, entries, manifest):
    if "menu" in manifest:
        process_menu(filename, entries, manifest["menu"])
    if "tools" in manifest:
        process_menu(filename, entries, manifest["tools"])
    if "bridges" in manifest:
        process_bridges(filename, entries, manifest["bridges"])


def process_keywords(filename, entries, keywords):
    for v in keywords:
        for keyword in v["matches"]:
            push(entries, msgid=keyword, location=(filename, "0"))


def process_docs(filename, entries, docs):
    for doc in docs:
        push(entries, msgid=doc["label"], location=(filename, "0"))


def process_menu(filename, entries, menu):
    for m in menu:
        if "label" in menu[m]:
            push(entries, msgid=menu[m]["label"], location=(filename, "0"))
        if "keywords" in menu[m]:
            process_keywords(filename, entries, menu[m]["keywords"])
        if "docs" in menu[m]:
            process_docs(filename, entries, menu[m]["docs"])


def process_bridges(filename, entries, bridges):
    for b in bridges:
        if "label" in b:
            push(entries, msgid=b["label"], location=(filename, "0"))


def push(entries, msgid, location):
    """
    Push an entry onto the list
    """
    key = msgid
    if key in entries:
        entries[key].occurrences.append(location)
    else:
        entries[key] = polib.POEntry(msgid=msgid, occurrences=[location])


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="manifest2po",
        description="Extracts translatable strings from manifest.json files",
    )
    parser.add_argument("-d", "--directory", help="Base directory for input files")
    parser.add_argument("-o", "--output", help="Output file", required=True)
    parser.add_argument(
        "files", nargs="+", help="One or more input files", metavar="FILE"
    )

    args = parser.parse_args()

    # The unique messages extracted from the files
    entries: Dict[str, polib.POEntry] = {}

    # Now process each file in turn
    for filename in args.files:
        if os.path.basename(filename) != "manifest.json":
            continue

        # Qualify the filename if necessary
        full = filename
        if args.directory:
            full = os.path.join(args.directory, filename)

        with open(full) as f:
            data = f.read()

        # There are variables which when not substituted can cause JSON.parse to fail
        # Dummy replace them. None variable is going to be translated anyway
        safe_data = re.sub(r"@.+?@", "1", data)
        process_manifest(filename, entries, json.loads(safe_data))

    po = polib.POFile()
    po.metadata = {
        "Project-Id-Version": "PACKAGE_VERSION",
        "MIME-Version": "1.0",
        "Content-Type": "text/plain; charset=UTF-8",
        "Content-Transfer-Encoding": "8bit",
        "X-Generator": "Cockpit manifest2po",
    }
    for entry in entries.values():
        po.append(entry)

    if args.output:
        po.save(args.output)
    else:
        sys.stdout.write(str(po))


if __name__ == "__main__":
    main()
