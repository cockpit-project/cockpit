
subscriptionsdir = $(pkgdatadir)/subscriptions
nodist_subscriptions_DATA = \
	pkg/subscriptions/index.min.html.gz \
	pkg/subscriptions/subscriptions.min.css.gz \
	pkg/subscriptions/bundle.min.js.gz \
	$(NULL)
subscriptions_DATA = \
	pkg/subscriptions/manifest.json \
	$(NULL)

subscriptionsdebugdir = $(debugdir)$(subscriptionsdir)
subscriptionsdebug_DATA = \
	pkg/subscriptions/bundle.js \
	pkg/subscriptions/index.html \
	pkg/subscriptions/patterns.js \
	pkg/subscriptions/subscriptions.js \
	pkg/subscriptions/subscriptions.css \
	$(NULL)

subscriptions_BUNDLE = \
	pkg/subscriptions/patterns.min.js \
	pkg/subscriptions/subscriptions.min.js \
	$(NULL)

pkg/subscriptions/bundle.min.js: $(subscriptions_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

CLEANFILES += \
	pkg/subscriptions/index.min.html \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.css \
	pkg/subscriptions/bundle.min.js \
	$(subscriptions_BUNDLE) \
	$(nodist_subscriptions_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/subscriptions/index.min.html \
	pkg/subscriptions/subscriptions.min.css \
	$(subscriptions_BUNDLE) \
	$(NULL)
