#!/bin/sh
set -eu -o noglob

CONNECTION_URI="qemu:///$1" # example: qemu:///system
VM_NAME="$2"
SOURCE="$3"
SOURCE_TYPE="$4"
OS="$5"
MEMORY_SIZE="$6" # in MiB
STORAGE_SIZE="$7" # in GiB
START_VM="$8"
STORAGE_POOL="$9"
STORAGE_VOLUME="${10}"

vmExists(){
   virsh -c "$CONNECTION_URI" list --all | awk  '{print $2}' | grep -q --line-regexp --fixed-strings "$1"
}

err_handler () {
    rm -f "$XMLS_FILE"
}

handleFailure(){
    exit $1
}

trap err_handler EXIT

# prepare virt-install parameters
if [ "$SOURCE_TYPE" = "disk_image" ]; then
    DISK_OPTIONS="$SOURCE,device=disk"
else
    COMPARISON=$(awk 'BEGIN{ print "'$STORAGE_SIZE'"<=0 }')
    if [ "$STORAGE_POOL" = "NoStorage" ] || [ "$COMPARISON" -eq 1 ]; then
        # default to no disk if size 0
        DISK_OPTIONS="none"
    elif [ "$STORAGE_POOL" != "NewVolume" ]; then
        DISK_OPTIONS="vol=$STORAGE_POOL/$STORAGE_VOLUME"
    else
        DISK_OPTIONS="size=$STORAGE_SIZE,format=qcow2"
    fi
fi

DOM_GRAPHICS_CAPABILITIES="$(virsh domcapabilities | awk "/<graphics supported='yes'/ {flag=1; next}; /<\/graphics/ {flag=0}; flag")"
GRAPHICS_PARAM=""
if echo "$DOM_GRAPHICS_CAPABILITIES" | grep -q vnc; then
    GRAPHICS_PARAM="--graphics vnc,listen=127.0.0.1"
fi
if echo "$DOM_GRAPHICS_CAPABILITIES" | grep -q spice; then
    GRAPHICS_PARAM="--graphics spice,listen=127.0.0.1 $GRAPHICS_PARAM"
fi
if [ -z "$GRAPHICS_PARAM" ]; then
    GRAPHICS_PARAM="--graphics none"
fi

if [ "$SOURCE_TYPE" = "pxe" ]; then
    INSTALL_METHOD="--pxe --network $SOURCE"
elif [ "$START_VM" = "true" ]; then
    if [ "$SOURCE_TYPE" = "disk_image" ]; then
        INSTALL_METHOD="--import"
    elif ( [ "${SOURCE#/}" != "$SOURCE" ] && [ -f "${SOURCE}" ] ) || ( [ "$SOURCE_TYPE" = "url" ] && [ "${SOURCE%.iso}" != "$SOURCE" ] ); then
        INSTALL_METHOD="--cdrom $SOURCE"
    else
        INSTALL_METHOD="--location $SOURCE"
    fi
else
    # prevents creating duplicate cdroms if start vm is false
    # or if no source received
    INSTALL_METHOD=""
fi


XMLS_FILE="`mktemp`"

if [ "$START_VM" = "true" ]; then
    STARTUP_PARAMS="--noautoconsole"
    HAS_INSTALL_PHASE="false"
    # Wait for the installer to complete in case we don't use existing image or we don't boot with PXE
    if [ "$SOURCE_TYPE" != "pxe" ] && [ "$SOURCE_TYPE" != "disk_image" ]; then
        STARTUP_PARAMS="$STARTUP_PARAMS --wait -1 --noreboot"
    fi
else
    # 2 = last phase only
    STARTUP_PARAMS="--print-xml"
    # Installation options that don't have install phase should unset the
    # HAS_INSTALL_PHASE to prevent the Install button from being shown in
    # the UI.
    if [ "$SOURCE_TYPE" = "disk_image" ]; then
        HAS_INSTALL_PHASE="false"
    else
        HAS_INSTALL_PHASE="true"
    fi
fi


if [ "$STORAGE_POOL" != "NewVolume" ]; then
    CHECK_PARAM="--check path_in_use=off"
else
    CHECK_PARAM=""
fi

virt-install \
    --connect "$CONNECTION_URI" \
    --name "$VM_NAME" \
    --os-variant "$OS" \
    --memory "$MEMORY_SIZE" \
    --quiet \
    --disk  "$DISK_OPTIONS" \
    $CHECK_PARAM \
    $STARTUP_PARAMS \
    $INSTALL_METHOD \
    $GRAPHICS_PARAM \
> "$XMLS_FILE" || handleFailure $?

# The VM got deleted while being installed
if ! $(vmExists "$VM_NAME") && [ "$START_VM" = "true" ]; then
    exit 0
fi

# add metadata to domain

if [ "$START_VM" = "true" ]; then
    vmExists "$VM_NAME" || handleFailure $?
    virsh -c "$CONNECTION_URI" -q dumpxml "$VM_NAME" > "$XMLS_FILE"
fi

# LAST STEP ONLY - virt-install can output 1 or 2 steps
DOMAIN_MATCHES=`grep -n '</domain>' "$XMLS_FILE"`
LAST_STEP=`echo "$DOMAIN_MATCHES" | wc -l`
CURRENT_STEP=1
START_LINE=1

# go through all domains (line numbers) and increment steps
echo "$DOMAIN_MATCHES"  |  sed 's/[^0-9]//g' | while read -r FINISH_LINE ; do
        QUIT_LINE="`expr $FINISH_LINE + 1`"
        # define only last step
        if [ "$CURRENT_STEP" = "$LAST_STEP" ]; then
            sed -n -i "$START_LINE"','"$FINISH_LINE"'p;'"$QUIT_LINE"'q' "$XMLS_FILE"
            METADATA_LINE=`grep -n '</metadata>' "$XMLS_FILE" | sed 's/[^0-9]//g'`

            METADATA='    <cockpit_machines:data xmlns:cockpit_machines="https://github.com/cockpit-project/cockpit/tree/master/pkg/machines"> \
      <cockpit_machines:has_install_phase>'"$HAS_INSTALL_PHASE"'</cockpit_machines:has_install_phase> \
      <cockpit_machines:install_source_type>'"$SOURCE_TYPE"'</cockpit_machines:install_source_type> \
      <cockpit_machines:install_source>'"$SOURCE"'</cockpit_machines:install_source> \
      <cockpit_machines:os_variant>'"$OS"'</cockpit_machines:os_variant> \
    </cockpit_machines:data>'

            if [ -z "$METADATA_LINE"  ]; then
                METADATA_LINE="`cat "$XMLS_FILE" | wc -l`"
                METADATA='\ \ <metadata> \
'"$METADATA"' \
  </metadata>'
            fi

            #inject metadata, and define
            sed "$METADATA_LINE""i $METADATA" "$XMLS_FILE" | virsh -c "$CONNECTION_URI" -q define /dev/stdin || handleFailure $?
        else
            START_LINE="$QUIT_LINE"
            CURRENT_STEP="`expr $CURRENT_STEP + 1`"
        fi
done
