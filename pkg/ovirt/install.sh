#!/bin/bash
# Installation script of the cockpit-machines-ovirt.
# Required to be called after RPM installation and before Cockpit Machines cockpit-machines-ovirt is accessed.
#
# Main task: update configuration files for Engine URL
# Reason: Engine URL can't be determined from VDSM host automatically, so it must be provided by the user.
#
# What it does:
#      update cockpit-machines-ovirt runtime configuration (to assemble oVirt REST API URL)
#
# How to run:
#      either manually after rpm installations as root:
#         # cd [COCKPIT_OVIRT_INSTALL_DIR] && ./install.sh [ENGINE_HOST_FQDN] [[ENGINE_HOST_PORT]]
#         # "COCKPIT_OVIRT_INSTALL_DIR" usually refers to /usr/share/cockpit/ovirt
#
#      or
#         login into cockpit as the 'root' user
#         access the 'ovirt' plugin
#         installation dialog shows up to handle the install.sh script execution from UI
#

ENGINE_FQDN=$1
ENGINE_PORT=$2

ETC_COCKPIT_DIR='/etc/cockpit'

VIRSH_CONNECTION_URI=$3 # optional
VIRSH_CONNECTION_NAME='remote' # used if VIRSH_CONNECTION_URI is set

EXIT_PARAMS=1 # wrong command parameters
EXIT_NO_ACCESS_MACHINES_OVIRT_CONFIG=3 # can't write to /etc/cockpit/machines-ovirt.config, try as root

function usage() {
  echo Usage: $0 '[ENGINE_FQDN] [ENGINE_PORT] [[VIRSH_CONNECTION_URI]]'
  echo Example: $0 engine.mydomain.com 443
  echo Example: $0 engine.mydomain.com 443
  echo Example: $0 engine.mydomain.com 443 qemu:///system
}

function checkParams() {
  if [ x${ENGINE_FQDN} = x ] ; then
    usage
    exit ${EXIT_PARAMS}
  else
    echo Registering for ENGINE_FQDN: ${ENGINE_FQDN}
  fi

  if [ x${ENGINE_PORT} = x ] ; then
    usage
    exit ${EXIT_PARAMS}
  else
    echo Registering for ENGINE_PORT: ${ENGINE_PORT}
  fi

}

function generateProviderConfig() {
  CONFIG_FILE=${ETC_COCKPIT_DIR}/machines-ovirt.config

  # TODO: decrease polling interval if AuditLog-based updates proof to be working
  echo "{ \
      \"debug\": false, \
      \"ovirt_polling_interval\": 5000, \
      \"cockpitPort\": 9090, \
      \"OVIRT_FQDN\": \"${ENGINE_FQDN}\", \
      \"OVIRT_PORT\": ${ENGINE_PORT}," \
        > ${CONFIG_FILE} || exit ${EXIT_NO_ACCESS_MACHINES_OVIRT_CONFIG}

  if [ x${VIRSH_CONNECTION_URI} = x ] ; then
    echo " \
        \"Virsh\": { \
            \"connections\": { \
                \"system\": { \
                    \"params\": [\"-c\", \"qemu:///system\"] \
                }, \
                \"session\": { \
                    \"params\": [\"-c\", \"qemu:///session\"] \
                } \
            } \
        }" >> ${CONFIG_FILE}
  else
    echo " \
        \"Virsh\": { \
            \"connections\": { \
                \"${VIRSH_CONNECTION_NAME}\": { \
                    \"params\": [\"-c\", \"${VIRSH_CONNECTION_URI}\"] \
                } \
            } \
        }" >> ${CONFIG_FILE}
  fi

  echo "}" >> ${CONFIG_FILE}

  echo OK: ${CONFIG_FILE} generated
}

checkParams
generateProviderConfig
