
subscriptionsdir = $(pkgdatadir)/subscriptions
nodist_subscriptions_DATA = \
	assets/subscriptions/index.min.html.gz \
	assets/subscriptions/subscriptions.min.css.gz \
	assets/subscriptions/subscriptions.min.js.gz \
	$(NULL)
subscriptions_DATA = \
	assets/subscriptions/manifest.json \
	$(NULL)

subscriptionsdebugdir = $(debugdir)$(subscriptionsdir)
subscriptionsdebug_DATA = \
	assets/subscriptions/index.html \
	assets/subscriptions/subscriptions.js \
	assets/subscriptions/subscriptions.css \
	$(NULL)

CLEANFILES += \
	assets/subscriptions/index.min.html \
	assets/subscriptions/subscriptions.min.js \
	assets/subscriptions/subscriptions.min.css \
	$(nodist_subscriptions_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/subscriptions/index.min.html \
	assets/subscriptions/subscriptions.min.js \
	assets/subscriptions/subscriptions.min.css \
	$(subscriptions_DATA) \
	$(subscriptionsdebug_DATA) \
	$(NULL)
