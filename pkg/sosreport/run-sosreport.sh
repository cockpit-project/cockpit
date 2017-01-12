#! /bin/bash

present () {
    which "$1" >/dev/null 2>/dev/null
}

if present sosreport; then
    exec sosreport "$@"
elif present atomic; then

    # HACK - sosreport inside the container does not behave as
    #        advertised, so we fix it via --sysroot and --tmp-dir.
    #
    # https://bugzilla.redhat.com/show_bug.cgi?id=1299794
    # https://bugzilla.redhat.com/show_bug.cgi?id=1277223

    exec atomic run rhel7/rhel-tools -- sosreport --sysroot /host --tmp-dir /host/var/tmp "$@"
else
    echo >&2 "The sosreport utility is not installed.  This should not happen.  Please complain to your distribution vendor."
    exit 1
fi
