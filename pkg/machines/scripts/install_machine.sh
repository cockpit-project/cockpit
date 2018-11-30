#!/bin/sh

set -u -o noglob

CONNECTION_URI="qemu:///$1" # example: qemu:///system
VM_NAME="$2"
SOURCE="$3"
OS="$4"
MEMORY_SIZE="$5" # in Mib
VCPUS="$6"
DISKS="$7"
DISPLAYS="$8"

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

if [ -z "$OS" ]; then
    OS="auto"
fi

if [ -z "$DISKS" ]; then
    DISKS_PARAM="--disk none"
else
    createOptions "$DISKS" "--disk"
    DISKS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ -z "$DISPLAYS" ]; then
    GRAPHICS_PARAM="--graphics none"
else
    createOptions "$DISPLAYS" "--graphics"
    GRAPHICS_PARAM="$CREATE_OPTIONS_RESULT"
fi

if [ "${SOURCE#/}" != "$SOURCE" ] && [ -f "${SOURCE}" ]; then
    LOCATION_PARAM="--cdrom $SOURCE"
else
    LOCATION_PARAM="--location $SOURCE"
fi

# backup
DOMAIN_FILE="`mktemp`"

virsh -c "$CONNECTION_URI" -q destroy "$VM_NAME" 2>/dev/null
virsh -c "$CONNECTION_URI" -q dumpxml "$VM_NAME" > "$DOMAIN_FILE"
virsh -c "$CONNECTION_URI" -q undefine "$VM_NAME" --managed-save

virt-install \
    --connect "$CONNECTION_URI" \
    --name "$VM_NAME" \
    --os-variant "$OS" \
    --memory "$MEMORY_SIZE" \
    --vcpus "$VCPUS" \
    --quiet \
    --wait -1 \
    --noautoconsole \
    --noreboot \
    $DISKS_PARAM \
    $LOCATION_PARAM \
    $GRAPHICS_PARAM
EXIT_STATUS=$?

if [ "$EXIT_STATUS" -eq 0 ] && vmExists "$VM_NAME"; then
    # set metadata
    virsh -c "$CONNECTION_URI"  -q dumpxml "$VM_NAME" > "$DOMAIN_FILE"
    METADATA_LINE=`grep -n '</metadata>' "$DOMAIN_FILE" | sed 's/[^0-9]//g'`
    METADATA='    <cockpit_machines:data xmlns:cockpit_machines="https://github.com/cockpit-project/cockpit/tree/master/pkg/machines"> \
      <cockpit_machines:has_install_phase>false</cockpit_machines:has_install_phase> \
      <cockpit_machines:install_source>'"$SOURCE"'</cockpit_machines:install_source> \
      <cockpit_machines:os_variant>'"$OS"'</cockpit_machines:os_variant> \
    </cockpit_machines:data>'

    if [ -z "$METADATA_LINE"  ]; then
        METADATA_LINE="`cat "$DOMAIN_FILE" | wc -l`"
        METADATA='\ \ <metadata> \
'"$METADATA"' \
  </metadata>'
    fi

    #inject metadata, and define
    sed "$METADATA_LINE""i $METADATA" "$DOMAIN_FILE" | virsh -c "$CONNECTION_URI" -q define /dev/stdin
    rm -f "$DOMAIN_FILE"
else
    # return back if failed
    if vmExists "$VM_NAME"; then
        # undefine if the domain was created but still failed
        virsh -c "$CONNECTION_URI" -q undefine "$VM_NAME" --managed-save
    fi
    virsh -c "$CONNECTION_URI" -q define "$DOMAIN_FILE"
    rm -f "$DOMAIN_FILE"
    exit 1
fi
