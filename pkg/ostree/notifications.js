define(["exports",
        "jquery",
        "ostree/ember",
], function (exports, $, Ember) {
 "use strict";

  /* Notifications */
  var Manager = Ember.Object.create({
    content: Ember.A(),

    push: function(options) {
      var self = this;

      if (!Boolean(options)) return;

      var obj = {
        dismissClass: "close",
        dismissText: null,
        dismissAction: false,
        message: "",
        type: 'warning',
        dismissable: false,
        duration: 6000,
      };

      if (typeof options === 'object' && options.msg) {
        obj.message = options.msg;
        for (var key in options) {
          if (obj[key] !== "undefined")
            obj[key] = options[key];
        }
      } else if (typeof options === 'string') {
        obj.message = options;
      } else {
        return false;
      }

      self.get('content').pushObject(obj);
    },
  });
  exports.Manager = Manager;


  exports.NotificationsListComponent = Ember.Component.extend({
    classNames: ['notifications'],
    tagName: 'div',
    content: Manager.content,

    actions: {
      closed: function(item) {
        if (item.dismissAction) {
          this.sendAction('action', item);
        }
      },
    }
  });


  exports.NotificationsListItemComponent = Ember.Component.extend({

    classNames: ['alert'],
    classNameBindings: ['typeClass', 'alertDismissible'],
    tagName: 'div',
    item: null,

    duration: function () {
      if (this.get('item.duration'))
        return this.get('item.duration');
      else if (this.get('item.duration') === 0)
        return 0;
      else
        return 6000;
    }.property('item.duration'),

    timer: null,

    alertDismissible: function() {
      return this.get('item.dismissable') === true;
    }.property('item.dismissible'),

    typeClass: function() {
      return 'alert-' + this.get('item.type');
    }.property('item.type'),

    isSuccess: function() {
      return this.get('item.type') === 'success';
    }.property('item.type'),

    isError: function() {
      return this.get('item.type') === 'danger';
    }.property('item.type'),

    isWarning: function() {
      return this.get('item.type') === 'warning';
    }.property('item.type'),

    showNotification: function(time) {
      var self = this;
      if (time) {
        Ember.run.later(function() {
          self.clearNotification();
          self.clearTimeout();
        }, time);
      }
    },

    didInsertElement: function() {
        var self = this;
        self.showNotification(self.get('duration'));
    },

    clearNotification: function() {
      if (!this.isDestroying && !this.isDestroyed) {
        this.$().fadeOut();
        var item = this.get('item');
        Manager.content.removeObject(item);
      }
    },

    clearTimeout: function() {
      var self = this;
      if (self.get('timer') !== null) {
        Ember.run.cancel(self.get('timer'));
        self.set('timer', null);
      }
    },

    mouseEnter: function() {
      this.clearTimeout();
    },

    mouseLeave: function() {
      if (this.get('duration')) {
        var halfSpeedTime = this.get('duration') / 2;
        this.showNotification(halfSpeedTime);
      }
    },

    actions: {
      clear: function() {
        this.sendAction('action', this.get('item'));
        this.clearNotification();
      }
    }
  });
});
