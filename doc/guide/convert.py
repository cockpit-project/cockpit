#!/usr/bin/python

import os
import subprocess

files = os.listdir()

file_names = [ os.path.splitext(item)[0] for item in files if item.endswith('.xml') ]

for name in file_names:
    print(f"Processing {name}")
    # pandoc --from docbook --to asciidoc -o cockpit-cache.adoc cockpit-cache.xml
    subprocess.run(
        [
            "pandoc",
            "--from", "docbook",
            "--to", "asciidoc",
            "-o", f"./asciidoc/{name}.adoc",
            f"{name}.xml",
        ]
    )
