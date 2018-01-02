/* global $ */

class Wizard {

  constructor(id) {
    const self = this;

    // update which tab group is active
    this.updateTabGroup = () => {
      $(`${self.modal} .wizard-pf-step.active`).removeClass('active');
      $(`${self.modal} .wizard-pf-step[data-tabgroup='${self.currentGroup}']`).addClass('active');
      $(`${self.modal} .wizard-pf-sidebar .list-group`).addClass('hidden');
      $(`${self.modal} .list-group[data-tabgroup='${self.currentGroup}']`).removeClass('hidden');
    };

    // update which tab is active
    this.updateActiveTab = () => {
      $(`${self.modal} .list-group-item[data-tab='${self.currentTab}']`).addClass('active');
      self.updateVisibleContents();
    };

    // update which contents are visible
    this.updateVisibleContents = () => {
      const tabIndex = ($.inArray(self.currentTab, self.tabs));
      // displaying contents associated with currentTab
      $(`${self.modal} .wizard-pf-contents`).addClass('hidden');
      $(`${self.modal} .wizard-pf-contents:eq(${tabIndex})`).removeClass('hidden');
      // setting focus to first form field in active contents
      setTimeout(() => {
        // this does not account for disabled or read-only inputs
        $('.wizard-pf-contents:not(.hidden) form input,'
          + ' .wizard-pf-contents:not(.hidden) form textarea,'
          + ' .wizard-pf-contents:not(.hidden) form select').first().focus();
      }, 100);
    };

    // update display state of Back button
    this.updateBackBtnDisplay = () => {
      if (self.currentTab === self.tabs[0]) {
        $(`${self.modal} .wizard-pf-back`).addClass('disabled');
      }
    };

    // update display state of next/finish button
    this.updateNextBtnDisplay = () => {
      if (self.currentTab === self.tabSummary) {
        $(`${self.modal} .wizard-pf-next`).addClass('hidden');
        $(`${self.modal} .wizard-pf-finish`).removeClass('hidden');
      } else {
        $(`${self.modal} .wizard-pf-finish`).addClass('hidden');
        $(`${self.modal} .wizard-pf-next`).removeClass('hidden');
      }
    };

    // update display state of buttons in the footer
    this.updateWizardFooterDisplay = () => {
      $(`${self.modal} .wizard-pf-footer .disabled`).removeClass('disabled');
      self.updateBackBtnDisplay();
      self.updateNextBtnDisplay();
    };


    // when the user clicks a step, then the tab group for that step is displayed
    this.tabGroupSelect = () => {
      $(`${self.modal} .wizard-pf-step>a`).click(() => {
        // remove active class active tabgroup and add active class to the
        // clicked tab group (but don't remove the active class from current tab)
        self.currentGroup = $(this).parent().data('tabgroup');
        self.updateTabGroup();
        // update value for currentTab -- if a tab is already marked as active
        // for the new tab group, use that, otherwise set it to the first tab
        // in the tab group
        self.currentTab = $(`${self.modal} .list-group[data-tabgroup='${self.currentGroup}']
          .list-group-item.active`).data('tab');
        if (self.currentTab === undefined) {
          self.currentTab = $(`${self.modal} .list-group[data-tabgroup='${self.currentGroup}']
            .list-group-item:first-child`).data('tab');
          // apply active class to new current tab and associated contents
          self.updateActiveTab();
        } else {
          // use already active tab and just update contents
          self.updateVisibleContents();
        }
        // show/hide/disable/enable buttons if needed
        self.updateWizardFooterDisplay();
      });
    };

    // when the user clicks a tab, then the tab contents are displayed
    this.tabSelect = () => {
      $(`${self.modal} .wizard-pf-sidebar .list-group-item>a`).click(() => {
        // update value of currentTab to new active tab
        self.currentTab = $(this).parent().data('tab');
        // remove active class from active tab in current active tab group (i.e.
        // don't remove the class from tabs in other groups)
        $(`${self.modal} .list-group[data-tabgroup='${self.currentGroup}'] .list-group-item.active`)
          .removeClass('active');
        // add active class to the clicked tab and the associated contents
        $(this).parent().addClass('active');
        self.updateVisibleContents();
        if (self.currentTab === self.tabLast) {
          $(`${self.modal} .wizard-pf-next`).addClass('hidden');
          $(`${self.modal} .wizard-pf-finish`).removeClass('hidden');
          self.finish();
        } else {
          // show/hide/disable/enable buttons if needed
          self.updateWizardFooterDisplay();
        }
      });
    };

    // Back button clicked
    this.backBtnClicked = () => {
      $(`${self.modal} .wizard-pf-back`).click(() => {
        // if not the first page
        if (self.currentTab !== self.tabs[0]) {
          // go back a page (i.e. -1)
          self.wizardPaging(-1);
          // show/hide/disable/enable buttons if needed
          self.updateWizardFooterDisplay();
        }
      });
    };

    // Next button clicked
    this.nextBtnClicked = () => {
      $(`${self.modal} .wizard-pf-next`).click(() => {
        // go forward a page (i.e. +1)
        self.wizardPaging(1);
        // show/hide/disable/enable buttons if needed
        self.updateWizardFooterDisplay();
      });
    };

    // Finish button clicked
    // Deploy/Finish button would only display during the second to last step.
    this.finishBtnClick = () => {
      $(`${self.modal} .wizard-pf-finish`).click(() => {
        self.wizardPaging(1);
        self.finish();
      });
    };

    // Cancel/Close button clicked
    this.cancelBtnClick = () => {
      $(`${self.modal} .wizard-pf-dismiss`).click(() => {
        // close the modal
        $(self.modal).modal('hide');
        // drop click event listeners
        $(`${self.modal} .wizard-pf-step>a`).off('click');
        $(`${self.modal} .wizard-pf-sidebar .list-group-item>a`).off('click');
        $(`${self.modal} .wizard-pf-back`).off('click');
        $(`${self.modal} .wizard-pf-next`).off('click');
        $(`${self.modal} .wizard-pf-finish`).off('click');
        $(`${self.modal} .wizard-pf-dismiss`).off('click');
        // reset final step
        $(`${self.modal} .wizard-pf-process`).removeClass('hidden');
        $(`${self.modal} .wizard-pf-complete`).addClass('hidden');
        // reset loading message
        $(`${self.modal} .wizard-pf-contents`).addClass('hidden');
        $(`${self.modal} .wizard-pf-loading`).removeClass('hidden');
        // remove tabs and tab groups
        $(`${self.modal} .wizard-pf-steps`).addClass('hidden');
        $(`${self.modal} .wizard-pf-sidebar`).addClass('hidden');
        // reset buttons in final step
        $(`${self.modal} .wizard-pf-close`).addClass('hidden');
        $(`${self.modal} .wizard-pf-cancel`).removeClass('hidden');
      });
    };

    // when the user clicks Next/Back, then the next/previous tab and contents display
    this.wizardPaging = direction => {
      // get n.n value of next tab using the index of next tab in tabs array
      const tabIndex = ($.inArray(self.currentTab, self.tabs)) + direction;
      const newTab = self.tabs[tabIndex];
      // add/remove active class from current tab group
      // included math.round to trim off extra .000000000002 that was getting added
      if (newTab !== Math.round(10 * (direction * 0.1 + self.currentTab)) / 10) {
        // this statement is true when the next tab is in the next tab group
        // if next tab is in next tab group (e.g. next tab data-tab value is
        // not equal to current tab +.1) then apply active class to next
        // tab group and step, and update the value for var currentGroup +/-1
        self.currentGroup = self.currentGroup + direction;
        self.updateTabGroup();
      }
      self.currentTab = newTab;
      // remove active class from active tab in current tab group
      $(`${self.modal} .list-group[data-tabgroup='${self.currentGroup}'] .list-group-item.active`)
        .removeClass('active');
      // apply active class to new current tab and associated contents
      self.updateActiveTab();
    };
    // This code keeps the same contents div active, but switches out what
    // contents display in that div (i.e. replaces process message with
    // success message).
    this.finish = () => {
      // if Back remains enabled during this step,
      // then the Close button needs to be removed when the user clicks Back
      $(`${self.modal} .wizard-pf-back`).addClass('disabled');
      $(`${self.modal} .wizard-pf-finish`).addClass('disabled');
      // code for kicking off process goes here
      // the next code is just to simulate the expected experience, in that
      // when the process is complete, the success message etc. would display
      setTimeout(() => {
        $(`${self.modal} .wizard-pf-cancel`).addClass('hidden');
        $(`${self.modal} .wizard-pf-finish`).addClass('hidden');
        $(`${self.modal} .wizard-pf-close`).removeClass('hidden');
        $(`${self.modal} .wizard-pf-process`).addClass('hidden');
        $(`${self.modal} .wizard-pf-complete`).removeClass('hidden');
      }, 3000);
    };

    this.updateWizardLayout = () => {
      const top = `${$(`${self.modal} .modal-header`).outerHeight() + $(`${self.modal} .wizard-pf-steps`).outerHeight()}px`;
      const bottom = `${$(`${self.modal} .modal-footer`).outerHeight()}px`;
      const sidebarwidth = `${$(`${self.modal} .wizard-pf-sidebar`).outerWidth()}px`;
      $(`${self.modal} .wizard-pf-row`).css('top', top);
      $(`${self.modal} .wizard-pf-row`).css('bottom', bottom);
      $(`${self.modal} .wizard-pf-main`).css('margin-left', sidebarwidth);
    };

    this.init = () => {
      // get id of open modal
      self.modal = id;
      // open modal
      $(self.modal).modal('show');
      // adjust height of contents row
      // (while steps and sidebar are hidden and loading message displays)
      this.updateWizardLayout();
      // assign data attribute to all tabs
      $(`${self.modal} .wizard-pf-sidebar .list-group-item`).each(() => {
        // set the first digit (i.e. n.0) equal to the index of the parent tab group
        // set the second digit (i.e. 0.n) equal to the index of the tab within the tab group
        $(this).attr('data-tab', ($(this).parent().index() + 1 + ($(this).index() / 10 + 0.1)));
      });
      // assign data attribute to all tabgroups
      $(`${self.modal} .wizard-pf-sidebar .list-group`).each(() => {
        // set the value equal to the index of the tab group
        $(this).attr('data-tabgroup', ($(this).index() + 1));
      });
      // create array of all tabs, using the data attribute, and determine the last tab
      self.tabs = $(`${self.modal} .wizard-pf-sidebar .list-group-item`).map(() => $(this).data('tab')
      );
      self.tabCount = self.tabs.length;
      self.tabSummary = self.tabs[self.tabCount - 2]; // second to last tab displays summary
      self.tabLast = self.tabs[self.tabCount - 1]; // last tab displays progress
      // set first tab group and tab as current tab
      // if someone wants to target a specific tab, that could be handled here
      self.currentGroup = 1;
      self.currentTab = 1.1;
      self.updateTabGroup();
      // hide loading message
      $(`${self.modal} .wizard-pf-loading`).addClass('hidden');
      // show tabs and tab groups
      $(`${self.modal} .wizard-pf-steps`).removeClass('hidden');
      $(`${self.modal} .wizard-pf-sidebar`).removeClass('hidden');
      // remove active class from all tabs
      $(`${self.modal} .wizard-pf-sidebar .list-group-item.active`).removeClass('active');
      // apply active class to new current tab and associated contents
      self.updateActiveTab();
      // adjust height of contents row (while steps and sidebar and tab contents are visible)
      self.updateWizardLayout();
      self.updateWizardFooterDisplay();
      // initialize click listeners
      self.tabGroupSelect();
      self.tabSelect();
      self.backBtnClicked();
      self.nextBtnClicked();
      self.finishBtnClick();
      self.cancelBtnClick();
      $(window).resize(() => {
        self.updateWizardLayout();
      });
    };

    this.init(id);
  }

}

export default Wizard;
