import { default as tabTemplate } from './pf-tab.template';
import { default as tabsTemplate } from './pf-tabs.template';
import './pf-tab.component';

/**
 * <b>&lt;pf-tabs&gt;</b> element for Patternfly Web Components
 *
 * @example {@lang xml}
 * <pf-tabs>
 *  <pf-tab tab-title="Tab1" active="true">
 *    <p>Tab1 content here</p>
 *  </pf-tab>
 *  <pf-tab tab-title="Tab2">
 *    <p>Tab2 content here</p>
 *  </pf-tab>
 * </pf-tabs>
 *
 */
export class PfTabs extends HTMLElement {
  /*
   * Called every time the element is inserted into the DOM
   */
  connectedCallback() {
    if (!this.pf_initialized) {
      this.insertBefore(this.pf_tabsTemplate.content, this.firstChild);

      this.pfMakeTabsFromPfTab();

      this.querySelector('ul').addEventListener('click', this);

      // Add the ul class if specified
      this.querySelector('ul').className = this.attributes['data-classname']
        ? this.attributes['data-classname'].value
        : 'nav nav-tabs';

      if (!this.mutationObserver) {
        this.mutationObserver = new MutationObserver(this.pfHandleMutations.bind(this));
        this.mutationObserver.observe(this, { childList: true, attributes: true });
      }
    }
    this.pf_initialized = true;
  }

  /*
   * Only attributes listed in the observedAttributes property will receive this callback
   */
  static get observedAttributes() {
    return ['class'];
  }

  /**
   * Called when element's attribute value has changed
   *
   * @param {string} attrName The attribute name that has changed
   * @param {string} oldValue The old attribute value
   * @param {string} newValue The new attribute value
   */
  attributeChangedCallback(attrName, oldValue, newValue) {
    if (attrName === 'class' && newValue !== 'ng-isolate-scope') {
      const ul = this.querySelector('ul');
      if (ul) {
        ul.className = newValue;
      }
    }
  }

  /*
   * An instance of the element is created or upgraded
   */
  constructor() {
    super();
    this.pf_tabsTemplate = document.createElement('template');
    this.pf_tabsTemplate.innerHTML = tabsTemplate;

    this.selected = null;
    this.tabMap = new Map();
    this.panelMap = new Map();
    this.displayMap = new Map();
  }

  /**
   * Called when the element is removed from the DOM
   */
  disconnectedCallback() {
    this.querySelector('ul').removeEventListener('click', this);
  }

  /**
   * Handle the tab change event
   *
   * @param event {Event} Handle the tab change event
   */
  handleEvent(event) {
    if (event.target.tagName === 'A') {
      event.preventDefault();
      this.pfSetTabStatus(event.target.parentNode);
    }
  }

  /**
   * Handle mutations
   *
   * @param mutations
   * @private
   */
  pfHandleMutations(mutations) {
    const self = this;
    const handlers = [];
    mutations.forEach(mutationRecord => {
      // child dom nodes have been added
      if (mutationRecord.type === 'childList') {
        for (let i = 0; i < mutationRecord.addedNodes.length; i++) {
          handlers.push(['add', mutationRecord.addedNodes[i]]);
        }
        for (let i = 0; i < mutationRecord.removedNodes.length; i++) {
          handlers.push(['remove', mutationRecord.removedNodes[i]]);
        }
      } else if (mutationRecord.type === 'attributes') {
        // mutationRecord.attributeName contains changed attributes
        // note: we can ignore this for attributes as the v1 spec of custom
        // elements already provides attributeChangedCallback
      }
    });
    if (handlers.length) {
      requestAnimationFrame(() => {
        const ul = self.querySelector('ul');
        handlers.forEach(notes => {
          const action = notes[0];
          const pfTab = notes[1];
          let tab;

          // ignore Angular directive #text and #comment nodes
          if (pfTab.nodeName !== 'PF-TAB') {
            return;
          }

          if (action === 'add') {
            // add tab
            tab = self.pfMakeTab(pfTab);
            self.tabMap.set(tab, pfTab);
            self.panelMap.set(pfTab, tab);

            // if active, deactivate others
            if (pfTab.attributes.active) {
              self.tabMap.forEach((value, key) => {
                const fn = tab === key ? self.pfMakeActive : self.pfMakeInactive;
                fn.call(self, key);
              });
            } else {
              self.pfMakeInactive(tab);
            }
            ul.appendChild(tab);
          } else {
            // remove tab
            tab = self.panelMap.get(pfTab);
            tab.parentNode.removeChild(tab);
            self.panelMap.delete(pfTab);
            self.tabMap.delete(tab);
            self.displayMap.delete(tab);

            // we removed the active tab, make the last one active
            if (pfTab.attributes.active) {
              const last = ul.querySelector('li:last-child');
              self.pfSetTabStatus(last);
            }
          }
        });
      });
    }
  }

  /**
   * Handle the tabTitle change event
   *
   * @param panel {string} The tab panel
   * @param tabTitle {string} The tab title
   */
  handleTitle(panel, tabTitle) {
    const tab = this.panelMap.get(panel);
    // attribute changes may fire as Angular is rendering
    // before this tab is in the panelMap, so check first
    if (tab) {
      tab.children[0].textContent = tabTitle;
    }
  }

  /**
   * Sets the active tab programmatically
   * @param tabTitle
   */
  setActiveTab(tabTitle) {
    this.tabMap.forEach((value, key) => {
      const tabtitle = value.attributes.tabtitle ? value.attributes.tabtitle.value : value.tabtitle;
      if (tabtitle === tabTitle) {
        this.pfSetTabStatus(key);
      }
    });
  }

  /**
   * Helper function to create tabs
   *
   * @private
   */
  /* eslint-disable no-param-reassign*/
  pfMakeTabsFromPfTab() {
    const ul = this.querySelector('ul');
    if (this.children && this.children.length) {
      const pfTabs = [].slice.call(this.children).filter(node => node.nodeName === 'PF-TAB');
      [].forEach.call(pfTabs, (pfTab, idx) => {
        const tab = this.pfMakeTab(pfTab);
        ul.appendChild(tab);
        this.tabMap.set(tab, pfTab);
        this.panelMap.set(pfTab, tab);

        if (idx === 0) {
          this.pfMakeActive(tab);
        } else {
          pfTab.style.display = 'none';
        }
      });
    }
  }
  /* eslint-enable no-param-reassign*/

  /**
   * Helper function to create a new tab element from given tab
   *
   * @param pfTab A PfTab element
   * @returns {PfTab} A new PfTab element
   * @private
   */
  pfMakeTab(pfTab) {
    const frag = document.createElement('template');
    frag.innerHTML = tabTemplate;
    const tab = frag.content.firstElementChild;
    const tabAnchor = tab.firstElementChild;
    // React gives us a node with attributes, Angular adds it as a property
    tabAnchor.innerHTML = pfTab.attributes && pfTab.attributes.tabTitle ? pfTab.attributes.tabTitle.value : pfTab.tabTitle;
    this.displayMap.set(pfTab, pfTab.style.display);
    return tab;
  }

  /**
   * Helper function to make given tab active
   *
   * @param tab A PfTab element
   * @private
   */
  pfMakeActive(tab) {
    tab.classList.add('active');
    const pfTab = this.tabMap.get(tab);
    const naturalDisplay = this.displayMap.get(pfTab);
    pfTab.style.display = naturalDisplay;
    pfTab.setAttribute('active', '');
  }

  /**
   * Helper function to make given tab inactive
   *
   * @param tab A PfTab element
   * @private
   */
  pfMakeInactive(tab) {
    tab.classList.remove('active');
    const pfTab = this.tabMap.get(tab);
    pfTab.style.display = 'none';
    pfTab.removeAttribute('active');
  }

  /**
   * Helper function to set tab status
   *
   * @param {boolean} active True if active
   * @param {string} tabtitle the tab title
   * @private
   */
  pfSetTabStatus(active) {
    if (active === this.selected) {
      return;
    }
    this.selected = active;

    let activeTabTitle = '';
    const tabs = this.querySelector('ul').children;
    [].forEach.call(tabs, tab => {
      if (active === tab) {
        activeTabTitle = tab.querySelector('a').text;
      }
      const fn = active === tab ? this.pfMakeActive : this.pfMakeInactive;
      fn.call(this, tab);
    });

    // dispatch the custom 'tabChanged' event for framework listeners
    this.dispatchEvent(new CustomEvent('tabChanged', { detail: activeTabTitle }));
  }
}

window.customElements.define('pf-tabs', PfTabs);
