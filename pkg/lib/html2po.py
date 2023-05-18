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

# Extracts translatable strings from HTML files in the following forms:
#
# <tag translate>String</tag>
# <tag translate context="value">String</tag>
# <tag translate="...">String</tag>
# <tag translate-attr attr="String"></tag>
#
# Supports the following angular-gettext compatible forms:
#
# <translate>String</translate>
# <tag translate-plural="Plural">Singular</tag>
#
# Note that some of the use of the translated may not support all the strings
# depending on the code actually using these strings to translate the HTML.

import argparse
import os
import sys
from typing import Dict

import bs4
import polib


def scan_tags(filename, entries, soup):
    """
    Look for tags marked as translatable and extract them
    """

    def is_translatable(tag):
        return tag.has_attr("translate") or tag.has_attr("translatable")

    tags = soup.find_all(is_translatable)

    # Extract translate strings
    for tag in tags:
        tasks = (
            tag.attrs.get("translate") or tag.attrs.get("translatable") or "yes"
        ).split(" ")

        # Calculate the line location
        line = tag.sourceline or 0

        msgctxt = tag.attrs.get("translate-context") or tag.attrs.get("context")
        msgid_plural = tag.attrs.get("translate-plural")
        location = (filename, str(line))

        # For each thing listed
        for task in tasks:
            msgid = None
            # The element text itself
            if task == "yes" or task == "translate":
                msgid = tag.get_text(strip=True)
            # An attribute
            elif task:
                msgid = tag.attrs[task]

            if msgid:
                push(
                    entries,
                    msgid=msgid,
                    msgid_plural=msgid_plural,
                    msgctxt=msgctxt,
                    location=location,
                )


def push(entries, msgid, msgid_plural, msgctxt, location):
    """
    Push an entry onto the list
    """
    key = msgid + "\0" + (msgid_plural or "") + "\0" + (msgctxt or "")
    if key in entries:
        entries[key].occurrences.append(location)
    else:
        entries[key] = polib.POEntry(
            msgid=msgid,
            msgid_plural=msgid_plural,
            msgctxt=msgctxt,
            occurrences=[location],
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="html2po",
        description="Extracts translatable strings from HTML files",
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
        # Qualify the filename if necessary
        full = filename
        if args.directory:
            full = os.path.join(args.directory, filename)

        with open(full) as f:
            soup = bs4.BeautifulSoup(f, "html.parser")
        scan_tags(filename, entries, soup)

    po = polib.POFile()
    po.metadata = {
        "Project-Id-Version": "PACKAGE_VERSION",
        "MIME-Version": "1.0",
        "Content-Type": "text/plain; charset=UTF-8",
        "Content-Transfer-Encoding": "8bit",
        "X-Generator": "Cockpit html2po",
    }
    for entry in entries.values():
        po.append(entry)

    if args.output:
        po.save(args.output)
    else:
        sys.stdout.write(str(po))


if __name__ == "__main__":
    main()
