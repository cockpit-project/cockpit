import React from 'react';

class NotificationsApi {
  constructor() {
    this.notifications = [];
  }

  getNotifications() {
    return this.notifications;
  }

  displayNotification(recipe, message) {
    const notification = this.notificationMessage(recipe, message);
    this.notifications.push(notification);
  }

  closeNotification(id, label) {
    let index = id;
    if (index === undefined) {
      for (let i = 0; i < this.notifications.length; i++) {
        if (this.notifications[i].label === label) {
          index = i;
        }
      }
    }
    if (index !== undefined) {
      this.notifications.splice(index, 1);
    }
  }

  notificationMessage(recipe, message) {
    let notification = {};
    switch (message) {
      case 'creating': {
        notification = {
          type: 'process',
          message: <span><strong>{recipe}:</strong> Creating composition.</span>,
          action: <a href="#">Cancel</a>,
          dismiss: true,
        };
        const index = this.notifications.length;
        setTimeout(() => {
          this.closeNotification(index);
          this.displayNotification(recipe, 'created');
        }, 2500);
        // setTimeout is only temporary, and included to simulate what will happen
        // when the user creates a composition (i.e. display process message
        // then success notification); this should be updated
        // when composition creation is fully implemented
        break;
      }
      case 'created': {
        notification = {
          type: 'success',
          message: <span><strong>{recipe}:</strong> Composition creation is complete.</span>,
          // action: <a href="#void">Download (.iso)</a>,
          // this link will need to be implemented when the build process
          // is implemented; this function will need to be extended to handle
          // defining this link
          // kebab: [
          //   <a href="#" >Export Recipe (.bom)</a>,
          // ],
          // this kebab may be needed when the build process is implemented
          fade: true,
        };
        break;
      }
      case 'saving': {
        notification = {
          type: 'process',
          label: 'saving',
          message: <span><strong>{recipe}:</strong> Saving recipe.</span>,
          dismiss: true,
        };
        break;
      }
      case 'saved': {
        notification = {
          type: 'success',
          label: 'saved',
          message: <span><strong>{recipe}:</strong> Recipe is saved.</span>,
          dismiss: true,
          fade: true,
        };
        break;
      }
      case 'saveFailed': {
        notification = {
          type: 'error',
          message: <span><strong>{recipe}:</strong> Save failed.</span>,
          dismiss: true,
        };
        break;
      }
      default: {
        notification = {};
      }
    }
    return notification;
  }

}

export default new NotificationsApi();
