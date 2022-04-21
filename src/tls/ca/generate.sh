#!/bin/sh
# Generate CA and certificates for testing
set -eux
openssl req -config ca.conf -x509  -newkey rsa:2048 -out ca.pem -subj '/O=Cockpit/OU=test/CN=CA/' -nodes -days 3650
mkdir certs
touch index.txt
echo 01 > serial

for user in alice bob; do
    openssl genrsa -out ${user}.key 2048

    openssl req -new -key ${user}.key -out ${user}.csr -config ca.conf -subj "/CN=${user}/DC=COCKPIT/DC=LAN/"
    openssl req -in ${user}.csr -text
    openssl ca -batch -config ca.conf -in ${user}.csr -days 3650 -notext -extensions usr_cert -out ${user}.pem -subj "/CN=${user}/DC=COCKPIT/DC=LAN/"
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
rm index.txt* serial* *.csr
