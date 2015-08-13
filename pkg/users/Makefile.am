usersdir = $(pkgdatadir)/users
users_GZ = \
	pkg/users/bundle.min.js.gz \
	pkg/users/local.min.html.gz \
	pkg/users/users.min.css.gz \
	$(NULL)
users_DATA = \
	pkg/users/manifest.json \
	$(users_GZ) \
	$(NULL)

usersdebugdir = $(debugdir)$(usersdir)
usersdebug_DATA = \
	pkg/users/bundle.js \
	pkg/users/local.html \
	pkg/users/local.js \
	pkg/users/users.css \
	$(NULL)

users_BUNDLE = \
	pkg/users/local.min.js \
	$(NULL)

pkg/users/bundle.min.js: $(users_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

users_TESTS = \
	$(NULL)

TESTS += $(users_TESTS)

CLEANFILES += \
	pkg/users/bundle.min.js \
	pkg/users/local.min.html \
	$(users_BUNDLE) \
	$(users_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/users/bundle.min.js \
	pkg/users/local.min.html \
	$(users_DATA) \
	$(usersdebug_DATA) \
	$(users_TESTS) \
	$(users_BUNDLE) \
	$(NULL)
