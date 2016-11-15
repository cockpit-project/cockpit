/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

var pig_latin = {
    "": { "language": "pig", "plural-forms": function(n) {
        var nplurals, plural; nplurals=2; plural=(n != 1); return plural;
    } },
    "Control": [ null, "Ontrolcay" ],
    "$0 disk is missing": [
        "$0 disk is missing",
        "$0 isksbay is issingmay",
        "$0 isksbay are issingmay"
    ],
    "key\u0004Control": [ null, "OntrolCAY" ],
    "disk-non-rotational\u0004$0 disk is missing": [
        "disk-non-rotational\u0004$0 disk is missing",
        "$0 isksBAY is issingMAY",
        "$0 isksBAY are issingMAY"
    ]
};

var ru = {
    "": { "language": "ru", "plural-forms":
        function(n) {
            var nplurals, plural; nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);
            return plural;
        }
    },
    "$0 bit": [ "$0 bits", "$0 бит", "$0 бита", "$0 бит" ]
};

QUnit.test("public api", function() {
    assert.equal(typeof cockpit.locale, "function", "cockpit.locale is a function");
});

QUnit.test("gettext", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    assert.equal(cockpit.language, "pig", "correct lang");
    assert.equal(cockpit.gettext("Control"), "Ontrolcay", "returned translation");
    assert.equal(cockpit.gettext("key", "Control"), "OntrolCAY", "with context");
    assert.equal(cockpit.gettext("Empty"), "Empty", "english default");
    assert.equal(cockpit.gettext("verb", "Empty"), "Empty", "english default context");
});

QUnit.test("underscore", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    var _ = cockpit.gettext;
    var C_ = _;
    assert.equal(_("Control"), "Ontrolcay", "returned translation");
    assert.equal(_("Empty"), "Empty", "english default");
    assert.equal(C_("key", "Control"), "OntrolCAY", "with context");
    assert.equal(C_("verb", "Empty"), "Empty", "with context");
});

QUnit.test("ngettext simple", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    assert.equal(cockpit.ngettext("$0 disk is missing", "$0 disks are missing", 0), "$0 isksbay are issingmay", "zero things");
    assert.equal(cockpit.ngettext("$0 disk is missing", "$0 disks are missing", 1), "$0 isksbay is issingmay", "one thing");
    assert.equal(cockpit.ngettext("$0 disk is missing", "$0 disks are missing", 5), "$0 isksbay are issingmay", "multiple things");
    assert.equal(cockpit.ngettext("disk-non-rotational", "$0 disk is missing", "$0 disks are missing", 0),
            "$0 isksBAY are issingMAY", "zero things context");
    assert.equal(cockpit.ngettext("disk-non-rotational", "$0 disk is missing", "$0 disks are missing", 1),
            "$0 isksBAY is issingMAY", "one thing context");
    assert.equal(cockpit.ngettext("disk-non-rotational", "$0 disk is missing", "$0 disks are missing", 5),
            "$0 isksBAY are issingMAY", "multiple things context");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 1), "$0 byte", "default one");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 2), "$0 bytes", "default multiple");
    assert.equal(cockpit.ngettext("memory", "$0 byte", "$0 bytes", 1), "$0 byte", "default one context");
    assert.equal(cockpit.ngettext("memory", "$0 byte", "$0 bytes", 2), "$0 bytes", "default multiple context");
});

QUnit.test("ngettext complex", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(ru);
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 0), "$0 бит", "zero things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 1), "$0 бит", "one thing");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 5), "$0 бит", "multiple things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 23), "$0 бита", "genitive singular");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 1), "$0 byte", "default one");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 2), "$0 bytes", "default multiple");
});

QUnit.start();
