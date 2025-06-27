#!/usr/bin/python

import os
import subprocess

man_files = os.listdir('../man/')
man_file_names = [ os.path.splitext(item)[0] for item in man_files if item.endswith('.xml') ]

for name in man_file_names:
    print(f"Processing {name}")
    # pandoc --from docbook --to asciidoc -o cockpit-cache.adoc cockpit-cache.xml
    subprocess.run(
        [
            "pandoc",
            "--from", "docbook",
            "--to", "asciidoc",
            "-o", f"./asciidoc/man/{name}.adoc",
            f"../man/{name}.xml",
        ]
    )

guide_files = os.listdir()
guide_file_names = [ os.path.splitext(item)[0] for item in guide_files if item.endswith('.xml') ]

for name in guide_file_names:
    print(f"Processing {name}")
    if name == "cockpit-guide":
        print(f"Skipping {name}")
        continue
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
