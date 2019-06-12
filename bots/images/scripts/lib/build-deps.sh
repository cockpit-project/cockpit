#!/bin/bash

set -eu

# The sed command strips the BuildRequires label and version specifiers. It also
# adds quotes to packages with brackets in their name.
curl -s https://raw.githubusercontent.com/cockpit-project/cockpit/master/tools/cockpit.spec |
    sed -n '/^BuildRequires:/ {
        s/^[^ ]*: //;
        s/[ ]*>=.*$//;
        s/%{.*}//;
        s/\([^ ]*(.*)[^ ]*\)/"\1"/;
        p}' |
    tr '\n' ' '
