import { createStore, applyMiddleware, compose } from 'redux';
import createSagaMiddleware from 'redux-saga';
import { persistStore, autoRehydrate } from 'redux-persist';
import rootReducer from './reducers/index';
import rootSaga from './sagas/index';

const sagaMiddleware = createSagaMiddleware();

/* eslint-disable no-underscore-dangle */
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
/* eslint-enable */

const initialState = {
  rehydrated: false,
  recipePage: {
    activeTab: 'Details',
    editDescriptionVisible: 'false',
    selectedComponent: '',
    selectedComponentParent: '',
    selectedComponentStatus: 'view',
  },
  inputs: {
    selectedInputPage: 0,
    pageSize: 50,
    selectedInput: {
      component: '',
      parent: '',
      status: '',
    },
    inputFilters: {
        field: 'name',
        value: '',
    },
  },
  recipes : [],
  modals: {
    createComposition: {
      compositionTypes: [],
    },
    exportRecipe: {
      name: '',
      contents: [],
      visible: false,
    },
    createRecipe: {
      showErrorName: false,
      showErrorDuplicate: false,
      inlineError: false,
      checkErrors: true,
      recipe: {
        name: '',
        description: '',
        modules: [],
        packages: [],
      },
    },
    pendingChanges: {
      componentUpdates: {
        past: [],
        present: [],
        future: [],
      },
    },
  },
  sort: {
    recipes: {
      key: 'name',
      value: 'DESC',
    },
    components: {
      key: 'name',
      value: 'DESC',
    },
    dependencies: {
      key: 'name',
      value: 'DESC',
    },
  },
};

const store = createStore(
  rootReducer,
  initialState,
  composeEnhancers(
    applyMiddleware(sagaMiddleware),
    autoRehydrate()
  )
);
sagaMiddleware.run(rootSaga);

persistStore(store, { whitelist: ['recipePage'] });

export default store;
