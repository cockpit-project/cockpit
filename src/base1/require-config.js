/* This config is built as a prefix to require.js */
var require = {
    baseUrl: "../",
    waitSeconds: 30,
    skipDataMain: true,
    paths: {
        "jquery": "base1/jquery",
    }
};

/* We skip data-main above and handle it ourselves here */
(function() {
    var script = document.scripts[document.scripts.length - 1];
    var main = script.getAttribute("data-main");
    if (main) {
        document.addEventListener("DOMContentLoaded", function() {
            require([main], function() { });
        });
    }
}());
