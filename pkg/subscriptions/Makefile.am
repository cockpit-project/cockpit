
subscriptionsdir = $(pkgdatadir)/subscriptions
subscriptions_GZ = \
	pkg/subscriptions/index.min.html.gz \
	pkg/subscriptions/subscriptions.min.css.gz \
	pkg/subscriptions/subscriptions.min.js.gz \
	$(NULL)
subscriptions_DATA = \
	pkg/subscriptions/manifest.json \
	$(subscriptions_GZ) \
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
	$(subscriptions_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/subscriptions/index.min.html \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.css \
	$(subscriptions_DATA) \
	$(subscriptionsdebug_DATA) \
	$(NULL)
