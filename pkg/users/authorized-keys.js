(function() {
    var cockpit = require("cockpit");

    var lister = require("raw!./ssh-list-public-keys.sh");
    var adder = require("raw!./ssh-add-public-key.sh");

    var _ = cockpit.gettext;

    function AuthorizedKeys (user_name, home_dir) {
        var self = this;
        var dir = home_dir + "/.ssh";
        var filename = dir + "/authorized_keys";
        var file = null;
        var watch = null;
        var last_tag = null;

        cockpit.event_target(self);

        self.keys = [];
        self.state = "loading";

        function process_failure (ex) {
            self.keys = [];
            if (ex.problem == "access-denied") {
                self.state = ex.problem;
            } else if (ex.problem == "not-found") {
                self.state = "ready";
            } else {
                self.state = "failed";
                console.warn("Error proccessing authentication keys: "+ ex);
            }
            self.dispatchEvent("changed");
        }

        function update_keys(keys, tag) {
            if (tag !== last_tag)
                return;

            self.keys = keys;
            self.state = "ready";
            self.dispatchEvent("changed");
        }

        /*
         * Splits up a strings like:
         *
         * 2048 SHA256:AAAAB3NzaC1yc2EAAAADAQ Comment Here (RSA)
         * 2048 SHA256:AAAAB3NzaC1yc2EAAAADAQ (RSA)
         */
        var PUBKEY_RE = /^(\S+)\s+(\S+)\s+(.*)\((\S+)\)$/;

        function parse_pubkeys(input) {
            var df = cockpit.defer();
            var keys = [];

            cockpit.script(lister)
                .input(input + "\n")
                .done(function(output) {
                    var match, obj, i, line, lines = output.split("\n");
                    for (i = 0; i + 1 < lines.length; i += 2) {
                        line = lines[i];
                        obj = { raw: lines[i + 1] };
                        keys.push(obj);
                        match = lines[i].trim().match(PUBKEY_RE);
                        obj.valid = !!match && !!obj.raw;
                        if (match) {
                            obj.size = match[1];
                            obj.fp = match[2];
                            obj.comment = match[3].trim();
                            if (obj.comment == "authorized_keys" || obj.comment == "no comment")
                                obj.comment = null;
                            obj.algorithm = match[4];

                            /* Old ssh-keygen versions need us to find the comment ourselves */
                            if (!obj.comment && obj.raw)
                                obj.comment = obj.raw.split(" ").splice(0, 2).join(" ") || null;
                        }
                    }
                })
                .always(function() {
                    df.resolve(keys);
                });

            return df.promise();
        }

        function parse_keys(content, tag, ex) {
            last_tag = tag;

            if (ex)
                return process_failure(ex);

            if (!content)
                return update_keys([ ], tag);

            parse_pubkeys(content)
                .done(function(keys) {
                    update_keys(keys, tag);
                });
        }

        self.add_key = function(key) {
            var df = cockpit.defer();
            df.notify(_("Validating key"));
            parse_pubkeys(key)
                .done(function(keys) {
                    var obj = keys[0];
                    if (obj && obj.valid) {
                        df.notify(_("Adding key"));
                        cockpit.script(adder, [ user_name, home_dir ], { superuser: "try", err: "message" })
                            .input(obj.raw + "\n")
                            .done(function() {
                                df.resolve();
                            })
                            .fail(function(ex) {
                                df.reject(_("Error saving authorized keys: ") + ex);
                            });
                    } else {
                        df.reject(_("The key you provided was not valid."));
                    }
                });

            return df.promise();
        };

        self.remove_key = function(key) {
            return file.modify(function(content) {
                var i;
                var lines = null;
                var new_lines = [];

                if (!content)
                    return "";

                new_lines = [];
                lines = content.trim().split('\n');
                for (i = 0; i < lines.length; i++) {
                    if (lines[i] === key)
                        key = undefined;
                    else
                        new_lines.push(lines[i]);
                }
                return new_lines.join("\n");
            });
        };

        self.close = function() {
            if (watch)
                watch.remove();

            if (file)
                file.close();
        };

        file = cockpit.file(filename, {'superuser': 'try'});
        watch = file.watch(parse_keys);
    }

    module.exports = {
        instance: function instance(user_name, home_dir) {
            return new AuthorizedKeys(user_name, home_dir);
        }
    };
}());
