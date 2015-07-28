
subscriptionsdir = $(pkgdatadir)/subscriptions
subscriptions_GZ = \
	pkg/subscriptions/subscriptions.min.css.gz \
	pkg/subscriptions/subscriptions.min.html.gz \
	pkg/subscriptions/subscriptions.min.js.gz \
	$(NULL)
subscriptions_DATA = \
	pkg/subscriptions/manifest.json \
	$(subscriptions_GZ) \
	$(NULL)

subscriptionsdebugdir = $(debugdir)$(subscriptionsdir)
subscriptionsdebug_DATA = \
	pkg/subscriptions/subscriptions.html \
	pkg/subscriptions/subscriptions.js \
	pkg/subscriptions/subscriptions.css \
	$(NULL)

CLEANFILES += \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.html \
	pkg/subscriptions/subscriptions.min.css \
	$(subscriptions_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.html \
	pkg/subscriptions/subscriptions.min.css \
	$(subscriptions_DATA) \
	$(subscriptionsdebug_DATA) \
	$(NULL)
