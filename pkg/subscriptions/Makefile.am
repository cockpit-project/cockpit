
subscriptionsdir = $(pkgdatadir)/subscriptions
nodist_subscriptions_DATA = \
	pkg/subscriptions/index.min.html.gz \
	pkg/subscriptions/subscriptions.min.css.gz \
	pkg/subscriptions/subscriptions.min.js.gz \
	$(NULL)
subscriptions_DATA = \
	pkg/subscriptions/manifest.json \
	$(NULL)

subscriptionsdebugdir = $(debugdir)$(subscriptionsdir)
subscriptionsdebug_DATA = \
	pkg/subscriptions/index.html \
	pkg/subscriptions/subscriptions.js \
	pkg/subscriptions/subscriptions.css \
	$(NULL)

CLEANFILES += \
	pkg/subscriptions/index.min.html \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.css \
	$(nodist_subscriptions_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/subscriptions/index.min.html \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.css \
	$(subscriptions_DATA) \
	$(subscriptionsdebug_DATA) \
	$(NULL)
