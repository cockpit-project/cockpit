import { all, fork } from 'redux-saga/effects';
import recipes from './recipes';
import modals from './modals';
import inputs from './inputs';

function* rootSaga() {
  yield all([
    fork(recipes),
    fork(modals),
    fork(inputs),
  ]);
}

export default rootSaga;
