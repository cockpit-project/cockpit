service_in_files = \
	session/org.libvirt.service.in \
	$(NULL)
servicedir = $(DBUS_SERVICES_DIR)
service_DATA = \
	$(service_in_files:.service.in=.service) \
	$(NULL)

system_service_in_files = \
	system/org.libvirt.service.in \
	$(NULL)
system_servicedir = $(DBUS_SYSTEM_SERVICES_DIR)
system_service_DATA = \
	$(system_service_in_files:.service.in=.service) \
	$(NULL)

system_policy_in_files = \
	system/org.libvirt.conf.in \
	$(NULL)
system_policydir = $(DBUS_SYSTEM_POLICIES_DIR)
system_policy_DATA = \
	$(system_policy_in_files:.conf.in=.conf) \
	$(NULL)

polkit_in_files = \
	system/libvirt-dbus.rules.in \
	$(NULL)
polkitdir = $(POLKIT_RULES_DIR)
polkit_DATA = \
	$(polkit_in_files:.rules.in=.rules) \
	$(NULL)

interfaces_files = \
	org.libvirt.Connect.xml \
	org.libvirt.Domain.xml \
	org.libvirt.Network.xml \
	org.libvirt.NodeDevice.xml \
	org.libvirt.NWFilter.xml \
	org.libvirt.Secret.xml \
	org.libvirt.StoragePool.xml \
	org.libvirt.StorageVol.xml \
	$(NULL)
interfacesdir = $(DBUS_INTERFACES_DIR)
interfaces_DATA = \
	$(interfaces_files) \
	$(NULL)

EXTRA_DIST = \
	$(service_in_files) \
	$(system_service_in_files) \
	$(system_policy_in_files) \
	$(polkit_in_files) \
	$(interfaces_files) \
	$(NULL)

CLEANFILES = \
	$(service_DATA) \
	$(system_service_DATA) \
	$(system_policy_DATA) \
	$(polkit_DATA) \
	$(NULL)

session/org.libvirt.service: session/org.libvirt.service.in
	$(AM_V_GEN)$(MKDIR_P) session && \
		sed -e 's|[@]bindir[@]|$(bindir)|g' < $< > $@-t && \
			mv $@-t $@

system/org.libvirt.service: system/org.libvirt.service.in
	$(AM_V_GEN)$(MKDIR_P) system && \
		sed -e 's|[@]bindir[@]|$(bindir)|g' \
		    -e 's|[@]SYSTEM_USER[@]|$(SYSTEM_USER)|' \
			< $< > $@-t && mv $@-t $@

system/org.libvirt.conf: system/org.libvirt.conf.in
	$(AM_V_GEN)$(MKDIR_P) system && \
		sed -e 's|[@]SYSTEM_USER[@]|$(SYSTEM_USER)|' \
			< $< > $@-t && mv $@-t $@

system/libvirt-dbus.rules: system/libvirt-dbus.rules.in
	$(AM_V_GEN)$(MKDIR_P) system && \
		sed -e 's|[@]SYSTEM_USER[@]|$(SYSTEM_USER)|' \
			< $< > $@-t && mv $@-t $@
