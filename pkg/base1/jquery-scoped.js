(function(jq) {
    "use strict";
    jq.scoped = function scoped(/* ... */) {
        var scope;

        function init(/* ... */) {
            return jq.fn.init.apply(this, arguments);
        }

        function jQueryScoped(selector, context) {
            return new init(selector, context || scope);
        }

        jq.extend(jQueryScoped, jq);

        var prototypes = [ { }, jq.fn ];
        prototypes.push.apply(prototypes, Array.prototype.slice.call(arguments, 1));
        jQueryScoped.fn = jQueryScoped.prototype = jq.extend.apply(jq, prototypes);
        jQueryScoped.fn.constructor = jQueryScoped.prototype.constructor = jQueryScoped;
        init.prototype = jQueryScoped.fn;

        scope = jQueryScoped(arguments[0]);
        scope.constructor = jQueryScoped;

        return jQueryScoped;
    };
}(jQuery));
