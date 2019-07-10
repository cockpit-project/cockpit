WS_DIR = $(srcdir)/containers/ws

CLEANFILES += $(WS_DIR)/rpms

ws-container:
	rm -rf $(WS_DIR)/rpms && mkdir -p $(WS_DIR)/rpms
	cd $(WS_DIR)/rpms && $(abs_srcdir)/tools/make-rpms
	sudo docker build -t cockpit/ws $(WS_DIR)

ws-container-shell:
	sudo docker run -ti --rm --publish=9001:9090 \
		cockpit/ws /bin/bash
