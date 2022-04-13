WS_DIR = $(srcdir)/containers/ws

CLEANFILES += $(WS_DIR)/rpms

ws-container:
	rm -rf $(WS_DIR)/rpms
	if [ -e cockpit-bridge-*.rpm ]; then mkdir -p $(WS_DIR)/rpms; cp *.rpm $(WS_DIR)/rpms; fi
	podman build -t quay.io/cockpit/ws $(WS_DIR)

ws-container-shell:
	podman run -ti --rm --publish=9001:9090 quay.io/cockpit/ws /bin/bash
