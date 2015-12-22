
ocservdir = $(pkgdatadir)/ocserv
ocserv_DATA = \
	pkg/ocserv/ocserv.min.css.gz \
	pkg/ocserv/ocserv.min.html.gz \
	pkg/ocserv/manifest.json \
	$(NULL)

ocservdebugdir = $(DBGDIR)$(ocservdir)
ocservdebug_DATA = \
	pkg/ocserv/ocserv.html \
	pkg/ocserv/ocserv.css \
	$(NULL)

CLEANFILES += \
	pkg/ocserv/ocserv.min.html \
	pkg/ocserv/ocserv.min.css \
	$(NULL)

EXTRA_DIST += \
	pkg/ocserv/ocserv.min.html \
	pkg/ocserv/ocserv.min.css \
	$(ocserv_DATA) \
	$(ocservdebug_DATA) \
	$(NULL)
