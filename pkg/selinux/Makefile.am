PKGDIR=pkg/selinux

setroubleshoot_MODULES = \
	$(PKGDIR)/setroubleshoot.js \
	$(PKGDIR)/selinux-client.js \
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
	$(PKGDIR)/react.js \
	$(PKGDIR)/bundle.js \
	$(PKGDIR)/setroubleshoot.css \
	$(PKGDIR)/setroubleshoot.html \
	$(PKGDIR)/setroubleshoot-view.jsx \
	$(PKGDIR)/setroubleshoot-view.js \
	$(PKGDIR)/cockpit-components-listing.js \
	$(setroubleshoot_MODULES) \
	$(NULL)

# Ugliness to be solved by webpack in the future
$(PKGDIR)/moment.min.js: $(PKGDIR)/moment.js
	$(MIN_JS_RULE)
$(PKGDIR)/react.min.js: $(PKGDIR)/react.js
	$(MIN_JS_RULE)

setroubleshoot_MIN = \
	$(setroubleshoot_MODULES:.js=.min.js) \
	$(PKGDIR)/setroubleshoot-view.min.js \
	$(NULL)

setroubleshoot_BUNDLE = \
	$(PKGDIR)/react.min.js \
	$(PKGDIR)/cockpit-components-listing.min.js \
	$(setroubleshoot_MIN) \
	$(NULL)

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
	pkg/selinux/react.min.js \
	pkg/selinux/cockpit-components-listing.min.js \
	pkg/selinux/cockpit-components-listing.js \
	$(NULL)

EXTRA_DIST += \
	pkg/selinux/react.js \
	pkg/selinux/react.min.js \
	pkg/selinux/cockpit-components-listing.jsx \
	pkg/selinux/cockpit-components-listing.min.js \
	pkg/selinux/cockpit-components-listing.js \
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
