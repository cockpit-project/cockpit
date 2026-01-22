WS_DIR = $(srcdir)/containers/ws

CLEANFILES += $(WS_DIR)/rpms $(WS_DIR)/libexec

ws-container:
	rm -rf $(WS_DIR)/rpms
	if [ -e cockpit-bridge-*.rpm ]; then mkdir -p $(WS_DIR)/rpms; cp *.rpm $(WS_DIR)/rpms; fi
	podman build -t quay.io/cockpit/ws $(WS_DIR)

# Developer target for quick iteration. Your have to build your local tree on
# the same OS than the container image, and with the correct --prefix=/usr
.PHONY: ws-container-build-tree
ws-container-build-tree: cockpit-tls cockpit-ws cockpit-wsinstance-factory cockpit-certificate-ensure dist/static/manifest.json
	mkdir -p $(WS_DIR)/overlay/usr/libexec $(WS_DIR)/overlay/usr/share/cockpit
	cp cockpit-tls cockpit-ws cockpit-wsinstance-factory cockpit-certificate-ensure $(WS_DIR)/overlay/usr/libexec/
	cp -r dist/* $(WS_DIR)/overlay/usr/share/cockpit/
	podman build -t quay.io/cockpit/ws $(WS_DIR)


ws-container-shell:
	podman run -ti --rm --publish=9001:9090 quay.io/cockpit/ws /bin/bash
