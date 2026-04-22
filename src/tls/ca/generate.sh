#!/bin/bash
# SPDX-License-Identifier: LGPL-2.1-or-later
# Generate CA and certificates for testing; these are static due to the expired cert (see below)
set -eux

# Their lifetimes need to be long enough for long-term support distributions, i.e. > 15 years
DAYS=10000

# OpenSSL 3.x defaults to PKCS#8 format, but we need traditional RSA format for GnuTLS compatibility
openssl genrsa -traditional -out ca.key 2048
openssl req -config ca.conf -x509 -key ca.key -out ca.pem -subj '/O=Cockpit/OU=test/CN=CA/' -days "$DAYS"

mkdir certs
touch index.txt
echo 01 > serial

for user in alice bob; do
    openssl genrsa -traditional -out ${user}.key 2048

    openssl req -new -key ${user}.key -out ${user}.csr -config ca.conf -subj "/CN=${user}/DC=COCKPIT/DC=LAN/"
    openssl req -in ${user}.csr -text
    openssl ca -batch -config ca.conf -in ${user}.csr -days "$DAYS" -notext -extensions usr_cert -out ${user}.pem -subj "/CN=${user}/DC=COCKPIT/DC=LAN/"
    # for browser or smart card import
    openssl pkcs12 -export -password pass:foo -in ${user}.pem -inkey ${user}.key -out ${user}.p12
done

# reset so that we can re-build cert with different lifetime
rm index.txt*
touch index.txt
# there is no way to generate an immediately expired cert with "openssl ca", so this has to age for a day to really be expired; or
# temporarily set back your clock one day
openssl ca -batch -config ca.conf -in alice.csr -days 1 -notext -extensions usr_cert -out alice-expired.pem -subj "/CN=alice/DC=COCKPIT/DC=LAN/"

rm -r certs
rm -- index.txt* serial* *.csr

# Update fingerprints in testing.h
update_fingerprint() { # args: MACRO_NAME CERT_FILE
    local macro="$1"
    local fp
    fp="$(openssl x509 -in "$2" -noout -fingerprint -sha256)"
    local fpc
    fpc="$(cut -d= -f2 <<< "$fp" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
    sed -i "s/^#define $macro.*/#define $macro \"$fpc\"/" ../testing.h
    echo "  $macro: $fp"
}

update_fingerprint CLIENT_CERT_FINGERPRINT alice.pem
update_fingerprint CLIENT_EXPIRED_FINGERPRINT alice-expired.pem
update_fingerprint ALTERNATE_FINGERPRINT bob.pem
