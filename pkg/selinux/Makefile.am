PKGDIR=pkg/selinux

setroubleshoot_MODULES = \
	$(PKGDIR)/setroubleshoot.js \
	$(PKGDIR)/setroubleshoot-client.js \
	$(PKGDIR)/moment.js \
	$(NULL)

setroubleshoot_TESTS = \
	$(NULL)

# Typically only modify stuff above this line

setroubleshootdir = $(pkgdatadir)/selinux
nodist_setroubleshoot_DATA = \
	$(PKGDIR)/setroubleshoot.min.html.gz \
	$(PKGDIR)/bundle.min.js.gz \
	$(PKGDIR)/setroubleshoot.min.css.gz \
	$(NULL)
setroubleshoot_DATA = \
	$(PKGDIR)/manifest.json \
	$(NULL)

setroubleshootdebugdir = $(debugdir)$(setroubleshootdir)
setroubleshootdebug_DATA = \
	$(PKGDIR)/bundle.js \
	$(PKGDIR)/setroubleshoot.css \
	$(PKGDIR)/setroubleshoot.html \
	$(PKGDIR)/setroubleshoot.js \
	$(PKGDIR)/setroubleshoot-client.js \
	$(PKGDIR)/setroubleshoot-view.jsx \
	$(PKGDIR)/setroubleshoot-view.js \
	$(PKGDIR)/moment.js \
	$(NULL)

# moment.js can't be parsed as strictly as our own modules
$(PKGDIR)/moment.min.js: $(PKGDIR)/moment.js
	$(MIN_JS_RULE)

setroubleshoot_MIN = \
	$(setroubleshoot_MODULES:.js=.min.js) \
	$(PKGDIR)/setroubleshoot-view.min.js \
	$(NULL)

setroubleshoot_BUNDLE = $(setroubleshoot_MIN)

# Everything else into a nice big bundle
$(PKGDIR)/bundle.min.js: $(setroubleshoot_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

TESTS += $(setroubleshoot_TESTS)

CLEANFILES += \
	$(PKGDIR)/setroubleshoot.min.css \
	$(PKGDIR)/setroubleshoot.min.html \
	$(PKGDIR)/bundle.min.js \
	$(setroubleshoot_MIN) \
	$(nodist_setroubleshoot_DATA) \
	$(NULL)

EXTRA_DIST += \
	$(PKGDIR)/setroubleshoot.min.css \
	$(PKGDIR)/setroubleshoot.min.html \
	$(PKGDIR)/bundle.min.js \
	$(setroubleshoot_BOWER) \
	$(setroubleshoot_BUNDLE) \
	$(setroubleshoot_MODULES) \
	$(setroubleshoot_DATA) \
	$(setroubleshootdebug_DATA) \
	$(setroubleshoot_TESTS) \
	$(NULL)
