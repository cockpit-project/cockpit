POD2MAN = pod2man -c "Virtualization Support" -r "$(PACKAGE)-$(VERSION)"

PODFILES = libvirt-dbus.pod

%.8: %.pod
	$(AM_V_GEN)$(POD2MAN) -s 8 $< $@ \
		&& if grep 'POD ERROR' $@; then rm $@; exit 1; fi

man8_MANS = libvirt-dbus.8

EXTRA_DIST = $(PODFILES)

CLEANFILES = $(man8_MANS)
