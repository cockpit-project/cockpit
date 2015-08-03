define([
    "jquery",
    "base1/cockpit"
], function($, cockpit) {
    var module = { };
    var _ = cockpit.gettext;

    function AuthorizedKeys (user_name, home_dir) {
        var self = this;
        var dir = home_dir + "/.ssh";
        var filename = dir + "/authorized_keys";
        var file = null;
        var watch = null;
        var last_tag = null;

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
            $(self).triggerHandler("changed");
        }

        function fix_permissions() {
            // fix permissions, in case we created the file as root
            // we can ignore the group, since permissions are set to 600
            cockpit.spawn(["chown", "-R", user_name, dir],
                           {'superuser': 'try'})
                .fail(function (ex) {
                    console.warn("Error setting authorized keys owner: " + ex);
                 });
            cockpit.spawn(["chmod", "600", filename],
                           {'superuser': 'try'})
                .fail(function (ex) {
                    console.warn("Error setting authorized keys permissions: " + ex);
                 });
        }

        function update_keys(keys, tag) {
            if (tag !== last_tag)
                return;

            self.keys = keys;
            self.state = "ready";
            $(self).triggerHandler("changed");
        }

        function create_key_object(key_string, tmp_file, tmp_file_path) {
            var df = $.Deferred();
            var obj = {
                "raw": key_string.trim(),
                "valid": false
            };

            tmp_file.replace(obj.raw)
                .done(function() {
                    cockpit.spawn(["ssh-keygen", "-l", "-f", tmp_file_path])
                        .done(function(data) {
                            var parts = data.split(" ");
                            obj.size = parts[0];
                            obj.fp = parts[1];
                            obj.valid = true;

                            /* if there is no comment, the filename
                             * gets used, we don't want that
                             */
                            obj.comment = parts.slice(2).join(' ');
                            obj.comment = obj.comment.replace(tmp_file_path, '').trim();
                        })
                        .always(function () {
                            df.resolve(obj);
                        });
                })
                .fail(function(ex) {
                    df.reject(ex);
                });
            return df;
        }

        function parse_keys(content, tag, ex) {
            var processed = 0;
            var previous = { };
            var seen = { };
            var keys = [ ];
            var tmp_file;
            var tmp_file_path;
            var lines = null;

            last_tag = tag;

            if (ex)
                return process_failure(ex);

            if (content && content.trim())
                lines = content.trim().split('\n');

            if (!lines)
                return update_keys(keys, tag);

            var i;
            for (i = 0; i < self.keys.length; i++) {
                previous[self.keys[i].raw] = self.keys[i];
            }

            function done_callback (obj) {
                processed++;

                if (!seen[obj.raw]) {
                    seen[obj.raw] = true;
                    keys.push(obj);
                }

                if (processed === lines.length) {
                    tmp_file.close();
                    cockpit.spawn(["rm", tmp_file_path]);
                    update_keys(keys, tag);
                } else {
                    process_next();
                }
            }

            function process_next() {
                var raw = lines[processed];
                if (previous[raw] === undefined) {
                    create_key_object (raw, tmp_file, tmp_file_path)
                        .done(done_callback)
                        .fail(process_failure);
                } else {
                    done_callback(previous[raw]);
                }
            }

            cockpit.spawn(["mktemp"])
                .done(function(result) {
                    tmp_file_path = result.trim();
                    tmp_file = cockpit.file(tmp_file_path);
                    process_next();
                })
                .fail(process_failure);
        }

        self.add_key = function(key) {
            var df = $.Deferred();
            key = key.trim();
            cockpit.spawn(["mktemp"])
                .done(function(result) {
                    var tmp_file_path = result.trim();
                    var tmp_file = cockpit.file(tmp_file_path);

                    create_key_object (key, tmp_file, tmp_file_path)
                        .done (function (obj) {
                            if (obj.valid) {
                                df.notify (_("Adding key"));
                                cockpit.spawn(["mkdir", "-p", dir], {'superuser': 'try'})
                                    .always(function () {
                                        file.modify(function (content) {
                                                if (content && content.trim())
                                                    return content.trim() + "\n" + key;
                                                else
                                                    return key;
                                            })
                                            .done(function (ex) {
                                                fix_permissions();
                                                df.resolve();
                                            })
                                            .fail(function (ex) {
                                                df.reject(_("Error saving authorized keys: ") + ex);
                                            });
                                    });
                            } else {
                                df.reject(_("The key you provided was not valid."));
                            }
                        })
                        .fail(function (ex) {
                            df.reject(_("Error validating key: ") + ex);
                        });
                })
                .fail(function(ex) {
                    df.reject(_("Error validating key: ") + ex);
                });
            df.notify (_("Validating key"));
            return df;
        };

        self.remove_key = function(key) {
            return file.modify(function (content) {
                var i;
                var lines = null;
                var new_lines = [];

                if (!content)
                    return "";

                new_lines = [];
                lines = content.trim().split('\n');
                for (i = 0; i < lines.length; i++) {
                    if (lines[i] != key)
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

    module.instance = function instance(user_name, home_dir) {
        return new AuthorizedKeys(user_name, home_dir);
    };

    return module;
});
