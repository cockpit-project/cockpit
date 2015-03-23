
subscriptionsdir = $(pkgdatadir)/subscriptions
subscriptions_DATA = \
	pkg/subscriptions/subscriptions.css \
	pkg/subscriptions/subscriptions.html \
	pkg/subscriptions/subscriptions.min.html \
	pkg/subscriptions/subscriptions.min.js.gz \
	pkg/subscriptions/manifest.json \
	$(NULL)

subscriptionsdebugdir = $(DBGDIR)$(subscriptionsdir)
subscriptionsdebug_DATA = \
	pkg/subscriptions/subscriptions.js \
	$(NULL)

CLEANFILES += \
	pkg/subscriptions/subscriptions.min.js \
	pkg/subscriptions/subscriptions.min.html \
	$(NULL)

EXTRA_DIST += \
	$(subscriptions_DATA) \
	$(subscriptionsdebug_DATA) \
	$(NULL)
