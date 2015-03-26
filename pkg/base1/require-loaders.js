define('translated', function() {
    var module = { };

    var language = window.localStorage.getItem("cockpit.lang");
    if (!language)
        language = window.navigator.userLanguage || window.navigator.language || "en";
    language = language.split("-")[0];

    module.load = function load(name, parentRequire, onload, config) {
        parentRequire([name + "." + language], function(value) {
            onload(value);
        });
    };

    return module;
});
define('data', function() {
    var module = { };

    module.load = function load(name, parentRequire, onload, config) {

        /* Predefined in the bundle */
        var predef = name + "_text";
        if (parentRequire.specified(predef)) {
            parentRequire([predef], function(value) {
                onload(value);
            });
            return;
        }

        var xhr = new XMLHttpRequest();
        xhr.open("GET", parentRequire.toUrl(name), true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            } else if (xhr.status == 200) {
                onload(xhr.responseText);
            } else if (xhr.statusText) {
                onload.error(new Error(xhr.statusText));
            } else {
                onload.error(new Error(xhr.status + " error"));
            }
        };
        xhr.send();
    };

    return module;
});
