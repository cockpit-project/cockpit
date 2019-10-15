#!/bin/sh -ex

personality="$1"

dependencies="\
    appstream-util \
    autoconf \
    automake \
    build-essential \
    chromium-browser \
    clang python3 \
    curl \
    dbus \
    gcc-multilib \
    gdb \
    git \
    glib-networking \
    glib-networking-dbgsym\
    gtk-doc-tools \
    gettext \
    libc6-dbg \
    libfontconfig1 \
    libglib2.0-0-dbgsym \
    libglib2.0-dev \
    libgnutls28-dev \
    libgudev-1.0-dev \
    libjavascript-minifier-xs-perl \
    libjson-glib-dev \
    libjson-perl \
    libkeyutils-dev \
    libkrb5-dev \
    liblvm2-dev \
    libnm-glib-dev \
    libpam0g-dev \
    libpcp-import1-dev \
    libpcp-pmda3-dev \
    libpcp3-dev \
    libpolkit-agent-1-dev \
    libpolkit-gobject-1-dev \
    libssh-4-dbgsym \
    libssh-dev \
    libsystemd-dev \
    pkg-config \
    pyflakes3 \
    python3-pep8 \
    ssh \
    strace \
    valgrind \
    xmlto \
    xsltproc \
"

tee /entrypoint <<EOF
#!/bin/sh -e

echo -n "Host: " && uname -srvm

. /usr/lib/os-release
echo -n "Container: \${NAME} \${VERSION} / " && ${personality} uname -nrvm
echo

set -ex
exec ${personality} -- "\$@"
EOF
chmod +x /entrypoint

apt-get update
apt-get install -y --no-install-recommends gnupg2 eatmydata

echo "deb http://ddebs.ubuntu.com disco main universe" > /etc/apt/sources.list.d/ddebs.list
echo "deb http://ddebs.ubuntu.com disco-updates main universe" >> /etc/apt/sources.list.d/ddebs.list
apt-key adv --keyserver keyserver.ubuntu.com --recv-keys F2EDC64DC5AEE1F6B9C621F0C8CAB6595FDFF622
apt-get update

eatmydata apt-get install -y --no-install-recommends ${dependencies}

# install the npm package for just long enough to install npm from upstream
eatmydata apt-get install -y npm
npm install -g n
n -a x64 lts    # no more 32bit builds, but libc6:amd64 is always installed
rm /usr/local/bin/node
ln -s "`n bin lts`" /usr/local/bin/node.lts
NODE_PATH="$(n bin lts)"
eatmydata apt-get remove -y npm nodejs

apt-get clean



adduser --system --gecos "Builder" builder
