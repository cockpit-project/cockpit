sosreportdir = $(pkgdatadir)/sosreport
nodist_sosreport_DATA = \
	pkg/sosreport/index.min.html.gz \
	pkg/sosreport/sosreport.min.css.gz \
	pkg/sosreport/index.min.js.gz \
	$(NULL)
sosreport_DATA = \
	pkg/sosreport/manifest.json \
	pkg/sosreport/sosreport.png \
	pkg/sosreport/run-sosreport.sh \
	$(NULL)

sosreportdebugdir = $(debugdir)$(sosreportdir)
sosreportdebug_DATA = \
	pkg/sosreport/index.html \
	pkg/sosreport/index.js \
	pkg/sosreport/sosreport.css \
	$(NULL)

CLEANFILES += \
	pkg/sosreport/index.min.html \
	pkg/sosreport/index.min.js \
	pkg/sosreport/sosreport.min.css \
	$(nodist_sosreport_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/sosreport/index.min.html \
	pkg/sosreport/index.min.js \
	pkg/sosreport/sosreport.min.css \
	$(NULL)
