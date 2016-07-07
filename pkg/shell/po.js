/* global cockpit */
(function (root, data) {
    if (typeof define === 'function' && define.amd) {
        define(data);
    } else if (typeof cockpit === 'object') {
        cockpit.locale(data);
    } else {
        root.po = data;
    }
}(this, {"": { "language": "en" }}));
