#!/bin/sh
# This script is meant to be run on an ephemeral CI host, for packit/Fedora/RHEL gating.
set -eux

systemctl status tuned.service || true

systemctl stop tuned.service
tuned-adm recommend
subscription-manager syspurpose --show || true

systemctl start tuned.service
tuned-adm recommend
subscription-manager syspurpose --show || true

grep -r atomic /etc/ /var/

tuned-adm auto_profile
