#!/bin/sh -ex

personality="$1"

dependencies="\
    appstream-util \
    autoconf \
    automake \
    build-essential \
    clang \
    curl \
    debian-archive-keyring \
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
    libjavascript-minifier-xs-perl \
    libjson-glib-dev \
    libjson-perl \
    libkrb5-dev \
    libpam0g-dev \
    libpcp-import1-dev \
    libpcp-pmda3-dev \
    libpcp3-dev \
    libpolkit-agent-1-dev \
    libpolkit-gobject-1-dev \
    libssh-4-dbgsym \
    libssh-dev \
    libsystemd-dev \
    nodejs \
    npm \
    pkg-config \
    pyflakes3 \
    python3 \
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

echo "deb http://ddebs.ubuntu.com focal main universe" > /etc/apt/sources.list.d/ddebs.list
echo "deb http://ddebs.ubuntu.com focal-updates main universe" >> /etc/apt/sources.list.d/ddebs.list
apt-key adv --keyserver keyserver.ubuntu.com --recv-keys F2EDC64DC5AEE1F6B9C621F0C8CAB6595FDFF622
apt-get update

DEBIAN_FRONTEND=noninteractive eatmydata apt-get install -y --no-install-recommends ${dependencies}

# install chromium from Debian, it's not available as deb from Ubuntu any more (only snap)
printf 'deb http://ftp.debian.org/debian buster main\ndeb http://security.debian.org/debian-security buster/updates main\n' > /etc/apt/sources.list.d/buster.list
ln -s /usr/share/keyrings/debian-archive-buster-security-automatic.gpg /etc/apt/trusted.gpg.d/
ln -s /usr/share/keyrings/debian-archive-buster-automatic.gpg /etc/apt/trusted.gpg.d/
apt-get update
apt-get install -y --no-install-recommends chromium
apt-get clean

adduser --system --gecos "Builder" builder

# minimize image
rm -rf /var/cache/apt /var/lib/apt /var/log/*
