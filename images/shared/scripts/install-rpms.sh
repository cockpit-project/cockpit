#!/bin/sh

# Installs rpms
# if --nodeps is passed rpm is installed with rpm with dependencies
# Otherwise a normal dnf install is run
#
# Checks for prebuilt rpms in /container/rpms
# If not present there, they are fetched from koji.

set -ex

nodeps=
arch="x86_64"
args=$(getopt -o "da:" -l "nodeps" -- "$@")
eval set -- "$args"
while [ $# -gt 0 ]; do
	case $1 in
	    -d|--nodeps)
            nodeps=t
		    ;;
	    -a)
            arch=$2
		    ;;
        --)
	        shift
	        break
	        ;;
	esac
	shift
done

for package in $@
do
    rpm=$(/usr/bin/find /container/rpms -name "$package*.rpm" || true)
    if [ -z "$rpm" ]; then
        rpm="https://kojipkgs.fedoraproject.org/packages/cockpit/$VERSION/$RELEASE.fc23/$arch/$package$VERSION-$RELEASE.fc23.$arch.rpm"
    fi

    echo "$rpm"
    if [ -z "$nodeps" ]; then
        dnf install -y "$rpm"
    else
        rpm --nodeps -i "$rpm"
    fi
done
