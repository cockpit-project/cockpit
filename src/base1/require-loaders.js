(function() {
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
            if (xhr.readyState == 4) {
                if (xhr.status == 200) {
                    onload(xhr.responseText);
                } else if (xhr.statusText) {
                    onload.error(new Error(name + ": " + xhr.statusText));
                } else {
                    onload.error(new Error(name + ": " + xhr.status + " error"));
                }
            }
        };
        xhr.overrideMimeType("text/plain");
        xhr.send();
    };

    /* Define this under two names, one of which is more webpack compatible */
    define('raw', module); // eslint-disable-line no-undef
    define('data', module); // eslint-disable-line no-undef
}());
