(function ($) {
    "use strict";

    function sync(output, input, depth) {
        var na, nb, a, b, i;
        var attrs, attr, seen;

        if (depth > 0) {
            if (output.nodeType != input.nodeType ||
                (output.nodeType != 1 && output.nodeType != 3)) {
                output.parentNode.replaceChild(input.parentNode.removeChild(input), output);
                return;

            } else if (output.nodeType == 3) {
                if (output.nodeValue != input.nodeValue)
                    output.nodeValue = input.nodeValue;
                return;
            }
        }

        if (output.nodeType == 1) {

            /* Sync attributes */
            if (depth > 0) {
                seen = { };
                attrs = output.attributes;
                for (i = attrs.length - 1; i >= 0; i--)
                    seen[attrs[i].name] = attrs[i].value;
                for (i = input.attributes.length - 1; i >= 0; i--) {
                    attr = input.attributes[i];
                    if (seen[attr.name] !== attr.value)
                        output.setAttribute(attr.name, attr.value);
                    delete seen[attr.name];
                }
                for (i in seen)
                    output.removeAttribute(i);
            }

            /* Sync children */
            na = output.firstChild;
            nb = input.firstChild;
            for(;;) {
                a = na;
                b = nb;
                while (a && a.nodeType != 1 && a.nodeType != 3)
                    a = a.nextSibling;
                while (b && b.nodeType != 1 && b.nodeType != 3)
                    b = b.nextSibling;
                if (!a && !b) {
                    break;
                } else if (!a) {
                    na = null;
                    nb = b.nextSibling;
                    output.appendChild(input.removeChild(b));
                } else if (!b) {
                    na = a.nextSibling;
                    nb = null;
                    output.removeChild(a);
                } else {
                    na = a.nextSibling;
                    nb = b.nextSibling;
                    sync(a, b, (depth || 0) + 1);
                }
            }
        }
    }

    $.fn.amend = function amend(data, options) {
        this.each(function() {
            var el = $("<div>").html(data);
            sync(this, el[0], 0);
        });
        return this;
    };

}(jQuery));
