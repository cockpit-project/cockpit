setroubleshoot_MODULES = \
	pkg/selinux/setroubleshoot.js \
	pkg/selinux/selinux-client.js \
	pkg/selinux/setroubleshoot-client.js \
	pkg/selinux/moment.js \
	$(NULL)

setroubleshoot_TESTS = \
	$(NULL)

# Typically only modify stuff above this line

setroubleshootdir = $(pkgdatadir)/selinux
nodist_setroubleshoot_DATA = \
	pkg/selinux/setroubleshoot.min.html.gz \
	pkg/selinux/bundle.min.js.gz \
	pkg/selinux/setroubleshoot.min.css.gz \
	$(NULL)
setroubleshoot_DATA = \
	pkg/selinux/manifest.json \
	$(NULL)

setroubleshootdebugdir = $(debugdir)$(setroubleshootdir)
setroubleshootdebug_DATA = \
	pkg/selinux/react.js \
	pkg/selinux/bundle.js \
	pkg/selinux/setroubleshoot.css \
	pkg/selinux/setroubleshoot.html \
	pkg/selinux/setroubleshoot-view.jsx \
	pkg/selinux/setroubleshoot-view.js \
	pkg/selinux/cockpit-components-listing.js \
	$(setroubleshoot_MODULES) \
	$(NULL)

# Ugliness to be solved by webpack in the future
pkg/selinux/moment.min.js: pkg/selinux/moment.js
	$(MIN_JS_RULE)
pkg/selinux/react.min.js: pkg/selinux/react.js
	$(MIN_JS_RULE)

setroubleshoot_MIN = \
	$(setroubleshoot_MODULES:.js=.min.js) \
	pkg/selinux/setroubleshoot-view.min.js \
	$(NULL)

setroubleshoot_BUNDLE = \
	pkg/selinux/react.min.js \
	pkg/selinux/cockpit-components-listing.min.js \
	$(setroubleshoot_MIN) \
	$(NULL)

# Everything else into a nice big bundle
pkg/selinux/bundle.min.js: $(setroubleshoot_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

TESTS += $(setroubleshoot_TESTS)

CLEANFILES += \
	pkg/selinux/setroubleshoot.min.css \
	pkg/selinux/setroubleshoot.min.html \
	pkg/selinux/bundle.min.js \
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
	pkg/selinux/setroubleshoot.min.css \
	pkg/selinux/setroubleshoot.min.html \
	pkg/selinux/bundle.min.js \
	$(setroubleshoot_BOWER) \
	$(setroubleshoot_BUNDLE) \
	$(setroubleshoot_MODULES) \
	$(setroubleshoot_DATA) \
	$(setroubleshootdebug_DATA) \
	$(setroubleshoot_TESTS) \
	$(NULL)
