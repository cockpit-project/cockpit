#!/bin/sh

# Creates a temp dir with all the container files
# and calls docker build on it. All arguments to
# this script are passed to docker.

# To install from prebuilt rpms pass in a --rpmdir argument
# all rpm files from that location will be used in the build
# Otherwise fresh rpms will be built with /tools/make-rpms

# A -t file can be to specify the docker tag, otherwise the default
# tag is cockpit/kubernetes

set -ex

tag="cockpit/kubernetes"
rpmdir=

if [ $# -gt 0 ]; then
    args=$(getopt -o "r:t:" -l "rpmdir:" -- "$@")
    eval set -- "$args"
fi

while [ $# -gt 0 ]; do
	case $1 in
	    -r|--rpmdir)
            rpmdir=$2
		    ;;
	    -t)
            tag=$2
		    ;;
        --)
	        shift
	        break
	        ;;
	esac
	shift
done

BASE=$(cd $(dirname "$0") && pwd)
IMAGES_SHARED=$(cd "$BASE/../shared" && pwd)

TDIR=`mktemp -d`

# Build the go binary
GOPATH="$IMAGES_SHARED/cockpit-kube" GOOS=linux GOARCH=amd64 go build cockpit-kube-auth
GOPATH="$IMAGES_SHARED/cockpit-kube" GOOS=linux GOARCH=amd64 go build cockpit-kube-launch

mv cockpit-kube-auth "$TDIR"
mv cockpit-kube-launch "$TDIR"

cp -r "$BASE/container-files/"* "$TDIR"
cp "$BASE/container-files/.Dockerfile" "$TDIR/Dockerfile"
cp -r "$IMAGES_SHARED/scripts" "$TDIR"

if [ -n "$rpmdir" ]; then
    echo "$rpmdir"
    mkdir "$TDIR/rpms"
    cp -r "$rpmdir" "$TDIR/rpms"
fi

cd "$TDIR"

docker build -t "$tag" .
rm -rf "$TDIR"
