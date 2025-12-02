#!/usr/bin/python

import os
import subprocess

man_files = os.listdir('./man')
man_file_names = [os.path.splitext(item)[0] for item in man_files if item.endswith('.xml')]
os.makedirs("./man/pages")


for name in man_file_names:
    print(f"Processing {name}")
    # pandoc --from docbook --to asciidoc -o cockpit-cache.adoc cockpit-cache.xml
    subprocess.run(
        [
            "pandoc",
            "--from", "docbook",
            "--to", "asciidoc",
            "--output", f"./man/pages/{name}.adoc",
            f"./man/{name}.xml",
        ]
    )

guide_files = os.listdir('./guide')
guide_file_names = [os.path.splitext(item)[0] for item in guide_files if item.endswith('.xml')]
os.makedirs("./guide/pages")

for name in guide_file_names:
    print(f"Processing {name}")
    # pandoc --from docbook --to asciidoc -o cockpit-cache.adoc cockpit-cache.xml
    subprocess.run(
        [
            "pandoc",
            "--from", "docbook",
            "--to", "asciidoc",
            "--output", f"./guide/pages/{name}.adoc",
            f"./guide/{name}.xml",
        ]
    )
