import cockpit from "cockpit";
import QUnit from "qunit-tests";

QUnit.test("load user info", async assert => {
    const dbus = cockpit.dbus(null, { bus: "internal" });
    const [user] = await dbus.call("/user", "org.freedesktop.DBus.Properties",
                                   "GetAll", ["cockpit.User"], { type: "s" });
    assert.ok(user.Name !== undefined, "has Name");
    assert.equal(user.Name.t, "s", "string Name");
    assert.ok(user.Full !== undefined, "has Full name");
    assert.equal(user.Full.t, "s", "string Full");
    assert.ok(user.Shell !== undefined, "has Shell");
    assert.equal(user.Home.t, "s", "type Home");
    assert.equal(user.Home.v.indexOf("/"), 0, "Home starts with slash");
    assert.equal(user.Groups.t, "as", "type Groups");
});

QUnit.test("user object", async assert => {
    const user = await cockpit.user();
    assert.equal(typeof user.name, "string", "user name");
    assert.equal(typeof user.full_name, "string", "user full name");
    assert.equal(typeof user.shell, "string", "user shell");
    assert.equal(typeof user.home, "string", "user home");
    assert.equal(typeof user.id, "number", "user id");
    assert.ok(Array.isArray(user.groups), "user groups");
});

QUnit.test("user environment", async assert => {
    const data = await cockpit.spawn(["/bin/sh", "-c", "echo $USER~$SHELL~$HOME"]);
    const parts = data.split("~");
    assert.ok(parts[0].length > 0, "valid $USER");
    assert.ok(parts[1].length > 0, "valid $HOME");
    assert.equal(parts[1].indexOf("/"), 0, "$HOME starts with slash");
    assert.ok(parts[2].length > 0, "valid $SHELL");
    assert.equal(parts[1].indexOf("/"), 0, "$SHELL starts with slash");
});

QUnit.start();
