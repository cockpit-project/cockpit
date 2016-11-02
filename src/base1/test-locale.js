/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

var pig_latin = {
    "": { "language": "pig", "plural-forms": function(n) {
        var nplurals, plural; nplurals=2; plural=(n != 1); return plural;
    } },
    "Marmalade": [ null, "Armalademay" ],
    "$0 bucket": [ "$0 buckets", "$0 ucketbay", "$0 ucketsbay" ],
    "explain\u0004Marmalade": [ null, "ArmaladeMAY" ],
    "explain\u0004$0 bucket": [ "explain\u0004$0 buckets", "$0 ucketBAY", "$0 ucketsBAY" ]
};

var ru = {
    "": { "language": "ru", "plural-forms":
        function(n) { var nplurals, plural; nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2); return plural;
    } },
    "$0 bit": [ "$0 bits", "$0 бит", "$0 бита", "$0 бит" ]
};

QUnit.test("public api", function() {
    assert.equal(typeof cockpit.locale, "function", "cockpit.locale is a function");
});

QUnit.test("gettext", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    assert.equal(cockpit.language, "pig", "correct lang");
    assert.equal(cockpit.gettext("Marmalade"), "Armalademay", "returned translation");
    assert.equal(cockpit.gettext("explain", "Marmalade"), "ArmaladeMAY", "with context");
    assert.equal(cockpit.gettext("Blah"), "Blah", "english default");
    assert.equal(cockpit.gettext("explain", "Blah"), "Blah", "english default context");
});

QUnit.test("underscore", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    var _ = cockpit.gettext;
    var C_ = _;
    assert.equal(_("Marmalade"), "Armalademay", "returned translation");
    assert.equal(_("Blah"), "Blah", "english default");
    assert.equal(C_("explain", "Marmalade"), "ArmaladeMAY", "with context");
    assert.equal(C_("explain", "Blah"), "Blah", "with context");
});

QUnit.test("ngettext simple", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    assert.equal(cockpit.ngettext("$0 bucket", "$0 buckets", 0), "$0 ucketsbay", "zero things");
    assert.equal(cockpit.ngettext("$0 bucket", "$0 buckets", 1), "$0 ucketbay", "one thing");
    assert.equal(cockpit.ngettext("$0 bucket", "$0 buckets", 5), "$0 ucketsbay", "multiple things");
    assert.equal(cockpit.ngettext("explain", "$0 bucket", "$0 buckets", 0), "$0 ucketsBAY", "zero things context");
    assert.equal(cockpit.ngettext("explain", "$0 bucket", "$0 buckets", 1), "$0 ucketBAY", "one thing context");
    assert.equal(cockpit.ngettext("explain", "$0 bucket", "$0 buckets", 5), "$0 ucketsBAY", "multiple things context");
    assert.equal(cockpit.ngettext("$0 mop", "$0 mops", 1), "$0 mop", "default one");
    assert.equal(cockpit.ngettext("$0 mop", "$0 mops", 2), "$0 mops", "default multiple");
    assert.equal(cockpit.ngettext("explain", "$0 mop", "$0 mops", 1), "$0 mop", "default one context");
    assert.equal(cockpit.ngettext("explain", "$0 mop", "$0 mops", 2), "$0 mops", "default multiple context");
});

QUnit.test("ngettext complex", function() {
    cockpit.locale(null); /* clear it */
    cockpit.locale(ru);
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 0), "$0 бит", "zero things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 1), "$0 бит", "one thing");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 5), "$0 бит", "multiple things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 23), "$0 бита", "genitive singular");
    assert.equal(cockpit.ngettext("$0 mop", "$0 mops", 1), "$0 mop", "default one");
    assert.equal(cockpit.ngettext("$0 mop", "$0 mops", 2), "$0 mops", "default multiple");
});

QUnit.start();
