#!/bin/sh

# Installs rpms
# if --nodeps is passed rpm is installed with rpm with dependencies
# Otherwise a normal dnf install is run
#
# Checks for prebuilt rpms in /container/rpms
# If not present there, they are fetched from koji.

set -ex

nodeps=
arch=`uname -p`
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

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

OSVER=$(. /etc/os-release && echo "$VERSION_ID")

for package in $@
do
    rpm=$(ls /container/rpms/$package-[0-9]*$OSVER.*$arch.rpm || true)
    if [ -z "$rpm" ]; then
        if [ -n "$VERSION" ]; then
            package="$package-$VERSION"
        fi

        if [ -z "$nodeps" ]; then
            rpm="$package"
        else
            if [ "$INSTALLER" = "yum" ]; then
                yum install yum-utils
                yumdownloader --verbose --destdir=/container/rpms "$package"
            else
                dnf install -y 'dnf-command(download)'
                dnf download --destdir=/container/rpms "$package"
            fi
            rpm=$(ls /container/rpms/$package-*$OSVER.*$arch.rpm || true)
            if [ -z "$rpm" ]; then
                echo "Error finding the downloaded package in /container/rpms"
                exit 1
            fi
        fi
    fi

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
