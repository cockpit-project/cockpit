
ostreedir = $(pkgdatadir)/ostree

ostree_DATA = \
	pkg/ostree/ostree.min.css.gz \
	pkg/ostree/ostree.min.html.gz \
	pkg/ostree/ostree.min.js.gz \
	pkg/ostree/manifest.json \
	$(NULL)

ostreedebugdir = $(DBGDIR)$(ostreedir)
ostreedebug_DATA = \
	pkg/ostree/ember.js \
	pkg/ostree/ostree.css \
	pkg/ostree/app.js \
	pkg/ostree/software-updates.js \
	pkg/ostree/notifications.js \
	pkg/ostree/models.js \
	pkg/ostree/ostree.html \
	$(NULL)

ostree_BUNDLE = \
	pkg/ostree/ember.min.js \
	pkg/ostree/app.min.js \
	pkg/ostree/models.min.js \
	pkg/ostree/software-updates.min.js \
	pkg/ostree/notifications.min.js \
	$(NULL)

pkg/ostree/ostree.min.js: $(ostree_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

CLEANFILES += \
	pkg/ostree/ostree.min.css \
	pkg/ostree/ostree.min.html \
	pkg/ostree/ostree.min.js \
	$(ostree_BUNDLE) \
	$(NULL)

EXTRA_DIST += \
	pkg/ostree/ostree.min.html \
	pkg/ostree/ostree.min.js \
	$(ostree_BUNDLE) \
	$(ostree_DATA) \
	$(ostreedebug_DATA) \
	$(ostree_TESTS) \
	pkg/ostree/ember.min.js \
	pkg/ostree/ember-config.js \
	$(NULL)

update-lib:: update-bower
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/ostree/ember.js \
	    $(BOWER)/ember/ember.debug.js \
	    $(BOWER)/ember/ember-template-compiler.js \
	    $(srcdir)/pkg/ostree/ember-config.js
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/ostree/ember.min.js \
	    $(BOWER)/ember/ember.min.js \
	    $(BOWER)/ember/ember-template-compiler.js \
	    $(srcdir)/pkg/ostree/ember-config.js

# Never recreate these files
pkg/ostree/ember.min.js:
	@true
