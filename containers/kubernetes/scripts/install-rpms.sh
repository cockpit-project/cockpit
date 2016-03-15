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

if [ -z "$COCKPIT_RPM_URL" ]; then
    COCKPIT_RPM_URL="https://kojipkgs.fedoraproject.org/packages/cockpit"
fi

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

if [ -z "$OS" ]; then
    OS=$(rpm -q --qf "%{release}" basesystem | sed -n -e 's/^[0-9]*\.\(\S\+\).*/\1/p')
fi

for package in $@
do
    rpm=$(ls /container/rpms/$package*.rpm || true)
    if [ -z "$rpm" ] && [ -z "$OFFLINE" ]; then
        rpm="$COCKPIT_RPM_URL/$VERSION/$RELEASE.$OS/$arch/$package$VERSION-$RELEASE.$OS.$arch.rpm"
    fi

    echo "$rpm"
    if [ -z "$nodeps" ]; then
        if [ -z "$OFFLINE" ]; then
            $INSTALLER install -v -y "$rpm"
        # Deps must be already installed
        else
            rpm -i "$rpm"
        fi

    else
        rpm --nodeps -i "$rpm"
    fi
done

$INSTALLER clean all
