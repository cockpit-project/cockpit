# Cockpit Docs

We have two distinct workflows for our docs, one relates to bundling documentation within Cockpit packages, the other regards online documentation for Cockpit with features for ease-of-use.

Explanation of existing directories and what their purpose is. Mostly follows an Antora designated directory design that is explained in [Antora folder structure](#antora-folder-structure).

```
doc/                  # All of Cockpit's doc is here; Plugins should be excluded.
├── modules           # Antora expects a module structure, irrelevant for AsciiDoctor.
│   ├── guide         # Cockpit Guide docs, encompasses everything that relates to Cockpit
│   │   ├── bundling  # Specific to AsciiDoctor bundling where we put single-page wrappers
│   │   ├── pages     # All pages that relate to Cockpit itself
│   │   └── nav.adoc  # Antora navigation file, displays pages from the file as a sidebar navigation for the specific component
│   └── man           # Cockpit man pages. Packaged as Manpages with AsciiDoctor, HTML with Antora.
│       ├── pages     # All manpages for packages distributed in cockpit
│       ├── partials  # Antora-designated folder, partials are imported by AsciiDoc manpages for Bugs, and Author
│       └── nav.adoc  # Antora navigation file, displays pages from the file as a sidebar navigation for the specific component
└── antora.yml        # Config for Antora to pickup that designates navigation files and attributes
```

## Antora folder structure

Since Antora is a versatile documentation tool, they have structured directories for managing the modules and module-specific features - like pages and attachments. 

> Antora assigns preset, content-specific behavior to the source files stored in the family directories.

https://docs.antora.org/antora/latest/family-directories/
