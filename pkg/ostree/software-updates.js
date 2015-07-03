define(["exports",
        "jquery",
        "base1/cockpit",
        "ostree/ember",
        "ostree/models",
        "ostree/notifications",
], function (exports, $, cockpit, Ember, models, notifications) {
 "use strict";

    var _ = cockpit.gettext;

    var Router = Ember.Router.extend({});
    Router.map(function() {
        this.route('index', {path: '/'}, function () {
            this.route('error');
        });
        this.route('catchall', {path: '*wildcard'});
    });
    exports.MainRouter = Router;

    exports.CatchallRoute = Ember.Route.extend({
        setupController: function () {
            this.replaceWith('index');
        },
    });

    exports.ApplicationRoute = Ember.Route.extend({
        actions: {
            reload: function (item) {
                this.replaceWith('index');
            },
            errors: function (er) {
                cockpit.oops();
            },
        }
    });

    exports.IndexRoute = Ember.Route.extend({
        templateName : 'index',
        model: function() {
            return models.TargetManager.createPromise();
        },

        setupController: function(controller, model) {
            controller.set('model', model);
        },

        actions: {
            openModal: function(modalName) {
                var self = this;
                var controller = this.controllerFor(modalName);
                var manager = this.modelFor('index');

                manager.getValidTarget(controller.targetName)
                    .then(function (model) {
                        if (!model)
                            return;

                        controller.set('manager', manager);
                        controller.set('model', model);
                        controller.set('visible', true);

                        self.render(modalName, {
                            controller: controller,
                            into: 'application',
                            outlet: 'modal'
                        });
                    })
                    .catch(function(ex) {
                        notifications.Manager.push({
                            type: 'danger',
                            msg: cockpit.format(_("Error: $0"),
                                                cockpit.message(ex))
                        });
                    });
            },

            closeModal: function(modalName) {
                return this.disconnectOutlet({
                    outlet: 'modal',
                    parentView: 'application'
                });
            },
            error: function(error) {
                if (error.command == "close") {
                    var text = "";
                    if (error.problem === "access-denied") {
                        text = _("Not authorized to update software on this system");
                    } else {
                        text = _("Unable to communicate with OSTree.");
                    }
                    notifications.Manager.content.clear();
                    notifications.Manager.push({
                            type: 'danger',
                            dismissable: true,
                            msg: text,
                            dismissClass: "btn btn-primary",
                            dismissAction: true,
                            dismissText: _("Retry"),
                            duration: 0,
                    });
                    this.intermediateTransitionTo('error', 'dbus-error');
                    return false;
                }
                return true;
            }
        }
    });

    /* Controllers */
    exports.IndexController = Ember.Controller.extend({
        checkingForUpdates: false,

        packages: [],
        packagesChecked: null,

        loadPackages: function () {
            // TODO, use dbus?
            var self = this;
            self.set('packagesChecked', false);
            Ember.run(function () {
                cockpit.spawn(['rpm', '-qa', '--queryformat', "%{NAME},%{VERSION}\n"]).
                    done(function (result) {
                        var data = [];
                        result.split("\n").forEach(function (v) {
                            var parts = v.split(',');
                            if (parts.length == 2 && parts[0]) {
                                data.push({
                                    'name': parts[0],
                                    'version': parts[1]
                                });
                            }
                        });
                        self.set('packages', data);
                    }).
                    fail(function (ex) {
                        notifications.Manager.push({
                            type: 'danger',
                            msg: cockpit.format(_("Error getting installed packages: $0"),
                                                cockpit.message(ex))
                        });
                    }).
                    always(function () {
                            self.set('packagesChecked', true);
                    });
            });
        }.observes('model.bootedTarget.Checksum'),

        actions: {
            checkForUpdates: function() {
                var self = this;
                var target = self.get('model.upgradeTarget');

                self.set('checkingForUpdates', true);
                var promise = target.callAndWaitForComplete(self.get('model'), "PullRpmDb")
                    .catch(function (ex) {
                        notifications.Manager.push({
                            type: 'danger',
                            msg: ex
                        });
                    }).finally(function () {
                        self.set('checkingForUpdates', false);
                    });
            },
        },

        sortedPackages: function() {
            return Ember.ArrayProxy.createWithMixins(Ember.SortableMixin, {
                sortProperties: ['name'],
                content: this.get('packages')
            });
        }.property('packages'),

        actionsDisabled: function () {
            if (this.get('model.UpdateRunning') || this.get('checkingForUpdates'))
                return 'disabled';
            return '';
        }.property('checkingForUpdates', 'model.UpdateRunning'),

        showSpinner: function () {
            return this.get('model.UpdateRunning') || this.get('checkingForUpdates');
        }.property('checkingForUpdates', 'model.UpdateRunning'),

        isDirty: function () {
            if (this.get('model.defaultTarget')) {
                return this.get('model.defaultTarget.Checksum') != this.get('model.bootedTarget.Checksum');
            } else {
                return false;
            }
        }.property('model.defaultTarget.Checksum', 'model.bootedTarget.Checksum'),

        hasUpdates: function () {
            if (this.get('model.upgradeTarget')) {
                return this.get('model.upgradeTarget.Checksum') != this.get('model.bootedTarget.Checksum');
            } else {
                return false;
            }
        }.property('model.bootedTarget.Checksum', 'model.upgradeTarget.Checksum'),
    });

    exports.DiffTableComponent = Ember.Component.extend({
        tagName: 'div',
        diffs: null,
        diffSummary: function() {
            var lines = [];
            var adds = 0;
            var removes = 0;
            var rollbacks = 0;
            var upgrades = 0;

            var diffs = this.get('diffs');
            if (diffs) {
                for (var i = 0; i < diffs.length; i++) {
                    if (diffs[i].type === 0)
                        adds++;
                    else if (diffs[i].type === 1)
                        removes++;
                    else if (diffs[i].type == 2)
                        upgrades++;
                    else
                        rollbacks++;
                }
            }

            if (adds)
                lines.push(cockpit.format(cockpit.ngettext("$0 addition", "$0 additions", adds), adds));
            if (removes)
                lines.push(cockpit.format(cockpit.ngettext("$0 removal", "$0 removals", removes), removes));
            if (upgrades)
                lines.push(cockpit.format(cockpit.ngettext("$0 update", "$0 updates", upgrades), upgrades));
            if (rollbacks)
                lines.push(cockpit.format(cockpit.ngettext("$0 rollbacks", "$0 rollbacks", rollbacks), rollbacks));

            if (lines.length > 0)
                return cockpit.format(_("This brings $0"), lines.join(', '));
            else
                return _("This deployment contains the same packages as your currently booted system.");

        }.property('diffs.@each.type'),
    });

    var Deploy = Ember.Mixin.create({
        diffs: null,
        diffsChecked: false,
        running: false,
        visible: false,

        progressMessage: function () {
            var msg = "";
            var runType = this.get("manager.UpdateRunning");

            if (runType == 'rpm-pull')
                msg = _("Checking for updates");
            else if (runType == 'rollback')
                msg = _("Running rollback");
            else if (runType)
                msg = _("Running upgrade");

            if (this.get("model.progressMessage"))
                msg = this.get("model.progressMessage");

            return msg;
        }.property('manager.UpdateRunning', 'model.progressMessage'),

        title: function() {
            return cockpit.format(this.titleFormat, this.get('model.releaseName'));
        }.property('model.releaseName'),

        actionsDisabled: function () {
            if (this.get('running') || this.get('manager.UpdateRunning'))
                return 'disabled';
            return '';
        }.property('running', 'manager.UpdateRunning'),

        loadDiffs: function () {
            var self = this;
            var model = self.get("model");
            self.set('diffsChecked', false);
            if (self.get('model.Checksum')) {
                model.getRpmDiff().
                    then(function (result) {
                        self.set('diffs', result);
                    }).
                    catch(function (ex) {
                        self.errorAndClose(_("Couldn't get list of changed packages."));
                    }).
                    finally(function () {
                        self.set('diffsChecked', true);
                    });
            }
        }.observes('model.Checksum'),

        updateRunning: function () {
            if (!this.get('visible'))
                return;

            var runType = this.get('manager.UpdateRunning');
            if (runType && runType != "rpm-pull" && !this.get('running'))
                this.close();
        }.observes('manager.UpdateRunning'),

        deploymentChanged: function () {
            if (!this.get('running')) {
                this.close();
            }
        }.observes('manager.DefaultDeployment'),

        modelChanged: function () {
            this.close();
        }.observes('model.listenID'),

        errorAndClose: function(ex) {
            if (this.get('visible')) {
                notifications.Manager.push({
                    type: 'danger',
                    msg: cockpit.format(this.errorFormat, ex)
                });
            }
            this.close();
        },

        close: function() {
            this.set('visible', false);
            return this.send('closeModal');
        },

        doAction: function(methodName, methodArgs, successMessage) {
            var self = this;
            var manager = self.get('manager');
            var model = self.get('model');

            self.set('running', true);
            var promise = model.callAndWaitForComplete(manager, methodName, methodArgs);
            promise.then(function (result) {
                    notifications.Manager.push({type: 'success', msg: successMessage});
                    self.close();
                    cockpit.spawn(["shutdown", '--reboot', "now"], { superuser: true });
                    cockpit.hint('restart');
                }).catch(function (ex) {
                    self.errorAndClose(ex);
                }).finally(function () {
                    self.set('running', false);
                });
        },

        actions: {
            cancel: function() {
                return this.close();
            },
            ensureDiffs: function () {
                if (this.get('diffsChecked') && this.get('diffs') === null)
                    this.loadDiffs();
            }
        }
    });

    exports.RollbackController = Ember.Controller.extend(Deploy, {
        titleFormat: _("Roll back to $0"),
        errorFormat: _("Error running rollback: $0"),
        submitTitle: _("Roll back and reboot"),
        targetName: "rollbackTarget",


        actions: {
            rollback: function() {
                this.doAction("MakeDefault", null,
                              cockpit.format(_("Successful rollback to "),
                                             this.get('model.releaseName')));
            }
        }
    });

    exports.UpgradeController = Ember.Controller.extend(Deploy, {
        titleFormat: _("Update to $0"),
        errorFormat: _("Error running update: $0"),
        submitTitle: _("Update and reboot"),
        targetName: "upgradeTarget",
        checkingForUpdates: false,

        actionPending: function () {
            return this.get('actionsDisabled') && !this.get('checkingForUpdates');
        }.property('actionsDisabled'),

        actions: {
            upgrade: function() {
                this.doAction("Deploy", [{}],
                              cockpit.format(_("Successfully deployed $0"),
                                             this.get('model.releaseName')));
            },
            checkForUpdates: function () {
                var self = this;
                var target = self.get('model');

                self.send('ensureDiffs');

                self.set('running', true);
                self.set('checkingForUpdates', true);

                // Don't bother with failures
                target.callAndWaitForComplete(this.get('manager'), "PullRpmDb").
                    finally(function () {
                        self.set('running', false);
                        self.set('checkingForUpdates', false);
                    });
            },
        }
    });


    /* Modal Component */
    exports.ActionModalComponent = Ember.Component.extend({
        classNames: ['modal-content'],
        tagName: 'div',
        willInsertElement: function() {
            this.sendAction('show');
            $("#action-dialog").modal('show');
        },
        willDestroyElement: function() {
            this.sendAction('hide');
            $("#action-dialog").modal('hide');
        },
        actions: {
            cancel: function() {
                this.sendAction('cancel');
            },
            submit: function() {
                this.sendAction('submit');
            },
        }
    });
});
