/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * The simplest external provider for cockpit:machines.
 *
 * Used
 *   - for Cockpit integration tests
 *   - as a Hello World example for 3rd party development
 *
 * Written in VanillaJS.
 *
 * For more complex UI scenarios OR React, please consider ES6/Webpack as used in the `cockpit-machines-ovirt-provider`
 * referential implementation (see cockpit:machines README.md for most current link to the project).
 *
 * Installation prerequisites:
 *   - Have cockpit-machines package version >=133 installed and running
 *
 * Installation steps:
 *   - # mkdir /usr/share/cockpit/machines/provider
 *   - # cp [PATH_TO_THIS_JS_FILE] /usr/share/cockpit/machines/provider/index.js
 *   - refresh/login to cockpit, go to the 'Virtual Machines' package
 */

(function () {
  /**
   * Will be created from init().
   * In real and more complex provider, consider wrapping into objects as a namespace.
   * If React is required, consider use of ES6/Webpack.
   *
   * For simple UI extensions, JQuery can be used as well but please do not update React-rendered DOM via JQuery.
   */
  var TestSubtabReactComponent = null;

  var PROVIDER = {};
  PROVIDER = {
    name: 'TEST_PROVIDER',

    actions: {}, // it's expected to be replaced by init()
    parentReactComponents: {}, // to reuse look&feel, see init()
    nextProvider: null, // will be default Libvirt provider in the basic scenario
    vmStateMap: null, // see init()

    /**
     * Lazily initialize the Provider from the `providerContext`.
     * Do login to external system if needed.
     *
     * Return boolean or Promise.
     *
     * See cockpit:machines provider.es6
     */
    init: function (providerContext) {
      console.log("PROVIDER.init() called");

      _checkInitParams(providerContext); // not needed on production, part of integration test

      // The external provider is loaded into context of cockpit:machines plugin
      // So, JQuery and Cockpit are available
      if (!window.$) {
        console.error('JQuery not found! The PROVIDER is not initialized, using default.');
        return false;
      }
      if (!window.cockpit) {
        console.error('Cockpit not found! The PROVIDER is not initialized, using default.');
        return false;
      }

      PROVIDER.actions = providerContext.exportedActionCreators;
      PROVIDER.parentReactComponents = providerContext.exportedReactComponents;
      PROVIDER.nextProvider = providerContext.defaultProvider;
      PROVIDER.vmStateMap = {}; // reuse map for Libvirt (defaultProvider.vmStateMap)

      _lazyCreateReactComponents(providerContext.React);

      return true; // or Promise
    },

    /**
     * Manage visibility of VM action buttons or so.
     *
     * Recent implementation: redirect state functions back to Libvirt provider.
     */
    canReset: function (state) {
      return PROVIDER.nextProvider.canReset(state);
    },
    canShutdown: function (state) {
      return PROVIDER.nextProvider.canShutdown(state);
    },
    isRunning: function (state) {
      return PROVIDER.nextProvider.isRunning(state);
    },
    canRun: function (state) {
      return PROVIDER.nextProvider.canRun(state);
    },
    canConsole: function (state) {
      return PROVIDER.nextProvider.canConsole(state);
    },

    /**
     * Get a single VM
     *
     * Not needed for the scope of this minimal PROVIDER.
     *
     * See cockpit:machines actions.es6.
     */
    GET_VM: function (payload) {
      console.log('PROVIDER.GET_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('GET_VM not implemented for this PROVIDER');
      };
    },

    /**
     * Initiate read of all VMs.
     */
    GET_ALL_VMS: function (payload) {
      console.log('PROVIDER.GET_ALL_VMS() called');
      /* To redirect the call to Libvirt:
       *    return PROVIDER.nextProvider.GET_ALL_VMS(payload);
       */
      return function (dispatch) {
        // Example of using (Cockpit) Promise for async actions
        return window.cockpit.spawn(['echo', 'Hello']).then(function (data) {
          var CONNECTION_NAME = 'testConnection'; // Use whatever suits your needs. In Libvirt, [system | session] is used.

          dispatch(PROVIDER.actions.updateOrAddVm({ // add
            connectionName: CONNECTION_NAME,
            name: 'vm1',
            id: 'id-vm1',
            osType: '',
            currentMemory: '1048576', // 1 GB
            vcpus: 1
          }));
          dispatch(PROVIDER.actions.updateOrAddVm({ // update
            connectionName: CONNECTION_NAME,
            name: 'vm1',
            state: 'running',
            autostart: 'enable'
          }));

          dispatch(PROVIDER.actions.updateOrAddVm({
            connectionName: CONNECTION_NAME,
            name: 'vm2',
            id: 'id-vm2',
            osType: '',
            currentMemory: '2097152', // 2 GB
            vcpus: 2,
            state: 'shut off',
            autostart: 'disable'
          }));

          // Schedule next GET_ALL_VMS() call if polling is needed, i.e. via dispatch(PROVIDER.actions.delayPolling(getAllVms()))
        });
      };
    },

    /**
     * Call `shut down` on the VM.
     */
    SHUTDOWN_VM: function (payload) {
      console.log('PROVIDER.SHUTDOWN_VM called with params: ' + JSON.stringify(payload));
      const vmName = payload.name;
      const connectionName = payload.connectionName;
      return function (dispatch) {
        /*
         * Do external call, return Promise.
         *
         * Dummy implementation to see if it's working follows.
         *
         * In real provider, the SHUTDOWN_VM() initiates the operation in "external" system and
         * then the redux state is updated via polling/events/scheduled focused refresh.
         */

        var dfd = window.cockpit.defer();

        // mock the external system right here
        dispatch(PROVIDER.actions.updateOrAddVm({
          connectionName: connectionName,
          name: vmName,
          state: 'shut off',
        }));

        dfd.resolve();
        return dfd.promise;
      };
    },


    /**
     * Example for VM action error handling.
     *
     * The error message will be displayed along the VM.
     */
    START_VM: function (payload) {
      console.log('PROVIDER.REBOOT_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('START_VM intentionally implemented as failing in this PROVIDER.');
        const vmName = payload.name;
        const connectionName = payload.connectionName;

        dispatch(vmActionFailed({
          name: vmName,
          connectionName: connectionName,
          message: 'VM failed to start',
          detail: 'Detailed description of the failure.',
        }));
      };
    },

    /**
     * Force shut down on the VM.
     */
    FORCEOFF_VM: function (payload) {
      console.log('PROVIDER.FORCEOFF_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('FORCEOFF_VM not implemented for this PROVIDER');
      };
    },

    REBOOT_VM: function (payload) {
      console.log('PROVIDER.REBOOT_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('REBOOT_VM not implemented for this PROVIDER');
      };
    },

    FORCEREBOOT_VM: function (payload) {
      console.log('PROVIDER.FORCEREBOOT_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('FORCEREBOOT_VM not implemented for this PROVIDER');
      };
    },

    CONSOLE_VM: function (payload) {
      console.log('PROVIDER.CONSOLE_VM called with params: ' + JSON.stringify(payload));
      return function (dispatch) {
        console.log('CONSOLE_VM not implemented for this PROVIDER');
      };
    },

    /*
     * Feel free to add additional VM action handlers not even recognized by the Libvirt
     * as far as your provider's UI extension dispatches the correct actions via `PROVIDER.actions.virtMiddleware()`
     *
     * Example: MIGRATE_VM  or CREATE_VM in cockpit-machines-ovirt-provider
     */

    reducer: undefined, // optional reference to reducer function extending the application Redux state tree, see cockpit-machines-ovirt-provider for more detailed example

    /**
     * Optional array of
     * {
   *  name: 'My Tab Title',
   *  componentFactory: () => yourReactComponentRenderingSubtabBody
   *  }
     *
     * Please note, the React components have to be created lazily via `providerContext.React` passed to the init() function.
     */
    vmTabRenderers: [
      {
        name: 'Test Subtab',
        componentFactory: function () {
          return TestSubtabReactComponent;
        }
      },
    ],

    vmDisksActionsFactory: undefined, // optional
    vmDisksColumns: undefined, // optional

    /*
     * Please note, there are additional methods/properties supported by the cockpit:machines API but out of the scope of this simple test implementation
     * For full reference see either cockpit:machines sources or the cockpit-machines-ovirt-provider.
     */
  };

  window.EXTERNAL_PROVIDER = PROVIDER;
  console.info('PROVIDER registered');

// ---------------------------------------------------------------------------------------------------------------------
  /**
   * Example of Redux action creator.
   *
   * Used to dispatch error message, handled in cockpit:machines reducers.es6 to update the Redux state.
   */
  function vmActionFailed(details) {
    return {
      type: 'VM_ACTION_FAILED',
      payload: {
        name: details.name,
        connectionName: details.connectionName,
        message: details.message,
        detail: details.detail,
      }
    };
  }

  /**
   * Example of lazy React components creation.
   *
   * Always reuse React library provided from the calling cockpit:machines context.
   */
  function _lazyCreateReactComponents(React) {
    TestSubtabReactComponent = React.createClass(
        {
          propTypes: {
            vm: React.PropTypes.object.isRequired,
          },
          render: function () {
            var vm = this.props.vm;
            return React.createElement('div', {id: 'test-subtab-body-' + vm.name}, 'Content of subtab');
          }
        }
    );
  }

// --- Following functions are for integration tests only, not needed for a production external provider---------------
  function ProviderException(text, detail) {
    this.message = text + ': ' + JSON.stringify(detail);
    this.name = 'ProviderException';
  }

  function _checkIsFunction(text, obj) {
    if (!!(obj && obj.constructor && obj.call && obj.apply)) {
      return true;
    }
    throw new ProviderException(text, obj);
  }

  function _checkEqual(text, objA, objB) {
    if (objA === objB) {
      return true;
    }
    throw new ProviderException(text, obj);
  }

  function _checkInitParams(providerContext) {
    console.log('_checkInitParams called');
    _checkEqual('The default provider shall be Libvirt', providerContext.defaultProvider.name, 'Libvirt');

    _checkIsFunction('Reference to React shall be provided', providerContext.React.createClass);

    _checkIsFunction('Reference to Redux shall be provided', providerContext.reduxStore.dispatch);
    _checkIsFunction('Reference to Redux shall be provided', providerContext.reduxStore.subscribe);


    var exportedActionCreators = providerContext.exportedActionCreators;
    _checkIsFunction('exportedActionCreators.virtMiddleware shall be a function', exportedActionCreators.virtMiddleware);
    _checkIsFunction('exportedActionCreators.delayRefresh shall be a function', exportedActionCreators.delayRefresh);
    _checkIsFunction('exportedActionCreators.deleteUnlistedVMs shall be a function', exportedActionCreators.deleteUnlistedVMs);
    _checkIsFunction('exportedActionCreators.updateOrAddVm shall be a function', exportedActionCreators.updateOrAddVm);

    var exportedReactComponents = providerContext.exportedReactComponents;
    _checkIsFunction('Listing React component shall be provided', exportedReactComponents.Listing);
    _checkIsFunction('ListingRow React component shall be provided', exportedReactComponents.ListingRow);
    _checkIsFunction('StateIcon React component shall be provided', exportedReactComponents.StateIcon);
    _checkIsFunction('DropdownButtons React component shall be provided', exportedReactComponents.DropdownButtons);
  }
}());
