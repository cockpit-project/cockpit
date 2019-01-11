'use strict'

module.exports = {
    rules: {
        "no-cockpit-all": {
            create: function(context) {
                return {
                    MemberExpression(node) {
                        if (node.object.name === 'cockpit' && node.property.name === 'all')
                            context.report(node, 'Use Promise.all() instead of cockpit.all()');
                    }
                };
            }
        }
    }
};
