/* global $, cockpit, QUnit */

/* To help with future migration */
var assert = QUnit;

var pig_latin = {
    "": { "language": "pig", "plural-forms": function(n) {
        var nplurals, plural; nplurals=2; plural=(n != 1); return plural;
    } },
    "Control": [ null, "Ontrolcay" ],
    "User": [ null, "Useray" ],
    "Waiting": [ null, "Aitingway" ],
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

QUnit.test("translate document", function() {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    $("#translations")
        .empty()
        .append("<span translate id='translatable-html'>Control</span>");

    cockpit.translate();
    assert.equal($("#translatable-html").text(), "Ontrolcay", "translate element");
    assert.strictEqual($("#translatable-html").attr("translate"), undefined, "translate element attribute removed");
});

QUnit.test("translate elements", function() {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    var div1 = $("<div><span translate id='translatable-html'>Control</span>" +
                 "<span translate translate-context='key' id='translatable-context-html'>Control</span></div>");

    var div2 = $("<div translate>User</div>");

    var div3 = $("<div><span><i translate>Waiting</i></span></div>");

    $("#translations")
        .empty()
        .append(div1, div2, div3);

    cockpit.translate(div1[0], div2[0], div3[0]);
    assert.equal($("#translatable-html").text(), "Ontrolcay", "translate element");
    assert.strictEqual($("#translatable-html").attr("translate"), undefined, "translate element removed");
    assert.equal($("#translatable-context-html").text(), "OntrolCAY", "translate context");
    assert.strictEqual($("#translatable-context-html").attr("translate"), undefined, "translate context attribute removed");
});

QUnit.test("translate array", function() {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    var div1 = $("<div><span translate id='translatable-html'>Control</span>" +
                 "<span translate translate-context='key' id='translatable-context-html'>Control</span></div>");

    var div2 = $("<div translate>User</div>");

    var div3 = $("<div><span><i translate>Waiting</i></span></div>");

    $("#translations")
        .empty()
        .append(div1, div2, div3);

    cockpit.translate($("#translations div"));
    assert.equal($("#translatable-html").text(), "Ontrolcay", "translate element");
    assert.strictEqual($("#translatable-html").attr("translate"), undefined, "translate element no attribute");
    assert.equal($("#translatable-context-html").text(), "OntrolCAY", "translate context");
    assert.strictEqual($("#translatable-context-html").attr("translate"), undefined, "translate context attribute removed");
});

QUnit.test("translate glade", function() {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    var div = $("<div><span translatable='yes' id='translatable-glade'>Control</span>" +
                "<span translatable='yes' context='key' id='translatable-glade-context'>Control</span></div>");

    $("#translations").empty().append(div);

    cockpit.translate(div);
    assert.equal($("#translatable-glade").text(), "Ontrolcay", "translatable element");
    assert.strictEqual($("#translatable-glade").attr("translatable"), undefined, "translatable element removed");
    assert.equal($("#translatable-glade-context").text(), "OntrolCAY", "translatable context");
    assert.strictEqual($("#translatable-glade-context").attr("translatable"), undefined, "translatable context attribute removed");
});

QUnit.test("translate attributes", function() {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    var div = $("<div><span translate='title' title='Control' id='translatable-attribute'>Waiting</span>" +
                "<div><span translate='title' translate-context='key' title='Control'" +
                    "id='translatable-attribute-context'>Waiting</span>" +
                "<span translate='yes title' title='User' id='translatable-attribute-both'>Waiting</span></div>" +
                "<span translate='  yes title ' title='User'" +
                    "id='translatable-attribute-syntax'>Waiting</span></div>");

    $("#translations").empty().append(div);

    cockpit.translate(div);
    assert.equal($("#translatable-attribute").attr("title"), "Ontrolcay", "translate attribute");
    assert.equal($("#translatable-attribute").text(), "Waiting", "translate attribute doesn't affect text");
    assert.strictEqual($("#translatable-attribute").attr("translate"), undefined, "translate removed");
    assert.equal($("#translatable-attribute-context").attr("title"), "OntrolCAY", "translatable element");
    assert.equal($("#translatable-attribute-context").text(), "Waiting", "translate context doesn't affect text");
    assert.strictEqual($("#translatable-attribute-context").attr("translate"), undefined, "translate removed");
    assert.equal($("#translatable-attribute-both").attr("title"), "Useray", "translate attribute both");
    assert.equal($("#translatable-attribute-both").text(), "Aitingway", "translate text both");
    assert.strictEqual($("#translatable-attribute-both").attr("translate"), undefined, "translate removed");
    assert.equal($("#translatable-attribute-syntax").attr("title"), "Useray", "translate syntax both");
    assert.equal($("#translatable-attribute-syntax").text(), "Aitingway", "translate syntax both");
    assert.strictEqual($("#translatable-attribute-syntax").attr("translate"), undefined, "translate removed");
});

$(function() {

    /* Area for translate tests to play in */
    $("body").append("<div id='translations' hidden>");

    /* Ready to go */
    QUnit.start();
});
