define('translated', function() {
    var module = { };

    var language = window.localStorage.getItem("cockpit.lang");
    if (!language)
        language = window.navigator.userLanguage || window.navigator.language || "en";
    language = language.split("-")[0];

    module.load = function load(name, parentRequire, onload, config) {
        require([name + "." + language], function(value) {
            onload(value);
        });
    };

    return module;
});
