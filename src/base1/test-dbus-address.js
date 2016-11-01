/* global $, cockpit, QUnit, direct_address, common_dbus_tests, bus_address, dbus_track_tests */

/* To help with future migration */
var assert = QUnit;

/* no name */
var direct_options = {
    "address": direct_address,
    "bus": "none",
    "capabilities": ["address"]
};

common_dbus_tests(direct_options, null);

/* with a name */
var address_options = {
    "address": bus_address,
    "bus": "none",
    "capabilities": ["address"]
};
common_dbus_tests(address_options, "com.redhat.Cockpit.DBusTests.Test");
dbus_track_tests(address_options, "com.redhat.Cockpit.DBusTests.Test");

QUnit.start();
