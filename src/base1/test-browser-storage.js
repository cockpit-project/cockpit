/* global $, cockpit, QUnit, unescape, escape */

/* To help with future migration */
var assert = QUnit;

function test_storage (storage, cockpitStorage) {
    assert.expect(29);
    storage.clear();
    window.mock = {
        "pathname" : "/cockpit+test/test"
    };

    assert.equal(cockpitStorage.prefixedKey("key1"), "cockpit+test:key1", "prefixed key has application");

    /* setting */
    cockpitStorage.setItem("key1", "value1", false);
    assert.equal(storage.getItem("cockpit+test:key1"), "value1", "set single: application key set");
    assert.equal(storage.getItem("key1"), null, "set single: key not set");
    cockpitStorage.setItem("key1", "value2", true);
    assert.equal(storage.getItem("cockpit+test:key1"), "value2", "set both: application key set");
    assert.equal(storage.getItem("key1"), "value2", "set both: key set");
    storage.clear();

    /* getting */
    storage.setItem("key1", "value1");
    assert.equal(cockpitStorage.getItem("key1", false), null, "get single doesn't default to bare key");
    assert.equal(cockpitStorage.getItem("key1", true), "value1", "get both defaults to bare key");
    storage.setItem("cockpit+test:key1", "value2");
    assert.equal(storage.getItem("key1"), "value1", "bare key not changed");
    assert.equal(cockpitStorage.getItem("key1", false), "value2", "get single gets application prefixed value");
    assert.equal(cockpitStorage.getItem("key1", true), "value2", "get both prefers application prefixed value");

    /* removing */
    cockpitStorage.removeItem("key1", false);
    assert.equal(storage.getItem("key1"), "value1", "remove single doesn't remove bare key");
    assert.equal(storage.getItem("cockpit+test:key1"), null, "remove single removes application prefixed key");
    storage.setItem("cockpit+test:key1", "value1");
    assert.equal(storage.getItem("cockpit+test:key1"), "value1", "application prefixed value reset");
    cockpitStorage.removeItem("key1", true);
    assert.equal(storage.getItem("key1"), null, "remove both removes bare key");
    assert.equal(storage.getItem("cockpit+test:key1"), null, "remove both removes application prefixed key");
    storage.clear();

    /* clearing */
    storage.setItem("key1", "value");
    storage.setItem("key2", "value");
    storage.setItem("cockpit+other:key1", "value");
    storage.setItem("cockpit+other:key2", "value");
    storage.setItem("cockpit+test:key1", "value");
    storage.setItem("cockpit+test:key2", "value");

    cockpitStorage.clear(false);
    assert.equal(storage.getItem("key1"), "value", "clear doesn't remove bare key1");
    assert.equal(storage.getItem("key2"), "value", "clear doesn't remove bare key2");
    assert.equal(storage.getItem("cockpit+other:key1"), "value", "clear doesn't remove other application's key1");
    assert.equal(storage.getItem("cockpit+other:key2"), "value", "clear doesn't remove other application's key2");
    assert.equal(storage.getItem("cockpit+test:key1"), null, "clear doesn't remove our application's key1");
    assert.equal(storage.getItem("cockpit+test:key2"), null, "clear doesn't remove our application's key2");

    storage.setItem("cockpit+test:key1", "value");
    storage.setItem("cockpit+test:key2", "value");
    assert.equal(storage.getItem("cockpit+test:key1"), "value", "our application's key1 reset");
    assert.equal(storage.getItem("cockpit+test:key2"), "value", "our application's key2 reset");

    cockpitStorage.clear(true);
    assert.equal(storage.getItem("key1"), null, "clear full removes bare key1");
    assert.equal(storage.getItem("key2"), null, "clear full removes bare key2");
    assert.equal(storage.getItem("cockpit+other:key1"), "value", "clear full doesn't remove other application's key1");
    assert.equal(storage.getItem("cockpit+other:key2"), "value", "clear full doesn't remove other application's key2");
    assert.equal(storage.getItem("cockpit+test:key1"), null, "clear full removes our application's key1");
    assert.equal(storage.getItem("cockpit+test:key2"), null, "clear full removes our application's key2");
}

QUnit.test("local-storage", function() {
    test_storage (window.localStorage, cockpit.localStorage);
});

QUnit.test("session-storage", function() {
    test_storage (window.sessionStorage, cockpit.sessionStorage);
});

// Start tests after we have a user object
cockpit.user().done(function (user) {
    QUnit.start();
});
