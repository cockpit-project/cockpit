service_in_files = \
	session/org.libvirt.service.in
servicedir = $(DBUS_SERVICES_DIR)
service_DATA = $(service_in_files:.service.in=.service)

EXTRA_DIST = \
	$(service_in_files)

CLEANFILES = \
	$(service_DATA)

session/org.libvirt.service: session/org.libvirt.service.in
	$(AM_V_GEN)$(MKDIR_P) session && \
		sed -e 's|[@]bindir[@]|$(bindir)|g' < $< > $@-t && \
			mv $@-t $@
