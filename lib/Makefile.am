REACT_COMPONENTS = \
	lib/cockpit-components-listing.jsx \
	lib/cockpit-components-select.jsx \
	lib/cockpit-components-terminal.jsx \
	lib/cockpit-components-dialog.jsx \
	$(NULL)

lib_TESTS = \
	lib/test-dummy.html \
	lib/test-patterns.html \
	lib/test-machines.html \
	$(NULL)

TESTS += $(lib_TESTS)

EXTRA_DIST += \
	$(REACT_COMPONENTS) \
	$(lib_TESTS) \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d 'jquery' \
	    -o $(srcdir)/lib/flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.selection.js \
	    $(BOWER)/jquery-flot/jquery.flot.time.js \
	    $(NULL)
