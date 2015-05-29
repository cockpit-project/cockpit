define(["exports",
    "jquery",
    "base1/cockpit",
    "ostree/ember",
    "ostree/models",
    "ostree/notifications",
    "ostree/software-updates",
], function (exports, $, cockpit, Ember, models, notifications, software_updates) {
 "use strict";

    // Super simple resolver that checks our models
    // before delegating up the stack.
    var Resolver = Ember.DefaultResolver.extend({
        resolve: function(fullName) {
            var parsedName = this.parseName(fullName);
            this.useRouterNaming (parsedName);
            var className = Ember.String.classify(parsedName.name) + Ember.String.classify(parsedName.type);

            var result = null;
            var mods = [software_updates, models, notifications];
            for (var i = 0; i < mods.length; i++) {
                var mod = mods[i];
                if (mod[className]) {
                    result = mod[className];
                    break;
                }
            }

            if (result === null)
                result = this._super(fullName);

            return result;
        }
    });

    var App = Ember.Application.create({
        "name": "ostree",
        "rootElement": "#ostree-software-update",
        "rootURL": "/ostree/",
        "Resolver": Resolver
    });

    App.deferReadiness();

    return App;
});
