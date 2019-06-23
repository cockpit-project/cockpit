import $ from "jquery";
import cockpit from "cockpit";
import { mustache } from "mustache";

const _ = cockpit.gettext;
var C_ = cockpit.gettext;

$(function () {
    cockpit.translate();

    var text = _("Empty");
    $("#underscore-empty").text(text);

    text = _("verb", "Empty");
    $("#underscore-context-empty").text(text);

    text = C_("verb", "Empty");
    $("#cunderscore-context-empty").text(text);

    text = cockpit.gettext("Control");
    $("#gettext-control").text(text);

    text = cockpit.gettext("key", "Control");
    $("#gettext-context-control").text(text);

    text = cockpit.ngettext("$0 disk is missing", "$0 disks are missing", 1);
    $("#ngettext-disks-1").text(text);

    text = cockpit.ngettext("$0 disk is missing", "$0 disks are missing", 2);
    $("#ngettext-disks-2").text(text);

    text = cockpit.ngettext("disk-non-rotational", "$0 disk is missing", "$0 disks are missing", 1);
    $("#ngettext-context-disks-1").text(text);

    text = cockpit.ngettext("disk-non-rotational", "$0 disk is missing", "$0 disks are missing", 2);
    $("#ngettext-context-disks-2").text(text);

    var template = $("#mustache-input").text();
    var output = mustache.render(template);
    $("#mustache-output").empty()
            .append(output);

    cockpit.transport.wait(function() {
        $("body").show();
    });
});
