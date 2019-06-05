WS_DIR = $(srcdir)/containers/ws

CLEANFILES += $(WS_DIR)/rpms

ws-container:
	rm -rf $(WS_DIR)/rpms && mkdir -p $(WS_DIR)/rpms
	cd $(WS_DIR)/rpms && $(abs_srcdir)/tools/make-rpms
	sudo docker build -t cockpit/ws $(WS_DIR)

ws-container-shell:
	sudo docker run -ti --rm --publish=9001:9090 \
		cockpit/ws /bin/bash

UNIT_TESTS_DIR = $(srcdir)/containers/unit-tests

unit-tests-container:
	sudo docker build -t cockpit/unit-tests $(UNIT_TESTS_DIR)
	sudo docker tag  cockpit/unit-tests:latest docker.io/cockpit/unit-tests:latest
	sudo docker build --build-arg arch=i386 -t cockpit/unit-tests:i386 $(UNIT_TESTS_DIR)
	sudo docker tag  cockpit/unit-tests:i386 docker.io/cockpit/unit-tests:i386

unit-tests-container-run:
	sudo docker run --shm-size=512M -ti --rm -v $(abs_srcdir):/source:ro cockpit/unit-tests

unit-tests-container-shell:
	sudo docker run --shm-size=512M -ti --rm -v $(abs_srcdir):/source:ro cockpit/unit-tests /bin/bash
