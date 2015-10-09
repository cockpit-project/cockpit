usersdir = $(pkgdatadir)/users
nodist_users_DATA = \
	assets/users/bundle.min.js.gz \
	assets/users/index.min.html.gz \
	assets/users/users.min.css.gz \
	$(NULL)
users_DATA = \
	assets/users/manifest.json \
	$(NULL)

users_SCRIPTS = \
	assets/users/ssh-add-public-key.sh \
	assets/users/ssh-list-public-keys.sh \
	$(NULL)

usersdebugdir = $(debugdir)$(usersdir)
usersdebug_DATA = \
	assets/users/authorized-keys.js \
	assets/users/bundle.js \
	assets/users/index.html \
	assets/users/local.js \
	assets/users/users.css \
	$(users_SCRIPTS) \
	$(NULL)

users_BUNDLEFILES = \
	assets/users/authorized-keys.min.js \
	assets/users/local.min.js \
	$(NULL)

users_BUNDLE = \
	$(users_BUNDLEFILES) \
	$(users_SCRIPTS) \
	$(NULL)

assets/users/bundle.min.js: $(users_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

users_TESTS = \
	assets/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(users_TESTS)

CLEANFILES += \
	assets/users/bundle.min.js \
	assets/users/index.min.html \
	assets/users/users.min.css \
	$(users_BUNDLEFILES) \
	$(nodist_users_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/users/mock \
	assets/users/bundle.min.js \
	assets/users/index.min.html \
	assets/users/users.min.css \
	$(users_DATA) \
	$(usersdebug_DATA) \
	$(users_TESTS) \
	$(users_BUNDLE) \
	$(NULL)
