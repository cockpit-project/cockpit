service_in_files = \
	session/org.libvirt.service.in
servicedir = $(DBUS_SERVICES_DIR)
service_DATA = $(service_in_files:.service.in=.service)

system_service_in_files = \
	system/org.libvirt.service.in
system_servicedir = $(DBUS_SYSTEM_SERVICES_DIR)
system_service_DATA = $(system_service_in_files:.service.in=.service)

EXTRA_DIST = \
	$(service_in_files) \
	$(system_service_in_files)

CLEANFILES = \
	$(service_DATA) \
	$(system_service_DATA)

session/org.libvirt.service: session/org.libvirt.service.in
	$(AM_V_GEN)$(MKDIR_P) session && \
		sed -e 's|[@]bindir[@]|$(bindir)|g' < $< > $@-t && \
			mv $@-t $@

system/org.libvirt.service: system/org.libvirt.service.in
	$(AM_V_GEN)$(MKDIR_P) system && \
		sed -e 's|[@]bindir[@]|$(bindir)|g' < $< > $@-t && \
			mv $@-t $@
