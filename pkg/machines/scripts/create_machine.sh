#!/bin/sh
set -eu -o noglob

CONNECTION_URI="qemu:///$1" # ex: qemu:///system
VM_NAME="$2"
SOURCE="$3"
OS="$4"
MEMORY_SIZE="$5" # in MiB
STORAGE_SIZE="$6" # in GiB
START_VM="$7"

vmExists(){
   virsh -c "$CONNECTION_URI" list --all | awk  '{print $2}' | grep -q --line-regexp --fixed-strings "$1"
}

handleFailure(){
    rm -f "$XMLS_FILE"
    exit $1
}

# prepare virt-install parameters
COMPARISON=$(awk 'BEGIN{ print "'$STORAGE_SIZE'"<=0 }')
if [ "$COMPARISON" -eq 1 ]; then
    # default to no disk if size 0
    DISK_OPTIONS="none"
else
    DISK_OPTIONS="size=$STORAGE_SIZE,format=qcow2"
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

if [ "$OS" = "other-os" -o  -z "$OS" ]; then
    OS="auto"
fi

FIRST_1_SOURCE="`echo "$SOURCE" | cut -c 1`"
FIRST_3_SOURCE="`echo "$SOURCE" | cut -c -3`"
FIRST_4_SOURCE="`echo "$SOURCE" | cut -c -4`"

if [ "$START_VM" = "true" -a "$FIRST_1_SOURCE" = "/" -a ! -f "$SOURCE" ]; then
    echo "$SOURCE does not exist or is not a file" 1>&2
    exit 1
fi

if [ "$START_VM" = "true" -a \( "$FIRST_1_SOURCE" = "/" -o "$FIRST_4_SOURCE" = "http" -o "$FIRST_3_SOURCE" = "ftp" -o "$FIRST_3_SOURCE" = "nfs" \) ]; then
    LOCATION_PARAM="--cdrom $SOURCE"
else
    # prevents creating duplicate cdroms if start vm is false
    # or if no source received
    LOCATION_PARAM=""
fi


XMLS_FILE="`mktemp`"

if [ "$START_VM" = "true" ]; then
    STARTUP_PARAMS="--wait -1 --noautoconsole --noreboot"
    HAS_INSTALL_PHASE="false"
else
    # 2 = last phase only
    STARTUP_PARAMS="--print-xml"
    HAS_INSTALL_PHASE="true"
fi

virt-install \
    --connect "$CONNECTION_URI" \
    --name "$VM_NAME" \
    --os-variant "$OS" \
    --memory "$MEMORY_SIZE" \
    --quiet \
    --disk  "$DISK_OPTIONS" \
    $STARTUP_PARAMS \
    $LOCATION_PARAM \
    $GRAPHICS_PARAM \
> "$XMLS_FILE" || handleFailure $?

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

rm -f "$XMLS_FILE"
