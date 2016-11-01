/* global $, cockpit, QUnit, unescape, escape */

/* To help with future migration */
var assert = QUnit;

var root_user = {
    name: "weird-root",
    id: 0,
    groups: null
};

var priv_user = {
    name: "user",
    id: 1000,
    groups: ["user", "agroup"]
};

var limited_user = {
    name: "limited",
    id: 1001,
    groups: ["limited"]
};


QUnit.module("Permission tests", {
    setup: function() {
        this.old_dbus = cockpit.dbus;
    },
    teardown: function() {
        cockpit.dbus = this.old_dbus;
    }
});


QUnit.test("root-all-permissions", function() {
    assert.expect(2);

    var p1 = cockpit.permission({ user: priv_user });
    assert.equal(p1.allowed, false, "not root, not allowed");

    var p2 = cockpit.permission({ user: root_user });
    assert.equal(p2.allowed, true, "is root, allowed");
});

QUnit.test("group-permissions", function() {
    assert.expect(4);

    var p1 = cockpit.permission({ user: priv_user, group: "badgroup" });
    assert.equal(p1.allowed, false, "no group, not allowed");

    var p2 = cockpit.permission({ user: priv_user, group: "agroup" });
    assert.equal(p2.allowed, true, "has group, allowed");

    var p3 = cockpit.permission({ user: root_user, group: "agroup" });
    assert.equal(p3.allowed, true, "no group but root, allowed");

    var p4 = cockpit.permission({ user: { id: 0, groups: ["other"] }, group: "agroup" });
    assert.equal(p4.allowed, true, "no group match but root, allowed");
});

// Start tests after we have a user object
cockpit.user().done(function (user) {
    QUnit.start();
});
