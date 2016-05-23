
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
	pkg/ostree/moment.js \
	pkg/ostree/ostree.js \
	pkg/ostree/index.html \
	$(NULL)

ostree_ANGULAR = \
	pkg/ostree/angular.js \
	pkg/ostree/angular-route.js \
	pkg/ostree/ui-bootstrap.js \
	pkg/ostree/ui-bootstrap-tpls.js \
	$(NULL)

pkg/ostree/angular.min.js: $(ostree_ANGULAR)
	$(MIN_JS_RULE)

ostree_BUNDLE = \
	pkg/ostree/angular.min.js \
	pkg/ostree/client.min.js \
	pkg/ostree/moment.min.js \
	pkg/ostree/app.min.js \
	$(NULL)

pkg/ostree/moment.min.js: pkg/ostree/moment.js
	$(MIN_JS_RULE)
pkg/ostree/ostree.min.js: $(ostree_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

CLEANFILES += \
	pkg/ostree/angular.min.js \
	pkg/ostree/ostree.min.css \
	pkg/ostree/index.min.html \
	pkg/ostree/moment.min.js \
	pkg/ostree/ostree.min.js \
	$(ostree_BUNDLE) \
	$(nodist_ostree_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/ostree/angular.min.js \
	pkg/ostree/index.min.html \
	pkg/ostree/moment.min.js \
	pkg/ostree/ostree.min.js \
	pkg/ostree/ostree.min.css \
	$(ostree_BUNDLE) \
	$(NULL)
