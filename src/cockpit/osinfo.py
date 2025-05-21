# supported OSes for beibooting; entries are os-release keys
# keep this in sync with bots/lib/testmap.py
supported_oses: 'list[dict[str, str | None]]' = [
    # rolling release
    {"ID": "arch", "VERSION_ID": None},

    # match/describe CentOS separately, it's the upstream of all RHEL clones
    {"ID": "centos", "PLATFORM_ID": "platform:el9"},
    {"ID": "centos", "PLATFORM_ID": "platform:el10"},
    {"PLATFORM_ID": "platform:el8"},
    {"PLATFORM_ID": "platform:el9"},
    {"PLATFORM_ID": "platform:el10"},

    {"ID": "debian", "VERSION_ID": "12"},
    {"ID": "debian", "VERSION_ID": "13"},
    # rolling release
    {"ID": "debian", "VERSION_ID": None},

    {"ID": "fedora", "VERSION_ID": "40"},
    {"ID": "fedora", "VERSION_ID": "41"},
    {"ID": "fedora", "VERSION_ID": "42"},

    {"ID": "ubuntu", "VERSION_ID": "22.04"},
    {"ID": "ubuntu", "VERSION_ID": "24.04"},
    {"ID": "ubuntu", "VERSION_ID": "25.04"},
]
