#!/bin/sh

set -eu -o noglob

CONNECTION_URI="qemu:///$1" # example: qemu:///system
VM_NAME="$2"
SOURCE_TYPE="$3"
SOURCE="$4"
OS="$5"
MEMORY="$6"
VCPUS="$7"
DISKS="$8"
DISPLAYS="$9"
VNICS="${10}"
BOOT="${11}"
AUTOSTART="${12}"

# prepare virt-install parameters

vmExists(){
   virsh -c "$CONNECTION_URI" list --all | awk  '{print $2}' | grep -q --line-regexp --fixed-strings "$1"
}

createOptions(){
    CREATE_OPTIONS_RESULT=""
	while IFS= read -r PARAM
    do
       if [ -n "$PARAM" ]; then
           CREATE_OPTIONS_RESULT="${CREATE_OPTIONS_RESULT} $2 $PARAM"
       fi
    done << EOF
    $1
EOF
}

if [ -z "$DISKS" ]; then
    DISKS_PARAM="--disk none"
else
    createOptions "'$DISKS'" "--disk"
    DISKS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ -z "$VNICS" ]; then
    VNICS_PARAM="--network none"
else
    createOptions "$VNICS" "--network"
    VNICS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ -z "$DISPLAYS" ]; then
    GRAPHICS_PARAM="--graphics none"
else
    createOptions "$DISPLAYS" "--graphics"
    GRAPHICS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ "$SOURCE_TYPE" = "pxe" ]; then
    INSTALL_METHOD="--pxe"
elif [ "$SOURCE_TYPE" = "os" ]; then
    INSTALL_METHOD="--install os=$OS"
elif ( [ "${SOURCE#/}" != "$SOURCE" ] && [ -f "${SOURCE}" ] ) || ( [ "$SOURCE_TYPE" = "url" ] && [ "${SOURCE%.iso}" != "$SOURCE" ] ); then
    INSTALL_METHOD="--cdrom '$SOURCE'"
else
    INSTALL_METHOD="--location '$SOURCE'"
fi

if [ "$AUTOSTART" = "true" ]; then
    AUTOSTART_PARAM="--autostart"
else
    AUTOSTART_PARAM=""
fi

createOptions "$MEMORY" "--memory"
MEMORY_PARAM="$CREATE_OPTIONS_RESULT"

if [ -z "$VCPUS" ]; then
    VCPUS_PARAM=""
else
    createOptions "$VCPUS" "--vcpus"
    VCPUS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ -z "$BOOT" ]; then
    BOOT_PARAM=""
else
    BOOT_PARAM="--boot $BOOT"
fi

# backup
DOMAIN_FILE="`mktemp`"

virsh -c "$CONNECTION_URI" -q destroy "$VM_NAME" 2>/dev/null || true
virsh -c "$CONNECTION_URI" -q dumpxml "$VM_NAME" > "$DOMAIN_FILE"
virsh -c "$CONNECTION_URI" -q undefine "$VM_NAME" --managed-save

handleFailure() {
    # If virt-install returned non-zero return code but the VM exists, redefine
    # the VM show that we get back the metadata which enable the 'Install'
    # button, so that the user can re-attempt installation
    set +e
    if vmExists "$VM_NAME"; then
        virsh -c "$CONNECTION_URI" -q define "$DOMAIN_FILE"
    fi
    rm -f "$DOMAIN_FILE"
    exit $1
}

eval virt-install \
    --connect "$CONNECTION_URI" \
    --name "$VM_NAME" \
    --os-variant "$OS" \
    --quiet \
    --wait -1 \
    --noautoconsole \
    --check path_in_use=off \
    "$MEMORY_PARAM" \
    "$DISKS_PARAM" \
    "$INSTALL_METHOD" \
    "$GRAPHICS_PARAM" \
    "$VNICS_PARAM" \
    "$VCPUS_PARAM" \
    "$BOOT_PARAM" \
    "$AUTOSTART_PARAM" || handleFailure $?

vmExists "$VM_NAME"
# set metadata
virsh -c "$CONNECTION_URI"  -q dumpxml --inactive "$VM_NAME" > "$DOMAIN_FILE"
METADATA_LINE=`grep -n '</metadata>' "$DOMAIN_FILE" | sed 's/[^0-9]//g'`
METADATA='    <cockpit_machines:data xmlns:cockpit_machines="https://github.com/cockpit-project/cockpit/tree/master/pkg/machines"> \
  <cockpit_machines:has_install_phase>false</cockpit_machines:has_install_phase> \
  <cockpit_machines:install_source_type>'"$SOURCE_TYPE"'</cockpit_machines:install_source_type> \
  <cockpit_machines:install_source>'"$SOURCE"'</cockpit_machines:install_source> \
  <cockpit_machines:os_variant>'"$OS"'</cockpit_machines:os_variant> \
</cockpit_machines:data>'

if [ -z "$METADATA_LINE"  ]; then
    METADATA_LINE="`cat "$DOMAIN_FILE" | wc -l`"
    METADATA='\ \ <metadata> \
'"$METADATA"' \
/metadata>'
fi

#inject metadata, and define
sed "$METADATA_LINE""i $METADATA" "$DOMAIN_FILE" | virsh -c "$CONNECTION_URI" -q define /dev/stdin
rm -f "$DOMAIN_FILE"
