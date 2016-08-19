(function (root, data) {
    if (typeof define === 'function' && define.amd) {
        define(data);
    } else if (typeof cockpit === 'object') {
        cockpit.locale(data);
    } else {
        root.po = data;
    }
}(this, {
    "": { "language": "de", "plural-forms": function(n) { var nplural, plural; nplurals=2; plural=(n != 1); return plural; } },
    "Translation": [ null, "Übersetzung" ],
    "Networking": [ null, "Vernetzung" ],
    "reverse\u0004Translation": [ null, "gnuztesrebÜ" ],
});
