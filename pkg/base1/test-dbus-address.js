/* global direct_address, bus_address, */
import { common_dbus_tests, dbus_track_tests } from "./test-dbus-common.js";

import QUnit from "qunit-tests";

/* no name */
const direct_options = {
    address: direct_address,
    bus: "none",
    capabilities: ["address"]
};

common_dbus_tests(direct_options, null);

/* with a name */
const address_options = {
    address: bus_address,
    bus: "none",
    capabilities: ["address"]
};
common_dbus_tests(address_options, "com.redhat.Cockpit.DBusTests.Test");
dbus_track_tests(address_options, "com.redhat.Cockpit.DBusTests.Test");

QUnit.start();
