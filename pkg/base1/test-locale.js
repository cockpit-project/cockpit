import cockpit from "cockpit";
import QUnit from "qunit-tests";

const pig_latin = {
    "": {
        language: "pig",
        "plural-forms": function(n) {
            const plural = (n != 1);
            return plural;
        }
    },
    Control: [null, "Ontrolcay"],
    User: [null, "Useray"],
    Waiting: [null, "Aitingway"],
    "$0 disk is missing": [
        "$0 disk is missing",
        "$0 isksbay is issingmay",
        "$0 isksbay are issingmay"
    ],
    "key\u0004Control": [null, "OntrolCAY"],
    "disk-non-rotational\u0004$0 disk is missing": [
        "disk-non-rotational\u0004$0 disk is missing",
        "$0 isksBAY is issingMAY",
        "$0 isksBAY are issingMAY"
    ]
};

const ru = {
    "": {
        language: "ru",
        "plural-forms":
        function(n) {
            const plural = (n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
            return plural;
        }
    },
    "$0 bit": ["$0 bits", "$0 бит", "$0 бита", "$0 бит"]
};

const zh_CN = {
    "": {
        language: "zh_CN",
        "language-direction": "ltr",
        "plural-forms": (n) => 0,
    },
    "$0 important hit": [null, "$0 次命中（含关键命中）"],
};

QUnit.test("public api", function (assert) {
    assert.equal(typeof cockpit.locale, "function", "cockpit.locale is a function");
});

QUnit.test("gettext", function (assert) {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    assert.equal(cockpit.language, "pig", "correct lang");
    assert.equal(cockpit.gettext("Control"), "Ontrolcay", "returned translation");
    assert.equal(cockpit.gettext("key", "Control"), "OntrolCAY", "with context");
    assert.equal(cockpit.gettext("Empty"), "Empty", "english default");
    assert.equal(cockpit.gettext("verb", "Empty"), "Empty", "english default context");
});

QUnit.test("underscore", function (assert) {
    cockpit.locale(null); /* clear it */
    cockpit.locale(pig_latin);
    const _ = cockpit.gettext;
    const C_ = _;
    assert.equal(_("Control"), "Ontrolcay", "returned translation");
    assert.equal(_("Empty"), "Empty", "english default");
    assert.equal(C_("key", "Control"), "OntrolCAY", "with context");
    assert.equal(C_("verb", "Empty"), "Empty", "with context");
});

QUnit.test("ngettext simple", function (assert) {
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

QUnit.test("ngettext complex", function (assert) {
    cockpit.locale(null); /* clear it */
    cockpit.locale(ru);
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 0), "$0 бит", "ru, zero things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 1), "$0 бит", "ru, one thing");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 5), "$0 бит", "ru, multiple things");
    assert.equal(cockpit.ngettext("$0 bit", "$0 bits", 23), "$0 бита", "ru, genitive singular");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 1), "$0 byte", "ru, default one");
    assert.equal(cockpit.ngettext("$0 byte", "$0 bytes", 2), "$0 bytes", "ru, default multiple");

    cockpit.locale(null); /* clear it */
    cockpit.locale(zh_CN);
    [0, 1, 2].forEach(i =>
        assert.equal(cockpit.ngettext("$0 important hit", "$0 XXX", i), "$0 次命中（含关键命中）", `zh_CN, ${i} things`)
    );
});

QUnit.test("translate document", function (assert) {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    document.getElementById('translations').innerHTML = "<span translate id='translatable-html'>Control</span>";

    cockpit.translate();
    const t = document.getElementById('translatable-html');
    assert.equal(t.innerHTML, "Ontrolcay", "translate element");
    assert.equal(t.hasAttribute("translate"), false, "translate element attribute removed");
});

QUnit.test("translate elements", function (assert) {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    const div1 = document.createElement('div');
    div1.innerHTML = "<span translate id='translatable-html'>Control</span>" +
                     "<span translate translate-context='key' id='translatable-context-html'>Control</span>";

    const div2 = document.createElement('div');
    div2.setAttribute('translate', 'translate');
    div2.innerHTML = 'User';

    const div3 = document.createElement('div');
    div3.innerHTML = "<span><i translate>Waiting</i></span>";

    const t = document.getElementById('translations');
    t.appendChild(div1);
    t.appendChild(div2);
    t.appendChild(div3);

    cockpit.translate(div1, div2, div3);
    const thtml = document.getElementById('translatable-html');
    assert.equal(thtml.innerHTML, "Ontrolcay", "translate element");
    assert.equal(thtml.hasAttribute("translate"), false, "translate element attribute removed");
    const tconhtml = document.getElementById('translatable-context-html');
    assert.equal(tconhtml.innerHTML, "OntrolCAY", "translate context");
    assert.equal(tconhtml.hasAttribute("translate"), false, "translate context attribute removed");
});

QUnit.test("translate array", function (assert) {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    const div1 = document.createElement('div');
    div1.innerHTML = "<span translate id='translatable-html'>Control</span>" +
                     "<span translate translate-context='key' id='translatable-context-html'>Control</span>";

    const div2 = document.createElement('div');
    div2.setAttribute('translate', 'translate');
    div2.innerHTML = 'User';

    const div3 = document.createElement('div');
    div3.innerHTML = "<span><i translate>Waiting</i></span>";

    const t = document.getElementById('translations');
    t.appendChild(div1);
    t.appendChild(div2);
    t.appendChild(div3);

    cockpit.translate(document.querySelector("#translations div"));

    const thtml = document.getElementById('translatable-html');
    assert.equal(thtml.innerHTML, "Ontrolcay", "translate element");
    assert.equal(thtml.hasAttribute("translate"), false, "translate element attribute removed");
    const tconhtml = document.getElementById('translatable-context-html');
    assert.equal(tconhtml.innerHTML, "OntrolCAY", "translate context");
    assert.equal(tconhtml.hasAttribute("translate"), false, "translate context attribute removed");
});

QUnit.test("translate glade", function (assert) {
    cockpit.locale(null);
    cockpit.locale(pig_latin);

    const div = document.createElement('div');
    div.innerHTML = "<span translate='yes' id='translatable-glade'>Control</span>" +
                    "<span translate='yes' context='key' id='translatable-glade-context'>Control</span>";

    document.getElementById('translations').appendChild(div);

    cockpit.translate(div);

    const t = document.getElementById('translatable-glade');
    assert.equal(t.innerHTML, "Ontrolcay", "translatable element");
    assert.equal(t.hasAttribute("translate"), false, "translate element removed");
    const tcon = document.getElementById('translatable-glade-context');
    assert.equal(tcon.innerHTML, "OntrolCAY", "translate context");
    assert.equal(tcon.hasAttribute("translate"), false, "translate context attribute removed");
});

function init() {
    /* Area for translate tests to play in */
    const div = document.createElement('div');
    div.setAttribute('id', 'translations');
    div.setAttribute('hidden', 'hidden');
    document.querySelector("body").appendChild(div);

    /* Ready to go */
    QUnit.start();
}

if (document.readyState == "loading")
    document.addEventListener("DOMContentLoaded", init);
else
    init();
