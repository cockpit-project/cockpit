
ostreedir = $(pkgdatadir)/ostree
nodist_ostree_DATA = \
	pkg/ostree/ostree.min.css.gz \
	pkg/ostree/index.min.html.gz \
	pkg/ostree/ostree.min.js.gz \
	$(NULL)

ostree_DATA = \
	pkg/ostree/manifest.json \
	$(NULL)

ostreedebugdir = $(debugdir)$(ostreedir)
ostreedebug_DATA = \
	pkg/ostree/ostree.css \
	pkg/ostree/app.js \
	pkg/ostree/client.js \
	pkg/ostree/ostree.js \
	pkg/ostree/index.html \
	$(NULL)

ostree_BUNDLE = \
	pkg/ostree/client.min.js \
	pkg/ostree/app.min.js \
	$(NULL)

pkg/ostree/ostree.min.js: $(ostree_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

CLEANFILES += \
	pkg/ostree/ostree.min.css \
	pkg/ostree/index.min.html \
	pkg/ostree/ostree.min.js \
	$(ostree_BUNDLE) \
	$(nodist_ostree_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/ostree/index.min.html \
	pkg/ostree/ostree.min.js \
	pkg/ostree/ostree.min.css \
	$(ostree_BUNDLE) \
	$(NULL)
